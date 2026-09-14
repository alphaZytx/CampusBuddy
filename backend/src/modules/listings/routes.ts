import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createListingSchema, LISTING_TYPES } from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import {
  toAttachmentsFromJson,
  toIso,
  toNumber,
  toPublicUserFromJson,
} from '../../core/serializers.js';

/**
 * Student marketplace (spec §43).
 *
 * Buy, sell, exchange and give away, restricted to the campus by the RLS policy on
 * `listings`. Handover is physical, so there is no shipping or escrow to model.
 */

const idParams = z.object({ id: z.string().uuid('Unknown listing') });

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  categorySlug: z.string().optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  maxPricePaise: z.coerce.number().int().nonnegative().optional(),
  scope: z.enum(['ALL', 'MINE']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

const updateListingSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  pricePaise: z.number().int().nonnegative().optional(),
  status: z.enum(['ACTIVE', 'RESERVED', 'SOLD', 'REMOVED']).optional(),
  pickupZone: z.string().trim().max(120).nullish(),
});

const LISTING_SELECT = `
  SELECT l.id, l.campus_id, l.title, l.description, l.category_slug, l.listing_type,
         l.price_paise, l.condition, l.status, l.pickup_zone, l.created_at, l.updated_at,
         to_jsonb(p) AS seller,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', a.id, 'file_name', a.file_name,
                   'mime_type', a.mime_type, 'size_bytes', a.size_bytes)
                 ORDER BY li.sort_order), '[]'::jsonb)
            FROM listing_images li JOIN attachments a ON a.id = li.attachment_id
           WHERE li.listing_id = l.id) AS images
    FROM listings l JOIN public_user_profiles p ON p.id = l.seller_id
`;

interface ListingRow {
  id: string;
  campus_id: string;
  title: string;
  description: string;
  category_slug: string;
  listing_type: string;
  price_paise: string | number;
  condition: string;
  status: string;
  pickup_zone: string | null;
  created_at: Date;
  updated_at: Date;
  seller: unknown;
  images: unknown;
}

function toListing(row: ListingRow) {
  const seller = toPublicUserFromJson(row.seller);
  if (!seller) throw new Error('Listing row is missing its seller profile');
  return {
    id: row.id,
    campusId: row.campus_id,
    seller,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    listingType: row.listing_type,
    pricePaise: toNumber(row.price_paise),
    condition: row.condition,
    status: row.status,
    pickupZone: row.pickup_zone,
    images: toAttachmentsFromJson(row.images),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request) => {
    const user = requireVerified(request);
    const query = parseOrThrow(listQuery, request.query ?? {});

    return withUserTx(request.db, user, async (tx) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      const add = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };

      if (query.scope === 'MINE') conditions.push(`l.seller_id = ${add(user.id)}`);
      else conditions.push(`l.status = 'ACTIVE'`);

      if (query.categorySlug) conditions.push(`l.category_slug = ${add(query.categorySlug)}`);
      if (query.listingType) conditions.push(`l.listing_type = ${add(query.listingType)}`);
      if (query.maxPricePaise !== undefined) {
        conditions.push(`l.price_paise <= ${add(query.maxPricePaise)}`);
      }
      if (query.q) {
        const term = add(query.q);
        conditions.push(
          `(to_tsvector('english', l.title || ' ' || l.description) @@ plainto_tsquery('english', ${term})
            OR l.title ILIKE '%' || ${term} || '%')`,
        );
      }

      const limit = add(query.limit + 1);
      const offset = add(query.offset);
      const { rows } = await tx.query<ListingRow>(
        `${LISTING_SELECT} WHERE ${conditions.join(' AND ')}
          ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      );

      const hasMore = rows.length > query.limit;
      return {
        listings: (hasMore ? rows.slice(0, query.limit) : rows).map(toListing),
        hasMore,
      };
    });
  });

  app.get('/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<ListingRow>(`${LISTING_SELECT} WHERE l.id = $1`, [id]);
      if (!rows[0]) throw ApiError.notFound('That listing is not available.');
      return { listing: toListing(rows[0]) };
    });
  });

  app.post('/', async (request, reply) => {
    const user = requireVerified(request);
    const body = parseOrThrow(createListingSchema, request.body);

    const listing = await withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO listings (campus_id, seller_id, title, description, category_slug,
                               listing_type, price_paise, condition, pickup_zone, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE') RETURNING id`,
        [
          user.campusId,
          user.id,
          body.title,
          body.description,
          body.categorySlug,
          body.listingType,
          // A giveaway is free by definition; the DB check constraint agrees.
          body.listingType === 'GIVEAWAY' ? 0 : body.pricePaise,
          body.condition,
          body.pickupZone ?? null,
        ],
      );
      const listingId = rows[0].id;

      for (const [index, attachmentId] of body.imageIds.entries()) {
        await tx.query(
          `INSERT INTO listing_images (listing_id, attachment_id, sort_order)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [listingId, attachmentId, index],
        );
      }

      const created = await tx.query<ListingRow>(`${LISTING_SELECT} WHERE l.id = $1`, [listingId]);
      return toListing(created.rows[0]);
    });

    return reply.code(201).send({ listing });
  });

  app.patch('/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(updateListingSchema, request.body);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{ seller_id: string; listing_type: string }>(
        'SELECT seller_id, listing_type FROM listings WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!rows[0]) throw ApiError.notFound('That listing is not available.');
      if (rows[0].seller_id !== user.id) {
        throw ApiError.forbidden('You can only edit your own listings.');
      }
      if (body.pricePaise !== undefined && rows[0].listing_type === 'GIVEAWAY' && body.pricePaise !== 0) {
        throw ApiError.badRequest('A giveaway cannot have a price.');
      }

      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (body.pricePaise !== undefined) patch.price_paise = body.pricePaise;
      if (body.status !== undefined) patch.status = body.status;
      if (body.pickupZone !== undefined) patch.pickup_zone = body.pickupZone;

      const columns = Object.keys(patch);
      if (columns.length > 0) {
        const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
        await tx.query(`UPDATE listings SET ${assignments.join(', ')} WHERE id = $1`, [
          id,
          ...columns.map((column) => patch[column]),
        ]);
      }

      const updated = await tx.query<ListingRow>(`${LISTING_SELECT} WHERE l.id = $1`, [id]);
      return { listing: toListing(updated.rows[0]) };
    });
  });

  app.delete('/:id', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);

    await withUserTx(request.db, user, async (tx) => {
      // Soft removal keeps history intact for any conversation that referenced it.
      const { rowCount } = await tx.query(
        `UPDATE listings SET status = 'REMOVED' WHERE id = $1 AND seller_id = $2`,
        [id, user.id],
      );
      if (rowCount === 0) throw ApiError.notFound('That listing is not available.');
    });
    return reply.code(204).send();
  });
}
