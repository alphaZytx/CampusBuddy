import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RentalStatus } from '@campusbuddy/shared';
import {
  assertRentalTransition,
  confirmReturnSchema,
  createRentalItemSchema,
  createRentalRequestSchema,
  formatINR,
} from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx, type Outbox } from '../../core/outbox.js';
import type { Queryable } from '../../db/client.js';
import {
  toAttachmentsFromJson,
  toIso,
  toIsoOrNull,
  toNumber,
  toPayment,
  toPublicUserFromJson,
  type PaymentRow,
} from '../../core/serializers.js';
import { asJson } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { publish, rentalChannel } from '../../realtime/hub.js';

/**
 * Peer-to-peer rentals (spec §41, §42).
 *
 * AVAILABLE → RESERVED → RENTED → RETURN_PENDING → RETURNED → COMPLETED, with the
 * deposit settled at the end. A partial unique index guarantees an item can only be
 * committed to one renter at a time, so double-booking is impossible rather than
 * merely unlikely.
 */

const itemParams = z.object({ id: z.string().uuid('Unknown item') });
const rentalParams = z.object({ id: z.string().uuid('Unknown rental') });

const itemListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  categorySlug: z.string().optional(),
  availableOnly: z.coerce.boolean().default(true),
  scope: z.enum(['ALL', 'MINE']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

const ITEM_SELECT = `
  SELECT i.id, i.campus_id, i.name, i.description, i.category_slug, i.condition,
         i.price_paise, i.rental_unit, i.deposit_paise, i.status, i.pickup_zone,
         i.rules, i.created_at, to_jsonb(p) AS owner,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', a.id, 'file_name', a.file_name,
                   'mime_type', a.mime_type, 'size_bytes', a.size_bytes)
                 ORDER BY ri.sort_order), '[]'::jsonb)
            FROM rental_item_images ri JOIN attachments a ON a.id = ri.attachment_id
           WHERE ri.item_id = i.id) AS images
    FROM rental_items i JOIN public_user_profiles p ON p.id = i.owner_id
`;

const RENTAL_SELECT = `
  SELECT r.id, r.status, r.start_at, r.expected_return_at, r.actual_return_at,
         r.units, r.rental_fee_paise, r.deposit_paise, r.deposit_returned_paise,
         r.damage_note, r.message, r.created_at, r.owner_id, r.renter_id, r.item_id,
         to_jsonb(op) AS owner, to_jsonb(rp) AS renter,
         (SELECT to_jsonb(i) || jsonb_build_object('owner', to_jsonb(iop))
            FROM rental_items i JOIN public_user_profiles iop ON iop.id = i.owner_id
           WHERE i.id = r.item_id) AS item,
         (SELECT to_jsonb(pay) || jsonb_build_object(
                   'payee_upi_id', pu.upi_id,
                   'payee_upi_qr_attachment_id', pu.upi_qr_attachment_id,
                   'payee_name', pu.full_name)
            FROM payments pay JOIN users pu ON pu.id = pay.payee_id
           WHERE pay.rental_id = r.id LIMIT 1) AS payment
    FROM rentals r
    JOIN public_user_profiles op ON op.id = r.owner_id
    JOIN public_user_profiles rp ON rp.id = r.renter_id
`;

interface ItemRow {
  id: string;
  campus_id: string;
  name: string;
  description: string;
  category_slug: string;
  condition: string;
  price_paise: string | number;
  rental_unit: string;
  deposit_paise: string | number;
  status: string;
  pickup_zone: string | null;
  rules: string | null;
  created_at: Date;
  owner: unknown;
  images: unknown;
}

interface RentalRow {
  id: string;
  status: RentalStatus;
  start_at: Date | null;
  expected_return_at: Date;
  actual_return_at: Date | null;
  units: number;
  rental_fee_paise: string | number;
  deposit_paise: string | number;
  deposit_returned_paise: string | number | null;
  damage_note: string | null;
  message: string | null;
  created_at: Date;
  owner_id: string;
  renter_id: string;
  item_id: string;
  owner: unknown;
  renter: unknown;
  item: unknown;
  payment: unknown;
}

function toRentalItem(row: ItemRow) {
  const owner = toPublicUserFromJson(row.owner);
  if (!owner) throw new Error('Rental item row is missing its owner profile');
  return {
    id: row.id,
    campusId: row.campus_id,
    owner,
    name: row.name,
    description: row.description,
    categorySlug: row.category_slug,
    condition: row.condition,
    pricePaise: toNumber(row.price_paise),
    rentalUnit: row.rental_unit,
    depositPaise: toNumber(row.deposit_paise),
    status: row.status,
    pickupZone: row.pickup_zone,
    rules: row.rules,
    images: toAttachmentsFromJson(row.images),
    createdAt: toIso(row.created_at),
  };
}

/** Actions the viewer may take, derived from the rental state machine. */
function rentalActions(row: RentalRow, viewerId: string): string[] {
  const isOwner = row.owner_id === viewerId;
  // The machine calls the owner REQUESTER (they own the transaction) and the
  // renter HELPER, mirroring the request lifecycle's two sides.
  const actor = isOwner ? 'REQUESTER' : 'HELPER';
  const candidates: Array<[string, RentalStatus]> = [
    ['accept', 'RESERVED'],
    ['decline', 'DECLINED'],
    ['cancel', 'CANCELLED'],
    ['confirm_pickup', 'RENTED'],
    ['mark_returned', 'RETURN_PENDING'],
    ['confirm_return', 'RETURNED'],
    ['settle', 'COMPLETED'],
    ['open_dispute', 'DISPUTED'],
  ];
  const actions: string[] = [];
  for (const [name, target] of candidates) {
    try {
      assertRentalTransition(row.status, target, actor);
      actions.push(name);
    } catch {
      // Not available from here.
    }
  }
  return actions;
}

function toRental(row: RentalRow, viewerId: string) {
  const owner = toPublicUserFromJson(row.owner);
  const renter = toPublicUserFromJson(row.renter);
  if (!owner || !renter) throw new Error('Rental row is missing a participant profile');
  const paymentRow = asJson<PaymentRow | null>(row.payment, null);

  return {
    id: row.id,
    item: toRentalItem(asJson<ItemRow>(row.item, {} as ItemRow)),
    owner,
    renter,
    status: row.status,
    startAt: toIsoOrNull(row.start_at),
    expectedReturnAt: toIso(row.expected_return_at),
    actualReturnAt: toIsoOrNull(row.actual_return_at),
    units: row.units,
    rentalFeePaise: toNumber(row.rental_fee_paise),
    depositPaise: toNumber(row.deposit_paise),
    depositReturnedPaise:
      row.deposit_returned_paise === null ? null : toNumber(row.deposit_returned_paise),
    damageNote: row.damage_note,
    payment: paymentRow && paymentRow.id ? toPayment(paymentRow, viewerId) : null,
    createdAt: toIso(row.created_at),
    availableActions: rentalActions(row, viewerId),
  };
}

/** Rental periods are billed in whole units, always rounding up. */
export function computeUnits(startAt: Date, endAt: Date, unit: string): number {
  const ms = endAt.getTime() - startAt.getTime();
  const divisor = unit === 'HOUR' ? 3_600_000 : unit === 'WEEK' ? 604_800_000 : 86_400_000;
  return Math.max(1, Math.ceil(ms / divisor));
}

export async function rentalRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------- rental items
  app.get('/rental-items', async (request) => {
    const user = requireVerified(request);
    const query = parseOrThrow(itemListQuery, request.query ?? {});

    return withUserTx(request.db, user, async (tx) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      const add = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };

      if (query.scope === 'MINE') conditions.push(`i.owner_id = ${add(user.id)}`);
      else {
        conditions.push(`i.status <> 'UNLISTED'`);
        if (query.availableOnly) conditions.push(`i.status = 'AVAILABLE'`);
      }
      if (query.categorySlug) conditions.push(`i.category_slug = ${add(query.categorySlug)}`);
      if (query.q) {
        const term = add(query.q);
        conditions.push(
          `(to_tsvector('english', i.name || ' ' || i.description) @@ plainto_tsquery('english', ${term})
            OR i.name ILIKE '%' || ${term} || '%')`,
        );
      }

      const limit = add(query.limit + 1);
      const offset = add(query.offset);
      const { rows } = await tx.query<ItemRow>(
        `${ITEM_SELECT} WHERE ${conditions.join(' AND ')}
          ORDER BY i.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const hasMore = rows.length > query.limit;
      return { items: (hasMore ? rows.slice(0, query.limit) : rows).map(toRentalItem), hasMore };
    });
  });

  app.get('/rental-items/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(itemParams, request.params);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
      if (!rows[0]) throw ApiError.notFound('That item is not available.');
      return { item: toRentalItem(rows[0]) };
    });
  });

  app.post('/rental-items', async (request, reply) => {
    const user = requireVerified(request);
    const body = parseOrThrow(createRentalItemSchema, request.body);

    const item = await withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO rental_items (campus_id, owner_id, name, description, category_slug,
                                   condition, price_paise, rental_unit, deposit_paise,
                                   pickup_zone, rules, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'AVAILABLE') RETURNING id`,
        [
          user.campusId,
          user.id,
          body.name,
          body.description,
          body.categorySlug,
          body.condition,
          body.pricePaise,
          body.rentalUnit,
          body.depositPaise,
          body.pickupZone ?? null,
          body.rules ?? null,
        ],
      );
      const itemId = rows[0].id;
      for (const [index, attachmentId] of body.imageIds.entries()) {
        await tx.query(
          `INSERT INTO rental_item_images (item_id, attachment_id, sort_order)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [itemId, attachmentId, index],
        );
      }
      const created = await tx.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [itemId]);
      return toRentalItem(created.rows[0]);
    });

    return reply.code(201).send({ item });
  });

  app.delete('/rental-items/:id', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(itemParams, request.params);

    await withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        'SELECT status FROM rental_items WHERE id = $1 AND owner_id = $2 FOR UPDATE',
        [id, user.id],
      );
      if (!rows[0]) throw ApiError.notFound('That item is not available.');
      if (rows[0].status !== 'AVAILABLE') {
        throw ApiError.conflict('You cannot unlist an item that is currently rented out.', 'ITEM_IN_USE');
      }
      await tx.query(`UPDATE rental_items SET status = 'UNLISTED' WHERE id = $1`, [id]);
    });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ rentals
  app.get('/rentals', async (request) => {
    const user = requireVerified(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<RentalRow>(
        `${RENTAL_SELECT} WHERE r.owner_id = $1 OR r.renter_id = $1
          ORDER BY r.created_at DESC LIMIT 100`,
        [user.id],
      );
      return { rentals: rows.map((row) => toRental(row, user.id)) };
    });
  });

  app.get('/rentals/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(rentalParams, request.params);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<RentalRow>(`${RENTAL_SELECT} WHERE r.id = $1`, [id]);
      if (!rows[0]) throw ApiError.notFound('That rental is not available.');
      return { rental: toRental(rows[0], user.id) };
    });
  });

  /** A student asks to borrow an item. The fee is computed server-side. */
  app.post('/rentals', async (request, reply) => {
    const user = requireVerified(request);
    const body = parseOrThrow(createRentalRequestSchema, request.body);

    const rental = await withUserTx(request.db, user, async (tx, outbox) => {
      // Read without FOR UPDATE: the renter does not own this row, so the update
      // policy would filter it out of a locking read. Double-booking is prevented
      // by the partial unique index on live rentals rather than by a lock here.
      const { rows } = await tx.query<{
        id: string;
        owner_id: string;
        campus_id: string;
        price_paise: number;
        deposit_paise: number;
        rental_unit: string;
        status: string;
        name: string;
      }>(
        `SELECT id, owner_id, campus_id, price_paise, deposit_paise, rental_unit, status, name
           FROM rental_items WHERE id = $1`,
        [body.itemId],
      );
      const item = rows[0];
      if (!item) throw ApiError.notFound('That item is not available.');
      if (item.owner_id === user.id) throw ApiError.badRequest('You cannot rent your own item.');
      if (item.status !== 'AVAILABLE') {
        throw ApiError.conflict('That item is not available right now.', 'ITEM_UNAVAILABLE');
      }

      const startAt = new Date(body.startAt);
      const endAt = new Date(body.expectedReturnAt);
      const units = computeUnits(startAt, endAt, item.rental_unit);
      // Price is derived from the stored item, never from the client (spec §95).
      const fee = units * Number(item.price_paise);

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO rentals (campus_id, item_id, owner_id, renter_id, status, start_at,
                              expected_return_at, units, rental_fee_paise, deposit_paise, message)
         VALUES ($1,$2,$3,$4,'REQUESTED',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          item.campus_id,
          item.id,
          item.owner_id,
          user.id,
          startAt,
          endAt,
          units,
          fee,
          item.deposit_paise,
          body.message ?? null,
        ],
      );
      const rentalId = inserted.rows[0].id;

      await recordRentalEvent(tx, rentalId, null, 'REQUESTED', 'request', user.id, 'HELPER');
      await notify(
        tx,
        {
          userId: item.owner_id,
          campusId: item.campus_id,
          type: 'RENTAL_REQUESTED',
          title: 'Rental request',
          body: `${user.fullName} wants to borrow your ${item.name} for ${units} ${item.rental_unit.toLowerCase()}(s) — ${formatINR(fee)}.`,
          data: { rentalId, itemId: item.id },
          preference: 'rentals',
          important: true,
        },
        outbox,
      );

      const created = await tx.query<RentalRow>(`${RENTAL_SELECT} WHERE r.id = $1`, [rentalId]);
      return toRental(created.rows[0], user.id);
    });

    return reply.code(201).send({ rental });
  });

  registerRentalTransition(app, 'accept', 'RESERVED', 'OWNER', {
    title: 'Rental accepted',
    body: (name) => `Your request to borrow the ${name} was accepted.`,
  });
  registerRentalTransition(app, 'decline', 'DECLINED', 'OWNER', {
    title: 'Rental declined',
    body: (name) => `Your request to borrow the ${name} was declined.`,
  });
  // Before the owner accepts, only the renter can withdraw; once reserved, either
  // side may call it off before pickup. The state machine tells the two apart.
  registerRentalTransition(app, 'cancel', 'CANCELLED', 'EITHER', {
    title: 'Rental cancelled',
    body: (name) => `The rental of the ${name} was cancelled.`,
  });
  registerRentalTransition(app, 'confirm-pickup', 'RENTED', 'OWNER', {
    title: 'Rental started',
    body: (name) => `You now have the ${name}. Return it by the agreed time.`,
    patch: () => ({ start_at: new Date() }),
  });
  registerRentalTransition(app, 'mark-returned', 'RETURN_PENDING', 'RENTER', {
    title: 'Item returned',
    body: (name) => `Your ${name} has been handed back. Confirm to settle the deposit.`,
    patch: () => ({ actual_return_at: new Date() }),
  });

  /** The owner confirms the item is back and settles the deposit (spec §42). */
  app.post('/rentals/:id/confirm-return', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(rentalParams, request.params);
    const body = parseOrThrow(confirmReturnSchema, request.body ?? {});

    return withUserTx(request.db, user, async (tx, outbox) => {
      const rental = await lockRental(tx, id);
      if (rental.owner_id !== user.id) {
        throw ApiError.forbidden('Only the owner can confirm the item came back.');
      }
      assertRentalTransition(rental.status, 'RETURNED', 'REQUESTER');

      const depositReturned = body.depositReturnedPaise ?? Number(rental.deposit_paise);
      if (depositReturned > Number(rental.deposit_paise)) {
        throw ApiError.badRequest('You cannot return more than the deposit that was taken.');
      }

      await tx.query(
        `UPDATE rentals SET status = 'RETURNED', deposit_returned_paise = $2, damage_note = $3
          WHERE id = $1`,
        [id, depositReturned, body.damageNote ?? null],
      );
      await recordRentalEvent(tx, id, rental.status, 'RETURNED', 'confirm_return', user.id, 'REQUESTER');

      // Settling is a separate, explicit step so the deposit outcome is visible.
      await tx.query(`UPDATE rentals SET status = 'COMPLETED' WHERE id = $1`, [id]);
      await recordRentalEvent(tx, id, 'RETURNED', 'COMPLETED', 'settle_deposit', user.id, 'REQUESTER');

      const withheld = Number(rental.deposit_paise) - depositReturned;
      await notify(
        tx,
        {
          userId: rental.renter_id,
          campusId: rental.campus_id,
          type: 'RENTAL_COMPLETED',
          title: 'Rental completed',
          body:
            withheld > 0
              ? `Return confirmed. ${formatINR(withheld)} of your deposit was withheld${body.damageNote ? `: ${body.damageNote}` : '.'}`
              : 'Return confirmed and your full deposit was released.',
          data: { rentalId: id },
          preference: 'rentals',
          important: true,
        },
        outbox,
      );
      outbox.add(() => publish(rentalChannel(id), 'RENTAL_COMPLETED', { rentalId: id }));

      const updated = await tx.query<RentalRow>(`${RENTAL_SELECT} WHERE r.id = $1`, [id]);
      return { rental: toRental(updated.rows[0], user.id) };
    });
  });
}

interface LockedRental {
  id: string;
  campus_id: string;
  status: RentalStatus;
  owner_id: string;
  renter_id: string;
  deposit_paise: number;
  item_name: string;
}

async function lockRental(tx: Queryable, rentalId: string): Promise<LockedRental> {
  const { rows } = await tx.query<LockedRental>(
    `SELECT r.id, r.campus_id, r.status, r.owner_id, r.renter_id, r.deposit_paise,
            i.name AS item_name
       FROM rentals r JOIN rental_items i ON i.id = r.item_id
      WHERE r.id = $1 FOR UPDATE OF r`,
    [rentalId],
  );
  if (!rows[0]) throw ApiError.notFound('That rental is not available.');
  return rows[0];
}

async function recordRentalEvent(
  tx: Queryable,
  rentalId: string,
  from: string | null,
  to: string,
  action: string,
  actorId: string,
  actorRole: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO rental_events (rental_id, from_status, to_status, action, actor_id, actor_role)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [rentalId, from, to, action, actorId, actorRole],
  );
}

function registerRentalTransition(
  app: FastifyInstance,
  path: string,
  to: RentalStatus,
  side: 'OWNER' | 'RENTER' | 'EITHER',
  message: { title: string; body: (itemName: string) => string; patch?: () => Record<string, unknown> },
): void {
  app.post(`/rentals/:id/${path}`, async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(rentalParams, request.params);

    return withUserTx(request.db, user, async (tx, outbox: Outbox) => {
      const rental = await lockRental(tx, id);
      const isOwner = rental.owner_id === user.id;
      const isRenter = rental.renter_id === user.id;
      // Only the two students in a rental act on it. Staff can read rentals, but
      // settle disputes from the admin panel rather than acting as either side.
      if (!isOwner && !isRenter) throw ApiError.forbidden('You are not part of this rental.');
      if (side === 'OWNER' && !isOwner) throw ApiError.forbidden('Only the item owner can do that.');
      if (side === 'RENTER' && !isRenter) throw ApiError.forbidden('Only the renter can do that.');

      const actor = isOwner ? 'REQUESTER' : 'HELPER';
      // The state machine decides whether the move is legal, and what it is called.
      const { action } = assertRentalTransition(rental.status, to, actor);

      const patch = message.patch?.() ?? {};
      const columns = Object.keys(patch);
      const assignments = columns.map((column, index) => `, ${column} = $${index + 3}`).join('');
      await tx.query(`UPDATE rentals SET status = $2${assignments} WHERE id = $1`, [
        id,
        to,
        ...columns.map((column) => patch[column]),
      ]);
      await recordRentalEvent(tx, id, rental.status, to, action, user.id, actor);

      const counterpartyId = isOwner ? rental.renter_id : rental.owner_id;
      await notify(
        tx,
        {
          userId: counterpartyId,
          campusId: rental.campus_id,
          type: to === 'RENTED' ? 'RENTAL_STARTED' : to === 'RETURN_PENDING' ? 'RENTAL_RETURNED' : 'RENTAL_ACCEPTED',
          title: message.title,
          body: message.body(rental.item_name),
          data: { rentalId: id },
          preference: 'rentals',
          important: true,
        },
        outbox,
      );
      outbox.add(() => publish(rentalChannel(id), 'RENTAL_ACCEPTED', { rentalId: id, status: to }));

      const updated = await tx.query<RentalRow>(`${RENTAL_SELECT} WHERE r.id = $1`, [id]);
      return { rental: toRental(updated.rows[0], user.id) };
    });
  });
}
