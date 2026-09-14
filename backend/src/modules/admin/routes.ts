import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  adminUpdateUserSchema,
  resolveDisputeSchema,
  updateReportSchema,
} from '@campusbuddy/shared';
import { clientIp, requireAdmin, requireStaff } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withServiceTx } from '../../core/outbox.js';
import { recordAudit } from '../../core/audit.js';
import { toAttachmentFromJson, toIso, toNumber } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { applyTransition, ensurePaymentForRequest, lockRequest } from '../requests/service.js';
import { disconnectUser } from '../../realtime/hub.js';
import { getCampus } from '../../db/bootstrap.js';

/**
 * Admin and moderation surface (spec §59, §88).
 *
 * Every handler re-checks the caller's role server-side, and every state-changing
 * action writes an audit record. Admin work runs in the service context because a
 * moderator legitimately needs to see rows that RLS hides from students — which is
 * exactly why it is gated and logged.
 */

const idParams = z.object({ id: z.string().uuid() });

const userListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  verified: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const reportListQuery = z.object({
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ESCALATED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const moderationActionSchema = z.object({
  actionType: z.enum(['WARNING', 'STRIKE', 'SUSPENSION', 'RESTRICTION', 'NOTE']),
  reason: z.string().trim().min(3).max(2000),
  points: z.number().int().min(0).max(100).default(0),
  expiresAt: z.string().datetime().nullish(),
});
const appealUpdateSchema = z.object({
  status: z.enum(['UPHELD', 'OVERTURNED']),
  resolution: z.string().trim().min(3).max(2000),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- analytics
  app.get('/analytics', async (request) => {
    const staff = requireStaff(request);
    const campus = await getCampus(request.db);
    const db = request.db;

    const [totals, requests, categories, rentals, byDay] = await Promise.all([
      db.query<{
        registered: string;
        verified: string;
        active_7d: string;
        suspended: string;
      }>(
        `SELECT count(*)::text AS registered,
                count(*) FILTER (WHERE is_verified)::text AS verified,
                count(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::text AS active_7d,
                count(*) FILTER (WHERE account_status = 'SUSPENDED')::text AS suspended
           FROM users WHERE campus_id = $1 AND deleted_at IS NULL`,
        [campus.campusId],
      ),
      db.query<{
        created: string;
        completed: string;
        cancelled: string;
        disputed: string;
        avg_reward: string | null;
        avg_minutes: string | null;
      }>(
        `SELECT count(*)::text AS created,
                count(*) FILTER (WHERE status IN ('PAID','RATED'))::text AS completed,
                count(*) FILTER (WHERE status = 'CANCELLED')::text AS cancelled,
                count(*) FILTER (WHERE status = 'DISPUTED')::text AS disputed,
                avg(reward_paise)::text AS avg_reward,
                avg(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)
                  FILTER (WHERE completed_at IS NOT NULL)::text AS avg_minutes
           FROM requests WHERE campus_id = $1`,
        [campus.campusId],
      ),
      db.query<{ category_slug: string; count: string }>(
        `SELECT category_slug, count(*)::text AS count FROM requests
          WHERE campus_id = $1 GROUP BY category_slug ORDER BY count(*) DESC LIMIT 10`,
        [campus.campusId],
      ),
      db.query<{ active: string; completed: string }>(
        `SELECT count(*) FILTER (WHERE status IN ('RESERVED','RENTED','RETURN_PENDING'))::text AS active,
                count(*) FILTER (WHERE status = 'COMPLETED')::text AS completed
           FROM rentals WHERE campus_id = $1`,
        [campus.campusId],
      ),
      db.query<{ day: string; count: string }>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::text AS count
           FROM requests
          WHERE campus_id = $1 AND created_at > now() - interval '30 days'
          GROUP BY 1 ORDER BY 1`,
        [campus.campusId],
      ),
    ]);

    const open = await db.query<{ reports: string; disputes: string }>(
      `SELECT (SELECT count(*)::text FROM reports  WHERE campus_id = $1 AND status IN ('OPEN','UNDER_REVIEW')) AS reports,
              (SELECT count(*)::text FROM disputes WHERE campus_id = $1 AND status IN ('OPEN','UNDER_REVIEW')) AS disputes`,
      [campus.campusId],
    );

    const created = Number(requests.rows[0].created);
    const completed = Number(requests.rows[0].completed);
    const cancelled = Number(requests.rows[0].cancelled);
    const disputed = Number(requests.rows[0].disputed);

    return {
      registeredStudents: Number(totals.rows[0].registered),
      verifiedStudents: Number(totals.rows[0].verified),
      activeUsers7d: Number(totals.rows[0].active_7d),
      suspendedStudents: Number(totals.rows[0].suspended),
      requestsCreated: created,
      requestsCompleted: completed,
      // Guarded against division by zero on a fresh deployment.
      completionRate: created > 0 ? completed / created : 0,
      cancellationRate: created > 0 ? cancelled / created : 0,
      disputeRate: created > 0 ? disputed / created : 0,
      averageRewardPaise: Math.round(Number(requests.rows[0].avg_reward ?? 0)),
      averageCompletionMinutes: requests.rows[0].avg_minutes
        ? Math.round(Number(requests.rows[0].avg_minutes))
        : null,
      openReports: Number(open.rows[0].reports),
      openDisputes: Number(open.rows[0].disputes),
      popularCategories: categories.rows.map((row) => ({
        categorySlug: row.category_slug,
        count: Number(row.count),
      })),
      rentalsActive: Number(rentals.rows[0].active),
      rentalsCompleted: Number(rentals.rows[0].completed),
      requestsByDay: byDay.rows.map((row) => ({ day: row.day, count: Number(row.count) })),
      viewedBy: staff.fullName,
    };
  });

  // -------------------------------------------------------------------- users
  app.get('/users', async (request) => {
    requireStaff(request);
    const query = parseOrThrow(userListQuery, request.query ?? {});
    const campus = await getCampus(request.db);

    const conditions = ['u.campus_id = $1', 'u.deleted_at IS NULL'];
    const params: unknown[] = [campus.campusId];
    const add = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (query.status) conditions.push(`u.account_status = ${add(query.status)}`);
    if (query.verified) conditions.push(`u.is_verified = ${add(query.verified === 'true')}`);
    if (query.q) {
      const term = add(query.q);
      conditions.push(`(u.full_name ILIKE '%' || ${term} || '%' OR u.email ILIKE '%' || ${term} || '%')`);
    }

    const limit = add(query.limit);
    const offset = add(query.offset);
    const { rows } = await request.db.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.account_status, u.suspension_reason,
              u.is_verified, u.verification_method, u.average_rating, u.rating_count,
              u.completed_tasks, u.cancelled_tasks, u.disputed_tasks, u.reliability_score,
              u.total_earned_paise, u.created_at, u.last_seen_at, d.code AS department_code
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return {
      users: rows.map((row) => ({
        ...row,
        total_earned_paise: toNumber(row.total_earned_paise),
        created_at: toIso(row.created_at),
      })),
    };
  });

  /** Suspend, reinstate or change a student's role. Admin-only and audited. */
  app.patch('/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(adminUpdateUserSchema, request.body);

    if (id === admin.id && body.role && body.role !== admin.role) {
      throw ApiError.badRequest('You cannot change your own role.');
    }
    // Only a platform admin can mint another platform admin.
    if (body.role === 'PLATFORM_ADMIN' && admin.role !== 'PLATFORM_ADMIN') {
      throw ApiError.forbidden('Only a platform administrator can grant that role.');
    }

    if (id === admin.id && body.accountStatus && body.accountStatus !== 'ACTIVE') {
      throw ApiError.badRequest('You cannot suspend or deactivate your own account.');
    }

    return withServiceTx(request.db, async (tx, outbox) => {
      const { rows } = await tx.query<{ campus_id: string; full_name: string; role: string }>(
        'SELECT campus_id, full_name, role FROM users WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!rows[0]) throw ApiError.notFound('That student does not exist.');
      if (rows[0].campus_id !== admin.campusId) {
        throw ApiError.forbidden('That student is not on your campus.');
      }
      // A campus admin must not be able to demote or lock out the platform
      // administrator who appointed them.
      if (rows[0].role === 'PLATFORM_ADMIN' && admin.role !== 'PLATFORM_ADMIN') {
        throw ApiError.forbidden(
          'Only a platform administrator can change a platform administrator’s account.',
        );
      }

      await tx.query(
        `UPDATE users
            SET account_status    = COALESCE($2, account_status),
                role              = COALESCE($3, role),
                suspension_reason = CASE WHEN $2 = 'SUSPENDED' THEN $4 ELSE NULL END
          WHERE id = $1`,
        [id, body.accountStatus ?? null, body.role ?? null, body.suspensionReason ?? null],
      );

      if (body.accountStatus === 'SUSPENDED' || body.accountStatus === 'DEACTIVATED') {
        // Signed out everywhere immediately, including any open realtime connection
        // that would otherwise keep receiving campus events.
        await tx.query(
          'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [id],
        );
        outbox.add(() => disconnectUser(id));
      }

      if (body.accountStatus === 'SUSPENDED') {
        await notify(
          tx,
          {
            userId: id,
            campusId: admin.campusId,
            type: 'REPORT_CREATED',
            title: 'Your account has been suspended',
            body: body.suspensionReason ?? 'Contact the campus administrator for details.',
            important: true,
          },
          outbox,
        );
      }

      await recordAudit(tx, {
        actorId: admin.id,
        actorRole: admin.role,
        action: 'admin.update_user',
        entityType: 'user',
        entityId: id,
        metadata: { accountStatus: body.accountStatus, role: body.role },
        ipAddress: clientIp(request),
      });

      return { ok: true };
    });
  });

  app.post('/users/:id/moderation-actions', async (request, reply) => {
    const staff = requireStaff(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(moderationActionSchema, request.body);
    const actionId = await withServiceTx(request.db, async (tx, outbox) => {
      const result = await tx.query<{ id: string }>(
        `INSERT INTO moderation_actions (campus_id, user_id, action_type, reason, points, expires_at, created_by)
         SELECT $1, id, $3, $4, $5, $6, $7 FROM users WHERE id = $2 AND campus_id = $1
         RETURNING id`,
        [staff.campusId, id, body.actionType, body.reason, body.points, body.expiresAt ?? null, staff.id],
      );
      if (!result.rows[0]) throw ApiError.notFound('That student does not exist.');
      await notify(tx, {
        userId: id,
        campusId: staff.campusId,
        type: 'REPORT_CREATED',
        title: `Moderation ${body.actionType.toLowerCase()}`,
        body: body.reason,
        important: true,
      }, outbox);
      await recordAudit(tx, {
        actorId: staff.id, actorRole: staff.role, action: 'admin.create_moderation_action',
        entityType: 'moderation_action', entityId: result.rows[0].id,
        metadata: { userId: id, actionType: body.actionType, points: body.points },
        ipAddress: clientIp(request),
      });
      return result.rows[0].id;
    });
    return reply.code(201).send({ id: actionId });
  });

  app.get('/safety', async (request) => {
    const staff = requireStaff(request);
    const [signals, appeals] = await Promise.all([
      request.db.query(
        `SELECT s.id, s.user_id, u.full_name AS user_name, s.signal_type, s.score,
                s.details, s.status, s.detected_at
           FROM abuse_signals s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.campus_id = $1 AND s.status = 'OPEN'
          ORDER BY s.score DESC, s.detected_at DESC LIMIT 100`,
        [staff.campusId],
      ),
      request.db.query(
        `SELECT ap.id, ap.statement, ap.status, ap.created_at, u.full_name AS user_name,
                ma.action_type, ma.reason AS action_reason
           FROM moderation_appeals ap
           JOIN moderation_actions ma ON ma.id = ap.moderation_action_id
           JOIN users u ON u.id = ap.user_id
          WHERE ma.campus_id = $1 AND ap.status = 'OPEN'
          ORDER BY ap.created_at LIMIT 100`,
        [staff.campusId],
      ),
    ]);
    return { signals: signals.rows, appeals: appeals.rows };
  });

  app.patch('/safety/signals/:id', async (request) => {
    const staff = requireStaff(request);
    const { id } = parseOrThrow(z.object({ id: z.coerce.number().int().positive() }), request.params);
    const body = parseOrThrow(z.object({ status: z.enum(['REVIEWED', 'DISMISSED']) }), request.body);
    return withServiceTx(request.db, async (tx) => {
      const result = await tx.query(
        `UPDATE abuse_signals SET status = $2 WHERE id = $1 AND campus_id = $3`,
        [id, body.status, staff.campusId],
      );
      if (result.rowCount === 0) throw ApiError.notFound('That signal is not available.');
      await recordAudit(tx, {
        actorId: staff.id, actorRole: staff.role, action: 'admin.review_risk_signal',
        entityType: 'abuse_signal', metadata: { id, status: body.status },
        ipAddress: clientIp(request),
      });
      return { ok: true };
    });
  });

  app.patch('/safety/appeals/:id', async (request) => {
    const staff = requireStaff(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(appealUpdateSchema, request.body);
    return withServiceTx(request.db, async (tx) => {
      const result = await tx.query(
        `UPDATE moderation_appeals ap SET status = $2, resolution = $3, reviewed_by = $4,
                reviewed_at = now()
          FROM moderation_actions ma
         WHERE ap.id = $1 AND ma.id = ap.moderation_action_id AND ma.campus_id = $5`,
        [id, body.status, body.resolution, staff.id, staff.campusId],
      );
      if (result.rowCount === 0) throw ApiError.notFound('That appeal is not available.');
      await recordAudit(tx, {
        actorId: staff.id, actorRole: staff.role, action: 'admin.resolve_appeal',
        entityType: 'moderation_appeal', entityId: id, metadata: { status: body.status },
        ipAddress: clientIp(request),
      });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ reports
  app.get('/reports', async (request) => {
    requireStaff(request);
    const query = parseOrThrow(reportListQuery, request.query ?? {});
    const campus = await getCampus(request.db);

    const params: unknown[] = [campus.campusId, query.limit];
    const filter = query.status ? 'AND r.status = $3' : '';
    if (query.status) params.push(query.status);

    const { rows } = await request.db.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.description, r.status,
              r.resolution, r.created_at, r.sla_due_at, r.escalated_at,
              u.full_name AS reporter_name, u.id AS reporter_id,
              (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', e.id, 'note', e.note, 'created_at', e.created_at,
                'attachment', CASE WHEN a.id IS NOT NULL THEN to_jsonb(a) END
              ) ORDER BY e.created_at), '[]'::jsonb)
                 FROM report_evidence e LEFT JOIN attachments a ON a.id = e.attachment_id
                WHERE e.report_id = r.id) AS evidence
         FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
        WHERE r.campus_id = $1 ${filter}
        ORDER BY CASE r.status WHEN 'OPEN' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 ELSE 2 END,
                 r.created_at DESC
        LIMIT $2`,
      params,
    );
    return { reports: rows.map((row) => ({
      ...row,
      created_at: toIso(row.created_at),
      evidence: (Array.isArray(row.evidence) ? row.evidence : []).map((item: Record<string, unknown>) => ({
        id: item.id, note: item.note ?? null, createdAt: toIso(item.created_at),
        attachment: toAttachmentFromJson(item.attachment),
      })),
    })) };
  });

  app.patch('/reports/:id', async (request) => {
    const staff = requireStaff(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(updateReportSchema, request.body);

    return withServiceTx(request.db, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE reports SET status = $2, resolution = $3, reviewed_by = $4, reviewed_at = now()
          WHERE id = $1 AND campus_id = $5`,
        [id, body.status, body.resolution ?? null, staff.id, staff.campusId],
      );
      if (rowCount === 0) throw ApiError.notFound('That report does not exist.');

      await recordAudit(tx, {
        actorId: staff.id,
        actorRole: staff.role,
        action: 'admin.resolve_report',
        entityType: 'report',
        entityId: id,
        metadata: { status: body.status },
        ipAddress: clientIp(request),
      });
      return { ok: true };
    });
  });

  // ----------------------------------------------------------------- disputes
  app.get('/disputes', async (request) => {
    requireStaff(request);
    const campus = await getCampus(request.db);
    const { rows } = await request.db.query(
      `SELECT d.id, d.subject_type, d.subject_id, d.reason, d.description, d.status,
              d.resolution, d.created_at, d.resolved_at, d.sla_due_at, d.escalated_at,
              o.full_name AS opened_by_name, a.full_name AS against_name,
              (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', e.id, 'note', e.note, 'created_at', e.created_at,
                'submitter_name', eu.full_name,
                'attachment', CASE WHEN ea.id IS NOT NULL THEN to_jsonb(ea) END
              ) ORDER BY e.created_at), '[]'::jsonb)
                 FROM dispute_evidence e
                 JOIN users eu ON eu.id = e.submitted_by
                 LEFT JOIN attachments ea ON ea.id = e.attachment_id
                WHERE e.dispute_id = d.id) AS evidence
         FROM disputes d
         JOIN users o ON o.id = d.opened_by
         LEFT JOIN users a ON a.id = d.against_id
        WHERE d.campus_id = $1
        ORDER BY CASE d.status WHEN 'OPEN' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 ELSE 2 END,
                 d.created_at DESC
        LIMIT 100`,
      [campus.campusId],
    );
    return { disputes: rows.map((row) => ({
      ...row,
      created_at: toIso(row.created_at),
      evidence: (Array.isArray(row.evidence) ? row.evidence : []).map((item: Record<string, unknown>) => ({
        id: item.id, note: item.note ?? null, submitterName: item.submitter_name,
        createdAt: toIso(item.created_at), attachment: toAttachmentFromJson(item.attachment),
      })),
    })) };
  });

  /**
   * Resolve a dispute and unfreeze the underlying request.
   *
   * The outcome decides where the request lands: in the helper's favour it returns to
   * PAYMENT_PENDING so they can still be paid; in the requester's favour it is
   * cancelled. Both are legal transitions out of DISPUTED for an ADMIN actor.
   */
  app.patch('/disputes/:id', async (request) => {
    const staff = requireStaff(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(resolveDisputeSchema, request.body);

    return withServiceTx(request.db, async (tx, outbox) => {
      const { rows } = await tx.query<{
        campus_id: string;
        subject_type: string;
        subject_id: string;
        opened_by: string;
        against_id: string | null;
        status: string;
      }>(
        'SELECT campus_id, subject_type, subject_id, opened_by, against_id, status FROM disputes WHERE id = $1 FOR UPDATE',
        [id],
      );
      const dispute = rows[0];
      if (!dispute) throw ApiError.notFound('That dispute does not exist.');
      if (dispute.campus_id !== staff.campusId) {
        throw ApiError.forbidden('That dispute is not on your campus.');
      }

      await tx.query(
        `UPDATE disputes SET status = $2, resolution = $3, resolved_by = $4,
                resolved_at = CASE WHEN $2 IN ('OPEN','UNDER_REVIEW') THEN NULL ELSE now() END
          WHERE id = $1`,
        [id, body.status, body.resolution, staff.id],
      );

      const closing = !['OPEN', 'UNDER_REVIEW'].includes(body.status);

      if (closing && dispute.subject_type === 'REQUEST') {
        const locked = await lockRequest(tx, dispute.subject_id);
        if (locked.status === 'DISPUTED') {
          const { rows: paymentRows } = await tx.query<{ status: string }>(
            'SELECT status FROM payments WHERE request_id = $1',
            [locked.id],
          );
          const alreadyPaid = paymentRows[0]?.status === 'PAYMENT_CONFIRMED';

          // Where the ruling puts the request:
          //  - for the requester: cancelled;
          //  - split: the students settled it between them, so it closes as paid;
          //  - for the helper: paid if the money already arrived, otherwise a payment
          //    is opened (a dispute raised mid-task never had one) and awaited;
          //  - dismissed: back to where it was when the dispute was opened. Closing a
          //    dismissal as "paid" would record a payment nobody made.
          let target: 'CANCELLED' | 'PAID' | 'PAYMENT_PENDING' | 'IN_PROGRESS' | 'REJECTED';
          if (body.status === 'RESOLVED_REQUESTER') target = 'CANCELLED';
          else if (body.status === 'RESOLVED_SPLIT') target = 'PAID';
          else if (body.status === 'RESOLVED_HELPER') target = alreadyPaid ? 'PAID' : 'PAYMENT_PENDING';
          else {
            const { rows: history } = await tx.query<{ from_status: string }>(
              `SELECT from_status FROM request_status_history
                WHERE request_id = $1 AND to_status = 'DISPUTED'
                ORDER BY created_at DESC LIMIT 1`,
              [locked.id],
            );
            const before = history[0]?.from_status;
            target =
              before === 'IN_PROGRESS' || before === 'REJECTED'
                ? before
                : before === 'PAID' || alreadyPaid
                  ? 'PAID'
                  : 'PAYMENT_PENDING';
          }

          const actions = {
            CANCELLED: 'resolve_for_requester',
            PAID: 'resolve_paid',
            PAYMENT_PENDING: 'resolve_for_helper',
            IN_PROGRESS: 'dismiss_dispute',
            REJECTED: 'dismiss_dispute',
          } as const;
          await applyTransition(tx, locked, target, actions[target], 'ADMIN', staff.id, {
            note: body.resolution,
            patch:
              target === 'CANCELLED'
                ? { cancelled_at: new Date(), cancellation_reason: body.resolution }
                : undefined,
          });
          if (target === 'PAYMENT_PENDING') await ensurePaymentForRequest(tx, locked);
        }
      }

      if (closing && dispute.subject_type === 'RENTAL') {
        // Resolving a rental dispute ends the rental and releases the item back to its
        // owner's listing. What was agreed about the deposit is in the resolution.
        const { rows: rentalRows } = await tx.query<{ status: string }>(
          'SELECT status FROM rentals WHERE id = $1 FOR UPDATE',
          [dispute.subject_id],
        );
        if (rentalRows[0]?.status === 'DISPUTED') {
          await tx.query(`UPDATE rentals SET status = 'COMPLETED' WHERE id = $1`, [dispute.subject_id]);
          await tx.query(
            `INSERT INTO rental_events (rental_id, from_status, to_status, action, actor_id, actor_role)
             VALUES ($1, 'DISPUTED', 'COMPLETED', 'resolve_dispute', $2, 'ADMIN')`,
            [dispute.subject_id, staff.id],
          );
        }
      }

      for (const userId of [dispute.opened_by, dispute.against_id]) {
        if (!userId) continue;
        await notify(
          tx,
          {
            userId,
            campusId: dispute.campus_id,
            type: 'DISPUTE_RESOLVED',
            title: 'Dispute resolved',
            body: body.resolution,
            data: { disputeId: id },
            important: true,
          },
          outbox,
        );
      }

      await recordAudit(tx, {
        actorId: staff.id,
        actorRole: staff.role,
        action: 'admin.resolve_dispute',
        entityType: 'dispute',
        entityId: id,
        metadata: { status: body.status },
        ipAddress: clientIp(request),
      });

      return { ok: true };
    });
  });

  // ------------------------------------------------------------- Lost & Found
  app.get('/lost-found', async (request) => {
    const staff = requireStaff(request);
    const { rows } = await request.db.query(
      `SELECT p.id,p.post_type,p.title,p.category,p.approximate_location,p.status,p.created_at,
              u.full_name AS author_name,
              (SELECT count(*)::int FROM lost_found_claims c WHERE c.post_id=p.id) AS claim_count
         FROM lost_found_posts p JOIN users u ON u.id=p.author_id
        WHERE p.campus_id=$1 ORDER BY p.created_at DESC LIMIT 200`, [staff.campusId],
    );
    return { posts: rows.map((row) => ({...row, created_at: toIso(row.created_at)})) };
  });

  app.patch('/lost-found/:id', async (request) => {
    const staff=requireStaff(request); const {id}=parseOrThrow(idParams,request.params);
    const body=parseOrThrow(z.object({status:z.enum(['OPEN','MATCHED','RETURNED','CLOSED','EXPIRED']),reason:z.string().trim().min(3).max(500)}),request.body);
    return withServiceTx(request.db,async(tx)=>{
      const result=await tx.query(`UPDATE lost_found_posts SET status=$3 WHERE id=$1 AND campus_id=$2`,[id,staff.campusId,body.status]);
      if(!result.rowCount)throw ApiError.notFound('That Lost & Found post is not available.');
      await recordAudit(tx,{actorId:staff.id,actorRole:staff.role,action:'admin.update_lost_found',entityType:'lost_found_post',entityId:id,metadata:{status:body.status,reason:body.reason},ipAddress:clientIp(request)});
      return {ok:true};
    });
  });

  // ------------------------------------------------------------- audit + config
  app.get('/operations', async (request) => {
    requireAdmin(request);
    const [outbox, jobs] = await Promise.all([
      request.db.query<{ pending: string; failed: string; oldest: Date | null }>(
        `SELECT count(*) FILTER (WHERE processed_at IS NULL AND failed_at IS NULL)::text AS pending,
                count(*) FILTER (WHERE failed_at IS NOT NULL)::text AS failed,
                min(created_at) FILTER (WHERE processed_at IS NULL AND failed_at IS NULL) AS oldest
           FROM durable_outbox`,
      ),
      request.db.query<{ ready: string; failed: string }>(
        `SELECT count(*) FILTER (WHERE completed_at IS NULL AND failed_at IS NULL)::text AS ready,
                count(*) FILTER (WHERE failed_at IS NOT NULL)::text AS failed FROM job_queue`,
      ),
    ]);
    const failures = await request.db.query<{
      id: number; topic: string; attempts: number; last_error: string | null; failed_at: Date;
    }>(
      `SELECT id, topic, attempts, last_error, failed_at FROM durable_outbox
        WHERE failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 100`,
    );
    return {
      driver: request.db.driver,
      outbox: {
        pending: Number(outbox.rows[0].pending), failed: Number(outbox.rows[0].failed),
        oldest: outbox.rows[0].oldest ? toIso(outbox.rows[0].oldest) : null,
      },
      jobs: { ready: Number(jobs.rows[0].ready), failed: Number(jobs.rows[0].failed) },
      failures: failures.rows.map((row) => ({ ...row, failed_at: toIso(row.failed_at) })),
    };
  });

  app.post('/operations/outbox/:id/retry', async (request) => {
    const admin = requireAdmin(request);
    const { id } = parseOrThrow(z.object({ id: z.coerce.number().int().positive() }), request.params);
    return withServiceTx(request.db, async (tx) => {
      const result = await tx.query(
        `UPDATE durable_outbox SET attempts = 0, failed_at = NULL, locked_at = NULL,
                available_at = now(), last_error = NULL WHERE id = $1 AND failed_at IS NOT NULL`,
        [id],
      );
      if (result.rowCount === 0) throw ApiError.notFound('That failed delivery is not available.');
      await recordAudit(tx, {
        actorId: admin.id, actorRole: admin.role, action: 'admin.retry_outbox',
        entityType: 'durable_outbox', metadata: { id }, ipAddress: clientIp(request),
      });
      return { ok: true };
    });
  });

  app.get('/audit-logs', async (request) => {
    requireAdmin(request);
    const { rows } = await request.db.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
              u.full_name AS actor_name, a.actor_role
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC LIMIT 200`,
    );
    return { logs: rows.map((row) => ({ ...row, created_at: toIso(row.created_at) })) };
  });

  app.get('/campus', async (request) => {
    requireStaff(request);
    const campus = await getCampus(request.db);
    const { rows } = await request.db.query(
      `SELECT c.id, c.name, c.city, c.centre_lat, c.centre_lng, c.geofence_radius_metres,
              c.email_domains, i.name AS institution_name
         FROM campuses c JOIN institutions i ON i.id = c.institution_id WHERE c.id = $1`,
      [campus.campusId],
    );
    const departments = await request.db.query(
      'SELECT id, code, name FROM departments WHERE campus_id = $1 ORDER BY code',
      [campus.campusId],
    );
    const hostels = await request.db.query(
      'SELECT id, name FROM hostels WHERE campus_id = $1 ORDER BY name',
      [campus.campusId],
    );
    return { campus: rows[0], departments: departments.rows, hostels: hostels.rows };
  });

  /**
   * Adjust the campus geofence.
   *
   * Kept editable because the coordinates shipped in `.env` are approximate — an
   * administrator standing on campus can correct them without a redeploy.
   */
  app.patch('/campus', async (request) => {
    const admin = requireAdmin(request);
    const body = parseOrThrow(
      z.object({
        centreLat: z.number().min(-90).max(90).optional(),
        centreLng: z.number().min(-180).max(180).optional(),
        geofenceRadiusMetres: z.number().int().min(50).max(50_000).optional(),
        city: z.string().trim().max(120).optional(),
      }),
      request.body,
    );

    return withServiceTx(request.db, async (tx) => {
      await tx.query(
        `UPDATE campuses
            SET centre_lat             = COALESCE($2, centre_lat),
                centre_lng             = COALESCE($3, centre_lng),
                geofence_radius_metres = COALESCE($4, geofence_radius_metres),
                city                   = COALESCE($5, city),
                -- From now on these values outrank .env when the server restarts.
                geofence_set_by_admin_at = now()
          WHERE id = $1`,
        [
          admin.campusId,
          body.centreLat ?? null,
          body.centreLng ?? null,
          body.geofenceRadiusMetres ?? null,
          body.city ?? null,
        ],
      );
      await recordAudit(tx, {
        actorId: admin.id,
        actorRole: admin.role,
        action: 'admin.update_campus',
        entityType: 'campus',
        entityId: admin.campusId,
        metadata: { ...body },
        ipAddress: clientIp(request),
      });
      return { ok: true };
    });
  });

  app.get('/requests', async (request) => {
    requireStaff(request);
    const campus = await getCampus(request.db);
    const { rows } = await request.db.query(
      `SELECT r.id, r.title, r.status, r.category_slug, r.reward_paise, r.created_at,
              u.full_name AS requester_name, h.full_name AS helper_name
         FROM requests r
         JOIN users u ON u.id = r.requester_id
         LEFT JOIN users h ON h.id = r.selected_helper_id
        WHERE r.campus_id = $1
        ORDER BY r.created_at DESC LIMIT 100`,
      [campus.campusId],
    );
    return {
      requests: rows.map((row) => ({
        ...row,
        reward_paise: toNumber(row.reward_paise),
        created_at: toIso(row.created_at),
      })),
    };
  });
}
