import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  consentSchema,
  deactivateAccountSchema,
  deleteAccountSchema,
  moderationAppealSchema,
  pushDeviceSchema,
  safetyControlSchema,
} from '@campusbuddy/shared';
import { requireAuth, requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { withUserTx } from '../../core/outbox.js';
import { toIso, toIsoOrNull, toPublicUser, type PublicUserRow } from '../../core/serializers.js';
import { parseOrThrow } from '../../core/validate.js';

const idParams = z.object({ id: z.string().uuid('Unknown student') });
const tokenParams = z.object({ token: z.string().min(20).max(4096) });
const PUBLIC_COLUMNS = `
  p.id, p.full_name, p.avatar_attachment_id, p.bio, p.department_code, p.department_name,
  p.year_of_study, p.is_verified, p.verification_method, p.average_rating,
  p.rating_count, p.completed_tasks, p.completion_rate, p.cancellation_rate,
  p.response_rate, p.reliability_score, p.tier, p.availability, p.skills,
  p.badges, p.member_since
`;

/** Safety, privacy and device capabilities that cut across domain modules. */
export async function productionRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- safety
  app.get('/safety/controls', async (request) => {
    const user = requireAuth(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<
        PublicUserRow & { blocked: boolean; muted: boolean; reason: string | null; updated_at: Date }
      >(
        `SELECT ${PUBLIC_COLUMNS}, c.blocked, c.muted, c.reason, c.updated_at
           FROM user_safety_controls c
           JOIN public_user_profiles p ON p.id = c.target_id
          WHERE c.owner_id = $1 ORDER BY c.updated_at DESC`,
        [user.id],
      );
      return {
        controls: rows.map((row) => ({
          user: toPublicUser(row),
          blocked: row.blocked,
          muted: row.muted,
          reason: row.reason,
          updatedAt: toIso(row.updated_at),
        })),
      };
    });
  });

  app.put('/safety/controls/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(safetyControlSchema, request.body);
    if (id === user.id) throw ApiError.badRequest('You cannot block or mute yourself.');

    return withUserTx(request.db, user, async (tx) => {
      const target = await tx.query('SELECT 1 FROM users WHERE id = $1 AND account_status = \'ACTIVE\'', [id]);
      if (!target.rows[0]) throw ApiError.notFound('That student is not available.');
      await tx.query(
        `INSERT INTO user_safety_controls (owner_id, target_id, blocked, muted, reason)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (owner_id, target_id) DO UPDATE
           SET blocked = EXCLUDED.blocked, muted = EXCLUDED.muted, reason = EXCLUDED.reason`,
        [user.id, id, body.blocked, body.muted, body.reason ?? null],
      );
      return { blocked: body.blocked, muted: body.muted };
    });
  });

  app.delete('/safety/controls/:id', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = parseOrThrow(idParams, request.params);
    await withUserTx(request.db, user, (tx) =>
      tx.query('DELETE FROM user_safety_controls WHERE owner_id = $1 AND target_id = $2', [user.id, id]),
    );
    return reply.code(204).send();
  });

  app.get('/safety/actions', async (request) => {
    const user = requireAuth(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{
        id: string; action_type: string; reason: string; points: number; expires_at: Date | null;
        created_at: Date; appealed: boolean;
      }>(
        `SELECT a.id, a.action_type, a.reason, a.points, a.expires_at, a.created_at,
                EXISTS (SELECT 1 FROM moderation_appeals ap WHERE ap.moderation_action_id = a.id) AS appealed
           FROM moderation_actions a WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
        [user.id],
      );
      return { actions: rows.map((row) => ({
        id: row.id,
        actionType: row.action_type,
        reason: row.reason,
        points: Number(row.points),
        expiresAt: toIsoOrNull(row.expires_at),
        createdAt: toIso(row.created_at),
        appealed: row.appealed,
      })) };
    });
  });

  app.post('/safety/appeals', async (request, reply) => {
    const user = requireAuth(request);
    const body = parseOrThrow(moderationAppealSchema, request.body);
    await withUserTx(request.db, user, async (tx) => {
      const action = await tx.query('SELECT 1 FROM moderation_actions WHERE id = $1 AND user_id = $2', [
        body.moderationActionId,
        user.id,
      ]);
      if (!action.rows[0]) throw ApiError.notFound('That moderation action is not available.');
      await tx.query(
        `INSERT INTO moderation_appeals (moderation_action_id, user_id, statement)
         VALUES ($1,$2,$3)`,
        [body.moderationActionId, user.id, body.statement],
      );
    });
    return reply.code(201).send({ ok: true });
  });

  // ------------------------------------------------------------ push devices
  app.post('/push/devices', async (request, reply) => {
    const user = requireAuth(request);
    const body = parseOrThrow(pushDeviceSchema, request.body);
    await withUserTx(request.db, user, async (tx) => {
      await tx.query(
        `INSERT INTO push_devices (user_id, campus_id, platform, token, device_name, app_version)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, campus_id = EXCLUDED.campus_id,
           platform = EXCLUDED.platform, device_name = EXCLUDED.device_name,
           app_version = EXCLUDED.app_version, enabled = true, last_seen_at = now()`,
        [user.id, user.campusId, body.platform, body.token, body.deviceName ?? null, body.appVersion ?? null],
      );
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/push/devices/:token', async (request, reply) => {
    const user = requireAuth(request);
    const { token } = parseOrThrow(tokenParams, request.params);
    await withUserTx(request.db, user, (tx) =>
      tx.query('DELETE FROM push_devices WHERE user_id = $1 AND token = $2', [user.id, token]),
    );
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- privacy
  app.get('/privacy/documents', async (request) => {
    const user = request.auth;
    const { rows } = await request.db.query<{
      document_type: 'PRIVACY' | 'TERMS' | 'COMMUNITY'; version: string; title: string;
      content: string; effective_at: Date; accepted_at: Date | null;
    }>(
      `SELECT DISTINCT ON (d.document_type) d.document_type, d.version, d.title, d.content,
              d.effective_at,
              (SELECT max(c.recorded_at) FROM user_consents c WHERE c.user_id = $1
                AND c.document_type = d.document_type AND c.version = d.version AND c.accepted) AS accepted_at
         FROM legal_documents d ORDER BY d.document_type, d.effective_at DESC`,
      [user?.id ?? null],
    );
    return { documents: rows.map((row) => ({
      documentType: row.document_type,
      version: row.version,
      title: row.title,
      content: row.content,
      effectiveAt: toIso(row.effective_at),
      acceptedAt: toIsoOrNull(row.accepted_at),
    })) };
  });

  app.post('/privacy/consents', async (request, reply) => {
    const user = requireAuth(request);
    const body = parseOrThrow(consentSchema, request.body);
    const ipHash = createHash('sha256').update(request.ip).digest('hex');
    const result = await request.db.query(
      `INSERT INTO user_consents (user_id, document_type, version, accepted, ip_hash, user_agent)
       SELECT $1,$2,$3,true,$4,$5 WHERE EXISTS (
         SELECT 1 FROM legal_documents WHERE document_type = $2 AND version = $3)`,
      [user.id, body.documentType, body.version, ipHash, request.headers['user-agent'] ?? null],
    );
    if (result.rowCount === 0) throw ApiError.notFound('That policy version is not available.');
    return reply.code(201).send({ ok: true });
  });

  app.get('/privacy/export', async (request) => {
    const user = requireAuth(request);
    const [profile, requests, messages, payments, ratings, reports, disputes, consents, lostFoundPosts, lostFoundClaims] = await Promise.all([
      request.db.query('SELECT id, email, full_name, phone, role, account_status, is_verified, created_at FROM users WHERE id = $1', [user.id]),
      request.db.query('SELECT * FROM requests WHERE requester_id = $1 OR selected_helper_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT m.* FROM messages m WHERE sender_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT * FROM payments WHERE payer_id = $1 OR payee_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT * FROM ratings WHERE rater_id = $1 OR ratee_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT * FROM disputes WHERE opened_by = $1 OR against_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT document_type, version, accepted, recorded_at FROM user_consents WHERE user_id = $1 ORDER BY recorded_at', [user.id]),
      request.db.query('SELECT * FROM lost_found_posts WHERE author_id = $1 ORDER BY created_at', [user.id]),
      request.db.query('SELECT * FROM lost_found_claims WHERE claimant_id = $1 ORDER BY created_at', [user.id]),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      profile: profile.rows[0] ?? null,
      requests: requests.rows,
      messagesSent: messages.rows,
      payments: payments.rows,
      ratings: ratings.rows,
      reports: reports.rows,
      disputes: disputes.rows,
      consents: consents.rows,
      lostFoundPosts: lostFoundPosts.rows,
      lostFoundResponses: lostFoundClaims.rows,
    };
  });

  app.post('/privacy/deactivate', async (request) => {
    const user = requireAuth(request);
    parseOrThrow(deactivateAccountSchema, request.body);
    await request.db.transaction(async (tx) => {
      await tx.query(`UPDATE users SET account_status = 'DEACTIVATED' WHERE id = $1`, [user.id]);
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
      await tx.query('UPDATE push_devices SET enabled = false WHERE user_id = $1', [user.id]);
    });
    return { ok: true };
  });

  app.delete('/privacy/account', async (request) => {
    const user = requireAuth(request);
    parseOrThrow(deleteAccountSchema, request.body);
    await request.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET full_name = 'Deleted student', email = $2, phone = NULL,
          upi_id = NULL, upi_qr_attachment_id = NULL, avatar_attachment_id = NULL,
          bio = NULL, skills = '{}', is_verified = false, account_status = 'DEACTIVATED',
          deleted_at = now() WHERE id = $1`,
        [user.id, `deleted-${user.id}@deleted.invalid`],
      );
      await tx.query('DELETE FROM user_credentials WHERE user_id = $1', [user.id]);
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
      await tx.query('DELETE FROM push_devices WHERE user_id = $1', [user.id]);
      await tx.query('DELETE FROM user_preferences WHERE user_id = $1', [user.id]);
      await tx.query('DELETE FROM notification_preferences WHERE user_id = $1', [user.id]);
    });
    return { ok: true };
  });
}
