import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RentalStatus } from '@campusbuddy/shared';
import {
  addDisputeEvidenceSchema,
  assertRentalTransition,
  createDisputeSchema,
  createReportSchema,
} from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { enforceRateLimit, RATE_LIMITS } from '../../core/rate-limit.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import {
  toAttachmentFromJson,
  toIso,
  toIsoOrNull,
  toPublicUserFromJson,
} from '../../core/serializers.js';
import type { Queryable } from '../../db/client.js';
import { applyTransition, lockRequest } from '../requests/service.js';
import { notify } from '../notifications/service.js';

/**
 * Reports and disputes (spec §61, §62).
 *
 * A report is about content or conduct and goes to moderators. A dispute is about a
 * specific transaction and freezes it: opening one moves the request to DISPUTED, so
 * no payment can quietly complete while the disagreement is unresolved.
 */

const idParams = z.object({ id: z.string().uuid() });

const DISPUTE_SELECT = `
  SELECT d.id, d.subject_type, d.subject_id, d.reason, d.description, d.status,
         d.resolution, d.created_at, d.resolved_at,
         to_jsonb(op) AS opened_by,
         CASE WHEN ap.id IS NOT NULL THEN to_jsonb(ap) END AS against,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', e.id, 'note', e.note, 'created_at', e.created_at,
                   'submitted_by', to_jsonb(ep),
                   'attachment', CASE WHEN ea.id IS NOT NULL THEN jsonb_build_object(
                     'id', ea.id, 'file_name', ea.file_name,
                     'mime_type', ea.mime_type, 'size_bytes', ea.size_bytes) END)
                 ORDER BY e.created_at), '[]'::jsonb)
            FROM dispute_evidence e
            JOIN public_user_profiles ep ON ep.id = e.submitted_by
            LEFT JOIN attachments ea ON ea.id = e.attachment_id
           WHERE e.dispute_id = d.id) AS evidence
    FROM disputes d
    JOIN public_user_profiles op ON op.id = d.opened_by
    LEFT JOIN public_user_profiles ap ON ap.id = d.against_id
`;

interface DisputeRow {
  id: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  description: string;
  status: string;
  resolution: string | null;
  created_at: Date;
  resolved_at: Date | null;
  opened_by: unknown;
  against: unknown;
  evidence: unknown;
}

export function toDispute(row: DisputeRow) {
  const openedBy = toPublicUserFromJson(row.opened_by);
  if (!openedBy) throw new Error('Dispute row is missing its author profile');
  const evidence = Array.isArray(row.evidence) ? (row.evidence as Record<string, unknown>[]) : [];
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    openedBy,
    against: toPublicUserFromJson(row.against),
    reason: row.reason,
    description: row.description,
    status: row.status,
    resolution: row.resolution,
    evidence: evidence.map((item) => ({
      id: String(item.id),
      submittedBy: toPublicUserFromJson(item.submitted_by),
      note: (item.note as string | null) ?? null,
      // A signed link, so the evidence opens in the browser like any other file.
      attachment: toAttachmentFromJson(item.attachment),
      createdAt: toIso(item.created_at),
    })),
    createdAt: toIso(row.created_at),
    resolvedAt: toIsoOrNull(row.resolved_at),
  };
}

/** Works out who a transaction dispute is against, from the transaction itself. */
async function resolveCounterparty(
  tx: Queryable,
  subjectType: string,
  subjectId: string,
  openerId: string,
): Promise<{ againstId: string | null; campusId: string }> {
  if (subjectType === 'REQUEST') {
    const { rows } = await tx.query<{
      campus_id: string;
      requester_id: string;
      selected_helper_id: string | null;
    }>('SELECT campus_id, requester_id, selected_helper_id FROM requests WHERE id = $1', [subjectId]);
    const row = rows[0];
    if (!row) throw ApiError.notFound('That request is not available.');
    if (row.requester_id !== openerId && row.selected_helper_id !== openerId) {
      throw ApiError.forbidden('Only the two students involved can open a dispute.');
    }
    return {
      againstId: row.requester_id === openerId ? row.selected_helper_id : row.requester_id,
      campusId: row.campus_id,
    };
  }

  if (subjectType === 'RENTAL') {
    const { rows } = await tx.query<{ campus_id: string; owner_id: string; renter_id: string }>(
      'SELECT campus_id, owner_id, renter_id FROM rentals WHERE id = $1',
      [subjectId],
    );
    const row = rows[0];
    if (!row) throw ApiError.notFound('That rental is not available.');
    if (row.owner_id !== openerId && row.renter_id !== openerId) {
      throw ApiError.forbidden('Only the two students involved can open a dispute.');
    }
    return {
      againstId: row.owner_id === openerId ? row.renter_id : row.owner_id,
      campusId: row.campus_id,
    };
  }

  const { rows } = await tx.query<{ campus_id: string; seller_id: string }>(
    'SELECT campus_id, seller_id FROM listings WHERE id = $1',
    [subjectId],
  );
  const row = rows[0];
  if (!row) throw ApiError.notFound('That listing is not available.');
  return { againstId: row.seller_id, campusId: row.campus_id };
}

export async function moderationRoutes(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------ reports
  app.post('/reports', async (request, reply) => {
    const user = requireVerified(request);
    const body = parseOrThrow(createReportSchema, request.body);
    await enforceRateLimit(
      request.db,
      RATE_LIMITS.report,
      user.id,
      'You have submitted several reports today. A moderator will review them.',
    );

    const report = await withUserTx(request.db, user, async (tx) => {
      if (body.targetType === 'USER' && body.targetId === user.id) {
        throw ApiError.badRequest('You cannot report yourself.');
      }
      const { rows } = await tx.query<{ id: string; created_at: Date }>(
        `INSERT INTO reports (campus_id, reporter_id, target_type, target_id, reason, description)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
        [user.campusId, user.id, body.targetType, body.targetId, body.reason, body.description ?? null],
      );
      return { id: rows[0].id, status: 'OPEN', createdAt: toIso(rows[0].created_at) };
    });

    return reply.code(201).send({ report });
  });

  app.get('/reports/mine', async (request) => {
    const user = requireVerified(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, target_type, target_id, reason, description, status, resolution, created_at
           FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [user.id],
      );
      return { reports: rows };
    });
  });

  app.post('/reports/:id/evidence', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(addDisputeEvidenceSchema, request.body);
    await withUserTx(request.db, user, async (tx) => {
      const report = await tx.query('SELECT 1 FROM reports WHERE id = $1 AND reporter_id = $2', [id, user.id]);
      if (!report.rows[0]) throw ApiError.notFound('That report is not available.');
      await tx.query(
        `INSERT INTO report_evidence (report_id, submitted_by, note, attachment_id)
         VALUES ($1,$2,$3,$4)`,
        [id, user.id, body.note ?? null, body.attachmentId ?? null],
      );
    });
    return reply.code(201).send({ ok: true });
  });

  // ----------------------------------------------------------------- disputes
  app.get('/disputes', async (request) => {
    const user = requireVerified(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<DisputeRow>(
        `${DISPUTE_SELECT} WHERE d.opened_by = $1 OR d.against_id = $1
          ORDER BY d.created_at DESC LIMIT 50`,
        [user.id],
      );
      return { disputes: rows.map(toDispute) };
    });
  });

  app.get('/disputes/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<DisputeRow>(`${DISPUTE_SELECT} WHERE d.id = $1`, [id]);
      if (!rows[0]) throw ApiError.notFound('That dispute is not available.');
      return { dispute: toDispute(rows[0]) };
    });
  });

  /** Opening a dispute freezes the underlying transaction. */
  app.post('/disputes', async (request, reply) => {
    const user = requireVerified(request);
    const body = parseOrThrow(createDisputeSchema, request.body);

    const dispute = await withUserTx(request.db, user, async (tx, outbox) => {
      const { againstId, campusId } = await resolveCounterparty(
        tx,
        body.subjectType,
        body.subjectId,
        user.id,
      );

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO disputes (campus_id, subject_type, subject_id, opened_by, against_id, reason, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [campusId, body.subjectType, body.subjectId, user.id, againstId, body.reason, body.description],
      );
      const disputeId = rows[0].id;

      // Move the request itself into DISPUTED so nothing else can happen to it.
      if (body.subjectType === 'REQUEST') {
        const locked = await lockRequest(tx, body.subjectId);
        const actor = locked.requester_id === user.id ? 'REQUESTER' : 'HELPER';
        await applyTransition(tx, locked, 'DISPUTED', 'open_dispute', actor, user.id, {
          note: body.reason,
        });
      }
      if (body.subjectType === 'RENTAL') {
        // Through the rental state machine like every other rental change, so a
        // finished or cancelled rental cannot be dragged back into a dispute.
        const { rows: rentalRows } = await tx.query<{ status: RentalStatus; owner_id: string }>(
          'SELECT status, owner_id FROM rentals WHERE id = $1 FOR UPDATE',
          [body.subjectId],
        );
        const rental = rentalRows[0];
        if (!rental) throw ApiError.notFound('That rental is not available.');
        const actor = rental.owner_id === user.id ? 'REQUESTER' : 'HELPER';
        const transition = assertRentalTransition(rental.status, 'DISPUTED', actor);

        await tx.query(`UPDATE rentals SET status = 'DISPUTED' WHERE id = $1`, [body.subjectId]);
        await tx.query(
          `INSERT INTO rental_events (rental_id, from_status, to_status, action, actor_id, actor_role)
           VALUES ($1, $2, 'DISPUTED', $3, $4, $5)`,
          [body.subjectId, rental.status, transition.action, user.id, actor],
        );
      }

      if (againstId) {
        await notify(
          tx,
          {
            userId: againstId,
            campusId,
            type: 'DISPUTE_CREATED',
            title: 'A dispute was opened',
            body: `${user.fullName} opened a dispute: ${body.reason}`,
            data: { disputeId, subjectType: body.subjectType, subjectId: body.subjectId },
            important: true,
          },
          outbox,
        );
      }

      const created = await tx.query<DisputeRow>(`${DISPUTE_SELECT} WHERE d.id = $1`, [disputeId]);
      return toDispute(created.rows[0]);
    });

    return reply.code(201).send({ dispute });
  });

  app.post('/disputes/:id/evidence', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(addDisputeEvidenceSchema, request.body);

    await withUserTx(request.db, user, async (tx) => {
      // RLS only lets a participant insert here; this gives a clearer message.
      const { rows } = await tx.query('SELECT 1 FROM disputes WHERE id = $1', [id]);
      if (rows.length === 0) throw ApiError.notFound('That dispute is not available.');

      await tx.query(
        `INSERT INTO dispute_evidence (dispute_id, submitted_by, note, attachment_id)
         VALUES ($1,$2,$3,$4)`,
        [id, user.id, body.note ?? null, body.attachmentId ?? null],
      );
    });

    return reply.code(201).send({ ok: true });
  });
}
