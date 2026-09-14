import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  notificationPreferencesSchema,
  updatePaymentDetailsSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from '@campusbuddy/shared';
import type { SelfUser } from '@campusbuddy/shared';
import { requireAuth, requireVerified, type AuthenticatedUser } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import { toPublicUser, toRating, type PublicUserRow, type RatingRow } from '../../core/serializers.js';
import { loadSelfUser } from '../auth/service.js';
import { deleteAttachment, PROFILE_IMAGE_TYPES, receiveUpload } from '../uploads/storage.js';

const idParams = z.object({ id: z.string().uuid('Unknown student') });

const shareLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const searchQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const PUBLIC_COLUMNS = `
  p.id, p.full_name, p.avatar_attachment_id, p.bio, p.department_code, p.department_name,
  p.year_of_study, p.is_verified, p.verification_method, p.average_rating,
  p.rating_count, p.completed_tasks, p.completion_rate, p.cancellation_rate,
  p.response_rate, p.reliability_score, p.tier, p.availability, p.skills,
  p.badges, p.member_since
`;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** Another student's public profile. RLS keeps this inside the campus. */
  app.get('/:id', async (request) => {
    const user = requireAuth(request);
    const { id } = parseOrThrow(idParams, request.params);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<PublicUserRow>(
        `SELECT ${PUBLIC_COLUMNS} FROM public_user_profiles p WHERE p.id = $1`,
        [id],
      );
      if (!rows[0]) throw ApiError.notFound('That student is not on this campus.');

      const reviews = await tx.query<RatingRow>(
        `SELECT r.id, r.request_id, r.rental_id, r.ratee_id, r.direction, r.stars,
                r.punctuality, r.reliability, r.communication, r.quality,
                r.clear_instructions, r.payment_reliability, r.respectfulness,
                r.review, r.created_at, to_jsonb(rp) AS rater
           FROM ratings r JOIN public_user_profiles rp ON rp.id = r.rater_id
          WHERE r.ratee_id = $1
          ORDER BY r.created_at DESC LIMIT 20`,
        [id],
      );

      const isFavourite = await tx.query(
        'SELECT 1 FROM favourite_helpers WHERE user_id = $1 AND helper_id = $2',
        [user.id, id],
      );
      const safety = await tx.query<{ blocked: boolean; muted: boolean }>(
        'SELECT blocked, muted FROM user_safety_controls WHERE owner_id = $1 AND target_id = $2',
        [user.id, id],
      );

      return {
        user: toPublicUser(rows[0]),
        reviews: reviews.rows.map(toRating),
        isFavourite: isFavourite.rows.length > 0,
        safety: safety.rows[0] ?? { blocked: false, muted: false },
      };
    });
  });

  /** Directory search, used when inviting trusted helpers to a private request. */
  app.get('/', async (request) => {
    const user = requireVerified(request);
    const query = parseOrThrow(searchQuerySchema, request.query ?? {});

    return withUserTx(request.db, user, async (tx) => {
      const params: unknown[] = [user.id, query.limit];
      const filter = query.q
        ? `AND (p.full_name ILIKE '%' || $3 || '%' OR p.department_code ILIKE '%' || $3 || '%')`
        : '';
      if (query.q) params.push(query.q);

      const { rows } = await tx.query<PublicUserRow>(
        `SELECT ${PUBLIC_COLUMNS} FROM public_user_profiles p
          WHERE p.id <> $1 AND p.is_verified = true AND p.account_status = 'ACTIVE'
            AND NOT app_users_blocked($1, p.id) ${filter}
          ORDER BY p.reliability_score DESC, p.full_name ASC
          LIMIT $2`,
        params,
      );
      return { users: rows.map(toPublicUser) };
    });
  });

  app.patch('/me', async (request) => {
    const user = requireAuth(request);
    const body = parseOrThrow(updateProfileSchema, request.body);

    return withUserTx(request.db, user, async (tx) => {
      // A department or hostel must be one of this campus's own. RLS confines both
      // lookups to the campus, so an id from anywhere else is simply not found.
      if (body.departmentId) {
        const { rows } = await tx.query('SELECT 1 FROM departments WHERE id = $1', [body.departmentId]);
        if (rows.length === 0) throw ApiError.badRequest('That department is not on this campus.');
      }
      if (body.hostelId) {
        const { rows } = await tx.query('SELECT 1 FROM hostels WHERE id = $1', [body.hostelId]);
        if (rows.length === 0) throw ApiError.badRequest('That hostel is not on this campus.');
      }

      const patch: Record<string, unknown> = {};
      if (body.fullName !== undefined) patch.full_name = body.fullName;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.departmentId !== undefined) patch.department_id = body.departmentId;
      if (body.hostelId !== undefined) patch.hostel_id = body.hostelId;
      if (body.yearOfStudy !== undefined) patch.year_of_study = body.yearOfStudy;
      if (body.semester !== undefined) patch.semester = body.semester;
      if (body.bio !== undefined) patch.bio = body.bio;
      if (body.skills !== undefined) patch.skills = body.skills;

      const columns = Object.keys(patch);
      if (columns.length > 0) {
        const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
        await tx.query(`UPDATE users SET ${assignments.join(', ')} WHERE id = $1`, [
          user.id,
          ...columns.map((column) => patch[column]),
        ]);
      }
      return { user: await loadSelfUser(tx, user.id) };
    });
  });

  /** UPI details, stored so a payer can be shown them at the payment stage only. */
  app.patch('/me/payment-details', async (request) => {
    const user = requireAuth(request);
    const body = parseOrThrow(updatePaymentDetailsSchema, request.body);

    return withUserTx(request.db, user, async (tx) => {
      // Only the UPI ID lives here; the QR code has its own endpoint below. An
      // omitted field leaves the saved value alone, and null clears it.
      if (body.upiId !== undefined) {
        await tx.query('UPDATE users SET upi_id = $2 WHERE id = $1', [user.id, body.upiId]);
      }
      return { user: await loadSelfUser(tx, user.id) };
    });
  });

  // --- Profile photo ------------------------------------------------------
  /** Upload or replace the profile photo: multipart, one JPG or PNG image. */
  app.put('/me/avatar', async (request) => {
    const user = requireAuth(request);
    return { user: await replaceProfileImage(request, user, 'AVATAR') };
  });

  app.delete('/me/avatar', async (request) => {
    const user = requireAuth(request);
    return { user: await removeProfileImage(request, user, 'AVATAR') };
  });

  // --- Payment QR code ----------------------------------------------------
  /**
   * Upload or replace the UPI QR code a payer can scan. The student app checks that
   * the image really is a UPI payment code before sending it; the server treats it
   * as an image and cleans it like any other profile image.
   */
  app.put('/me/payment-qr', async (request) => {
    const user = requireAuth(request);
    return { user: await replaceProfileImage(request, user, 'UPI_QR') };
  });

  app.delete('/me/payment-qr', async (request) => {
    const user = requireAuth(request);
    return { user: await removeProfileImage(request, user, 'UPI_QR') };
  });

  app.patch('/me/preferences', async (request) => {
    const user = requireAuth(request);
    const body = parseOrThrow(updatePreferencesSchema, request.body);

    return withUserTx(request.db, user, async (tx) => {
      await tx.query(
        `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
      await tx.query(
        `UPDATE user_preferences
            SET availability         = COALESCE($2, availability),
                preferred_categories = COALESCE($3, preferred_categories),
                min_reward_paise     = COALESCE($4, min_reward_paise),
                max_distance_metres  = COALESCE($5, max_distance_metres),
                -- Sent as null to clear the end time; left alone when not sent.
                available_until      = CASE WHEN $7::boolean THEN $6::timestamptz ELSE available_until END
          WHERE user_id = $1`,
        [
          user.id,
          body.availability ?? null,
          body.preferredCategories ?? null,
          body.minRewardPaise ?? null,
          body.maxDistanceMetres ?? null,
          body.availableUntil ?? null,
          body.availableUntil !== undefined,
        ],
      );
      return { user: await loadSelfUser(tx, user.id) };
    });
  });

  app.patch('/me/notification-preferences', async (request) => {
    const user = requireAuth(request);
    const body = parseOrThrow(notificationPreferencesSchema, request.body);

    return withUserTx(request.db, user, async (tx) => {
      await tx.query(
        `INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
      await tx.query(
        `UPDATE notification_preferences
            SET new_matching_requests = COALESCE($2, new_matching_requests),
                offers              = COALESCE($3, offers),
                chat                = COALESCE($4, chat),
                payments            = COALESCE($5, payments),
                ratings             = COALESCE($6, ratings),
                rentals             = COALESCE($7, rentals),
                reminders           = COALESCE($8, reminders),
                lost_found          = COALESCE($16, lost_found),
                min_reward_paise    = COALESCE($9, min_reward_paise),
                max_distance_metres = COALESCE($10, max_distance_metres),
                urgent_only         = COALESCE($11, urgent_only),
                -- Quiet hours change only when sent (null clears them), so saving
                -- one toggle never wipes a window set earlier.
                quiet_hours_start   = CASE WHEN $14::boolean THEN $12::integer ELSE quiet_hours_start END,
                quiet_hours_end     = CASE WHEN $15::boolean THEN $13::integer ELSE quiet_hours_end END
          WHERE user_id = $1`,
        [
          user.id,
          body.newMatchingRequests ?? null,
          body.offers ?? null,
          body.chat ?? null,
          body.payments ?? null,
          body.ratings ?? null,
          body.rentals ?? null,
          body.reminders ?? null,
          body.minRewardPaise ?? null,
          body.maxDistanceMetres ?? null,
          body.urgentOnly ?? null,
          body.quietHoursStart ?? null,
          body.quietHoursEnd ?? null,
          body.quietHoursStart !== undefined,
          body.quietHoursEnd !== undefined,
          body.lostFound ?? null,
        ],
      );
      return { user: await loadSelfUser(tx, user.id) };
    });
  });

  /**
   * Records the student's current position.
   *
   * Explicitly called by the app when the student opts in — there is no background
   * tracking anywhere in CampusBuddy (spec §10, §64).
   */
  app.post('/me/location', async (request) => {
    const user = requireAuth(request);
    const body = parseOrThrow(shareLocationSchema, request.body);

    return withUserTx(request.db, user, async (tx) => {
      await tx.query(
        `INSERT INTO user_preferences (user_id, last_lat, last_lng, last_location_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
           SET last_lat = EXCLUDED.last_lat,
               last_lng = EXCLUDED.last_lng,
               last_location_at = now()`,
        [user.id, body.lat, body.lng],
      );
      return { ok: true };
    });
  });

  app.delete('/me/location', async (request, reply) => {
    const user = requireAuth(request);
    await withUserTx(request.db, user, async (tx) => {
      await tx.query(
        `UPDATE user_preferences SET last_lat = NULL, last_lng = NULL, last_location_at = NULL
          WHERE user_id = $1`,
        [user.id],
      );
    });
    return reply.code(204).send();
  });

  // --- Favourite helpers --------------------------------------------------
  app.get('/me/favourites', async (request) => {
    const user = requireAuth(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<PublicUserRow>(
        `SELECT ${PUBLIC_COLUMNS} FROM favourite_helpers f
           JOIN public_user_profiles p ON p.id = f.helper_id
          WHERE f.user_id = $1 ORDER BY p.full_name`,
        [user.id],
      );
      return { helpers: rows.map(toPublicUser) };
    });
  });

  app.put('/:id/favourite', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    if (id === user.id) throw ApiError.badRequest('You cannot add yourself to your favourites.');

    return withUserTx(request.db, user, async (tx) => {
      await tx.query(
        `INSERT INTO favourite_helpers (campus_id, user_id, helper_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, helper_id) DO NOTHING`,
        [user.campusId, user.id, id],
      );
      return { isFavourite: true };
    });
  });

  app.delete('/:id/favourite', async (request) => {
    const user = requireAuth(request);
    const { id } = parseOrThrow(idParams, request.params);
    return withUserTx(request.db, user, async (tx) => {
      await tx.query('DELETE FROM favourite_helpers WHERE user_id = $1 AND helper_id = $2', [
        user.id,
        id,
      ]);
      return { isFavourite: false };
    });
  });

  // --- Earnings -----------------------------------------------------------
  app.get('/me/earnings', async (request) => {
    const user = requireAuth(request);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{
        total_earned: string;
        pending: string;
        completed_tasks: string;
        average_reward: string | null;
        this_month: string;
      }>(
        `SELECT
           COALESCE(sum(amount_paise) FILTER (WHERE status = 'PAYMENT_CONFIRMED'), 0)::text AS total_earned,
           COALESCE(sum(amount_paise) FILTER (WHERE status IN ('PAYMENT_PENDING','PAYMENT_INITIATED','PAYMENT_CLAIMED')), 0)::text AS pending,
           count(*) FILTER (WHERE status = 'PAYMENT_CONFIRMED')::text AS completed_tasks,
           avg(amount_paise) FILTER (WHERE status = 'PAYMENT_CONFIRMED')::text AS average_reward,
           COALESCE(sum(amount_paise) FILTER (
             WHERE status = 'PAYMENT_CONFIRMED' AND confirmed_at >= date_trunc('month', now())
           ), 0)::text AS this_month
         FROM payments WHERE payee_id = $1`,
        [user.id],
      );
      const summary = rows[0];

      const byMonth = await tx.query<{ month: string; earned: string; tasks: string }>(
        `SELECT to_char(date_trunc('month', confirmed_at), 'YYYY-MM') AS month,
                sum(amount_paise)::text AS earned,
                count(*)::text AS tasks
           FROM payments
          WHERE payee_id = $1 AND status = 'PAYMENT_CONFIRMED' AND confirmed_at IS NOT NULL
          GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
        [user.id],
      );

      return {
        totalEarnedPaise: Number(summary.total_earned),
        pendingPaise: Number(summary.pending),
        completedTasks: Number(summary.completed_tasks),
        averageRewardPaise: Math.round(Number(summary.average_reward ?? 0)),
        thisMonthPaise: Number(summary.this_month),
        byMonth: byMonth.rows.map((row) => ({
          month: row.month,
          earnedPaise: Number(row.earned),
          tasks: Number(row.tasks),
        })),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Profile photo and payment QR code storage
// ---------------------------------------------------------------------------

type ProfileImageKind = 'AVATAR' | 'UPI_QR';
type ProfileImageColumn = 'avatar_attachment_id' | 'upi_qr_attachment_id';

const PROFILE_IMAGES: Record<ProfileImageKind, { column: ProfileImageColumn; isPublic: boolean }> = {
  AVATAR: { column: 'avatar_attachment_id', isPublic: true },
  // A payment QR code is never public. It is only reachable through a signed link,
  // handed to a student who currently owes this student money.
  UPI_QR: { column: 'upi_qr_attachment_id', isPublic: false },
};

/**
 * Stores a new profile image and swaps it in, deleting the file it replaces. If the
 * swap fails, the just-uploaded file is removed rather than left orphaned.
 */
async function replaceProfileImage(
  request: FastifyRequest,
  user: AuthenticatedUser,
  kind: ProfileImageKind,
): Promise<SelfUser> {
  const { column, isPublic } = PROFILE_IMAGES[kind];
  const attachment = await receiveUpload(request, user, {
    purpose: kind,
    allowedTypes: PROFILE_IMAGE_TYPES,
    rejectMessage: 'Choose a JPG or PNG image.',
    stripMetadata: true,
    isPublic,
  });

  let result: { user: SelfUser; previous: string | null };
  try {
    result = await swapProfileImage(request, user, column, attachment.id);
  } catch (error) {
    await deleteAttachment(request.db, attachment.id);
    throw error;
  }

  if (result.previous) await deleteAttachment(request.db, result.previous);
  return result.user;
}

async function removeProfileImage(
  request: FastifyRequest,
  user: AuthenticatedUser,
  kind: ProfileImageKind,
): Promise<SelfUser> {
  const result = await swapProfileImage(request, user, PROFILE_IMAGES[kind].column, null);
  if (result.previous) await deleteAttachment(request.db, result.previous);
  return result.user;
}

/** Points the column at a new attachment (or none) and reports what it held before. */
function swapProfileImage(
  request: FastifyRequest,
  user: AuthenticatedUser,
  column: ProfileImageColumn,
  attachmentId: string | null,
): Promise<{ user: SelfUser; previous: string | null }> {
  return withUserTx(request.db, user, async (tx) => {
    // The column name comes from the fixed table above, never from input.
    const { rows } = await tx.query<{ previous: string | null }>(
      `SELECT ${column} AS previous FROM users WHERE id = $1 FOR UPDATE`,
      [user.id],
    );
    await tx.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [user.id, attachmentId]);
    return { user: await loadSelfUser(tx, user.id), previous: rows[0]?.previous ?? null };
  });
}
