import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { haversineMetres, isValidCoordinate } from '@campusbuddy/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { Database } from '../../db/client.js';
import { getCampus } from '../../db/bootstrap.js';
import { recordAudit } from '../../core/audit.js';
import { buildOtpEmail, getEmailProvider } from '../../core/email.js';
import { ApiError } from '../../core/errors.js';
import { enforceRateLimit, RATE_LIMITS } from '../../core/rate-limit.js';
import type { AuthenticatedUser } from '../../core/context.js';

/**
 * Student verification (spec §9, §10).
 *
 * Two independent signals, either of which is sufficient:
 *   1. A one-time code sent to the student's college email address.
 *   2. A GPS reading inside the campus geofence.
 *
 * Neither is treated as cryptographic proof of enrolment — GPS especially can be
 * spoofed — so every verification event is recorded with its method, timestamp and
 * supporting measurements for later review.
 */

/**
 * OTPs are stored as an HMAC keyed with the server secret, never as plaintext and
 * never as a bare hash: a six-digit code has only a million possibilities, so an
 * unkeyed digest of it could be reversed instantly from a database dump.
 */
function hashOtp(userId: string, code: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(`${userId}:${code}`).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

function generateOtp(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

export interface OtpRequestResult {
  sent: true;
  expiresAt: string;
  /** True when EMAIL_PROVIDER=console, so the UI can say the code is in the server log. */
  devMode: boolean;
  /** Present only in development, so a demo does not require a real mailbox. */
  devCode?: string;
}

export async function requestEmailOtp(
  db: Database,
  user: AuthenticatedUser,
): Promise<OtpRequestResult> {
  if (user.isVerified) {
    throw ApiError.conflict('Your account is already verified.', 'ALREADY_VERIFIED');
  }

  // Two limits: a short cooldown between sends, and an hourly ceiling (spec §9).
  await enforceRateLimit(
    db,
    { bucket: 'otp_cooldown', limit: 1, windowSeconds: env.OTP_RESEND_COOLDOWN_SECONDS },
    user.id,
    `Please wait ${env.OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code.`,
  );
  await enforceRateLimit(
    db,
    { ...RATE_LIMITS.otpRequest, limit: env.OTP_MAX_PER_HOUR },
    user.id,
    'Too many verification codes requested. Please try again later.',
  );

  const campus = await getCampus(db);
  const code = generateOtp(env.OTP_LENGTH);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);

  await db.transaction(async (tx) => {
    // Superseding the previous code also keeps the "one pending OTP" index satisfied.
    await tx.query(
      `UPDATE verification_records SET status = 'EXPIRED'
        WHERE user_id = $1 AND method = 'COLLEGE_EMAIL' AND status = 'PENDING'`,
      [user.id],
    );
    await tx.query(
      `INSERT INTO verification_records (user_id, campus_id, method, status, code_hash, target, expires_at)
       VALUES ($1, $2, 'COLLEGE_EMAIL', 'PENDING', $3, $4, $5)`,
      [user.id, campus.campusId, hashOtp(user.id, code), user.email, expiresAt],
    );
  });

  const provider = getEmailProvider();
  const message = buildOtpEmail(user.fullName, code, env.OTP_TTL_MINUTES);
  try {
    await provider.send({ ...message, to: user.email });
  } catch (error) {
    // A mail server outage is not a bug in the request, and the student should be
    // told something they can act on rather than a generic 500.
    logger.error('Could not send a verification email', {
      provider: provider.name,
      message: (error as Error).message,
    });
    throw new ApiError(
      503,
      'EMAIL_DELIVERY_FAILED',
      'We could not send the email just now. Please try again in a minute.',
    );
  }

  return {
    sent: true,
    expiresAt: expiresAt.toISOString(),
    devMode: provider.isDevMode,
    // Never returned in production: `assertProductionSafety` refuses to boot with
    // the console provider, so this branch cannot be reached there.
    ...(provider.isDevMode && !env.isProduction ? { devCode: code } : {}),
  };
}

export interface VerificationResult {
  verified: boolean;
  method: 'COLLEGE_EMAIL' | 'CAMPUS_LOCATION';
  verifiedAt: string;
}

export async function verifyEmailOtp(
  db: Database,
  user: AuthenticatedUser,
  code: string,
): Promise<VerificationResult> {
  if (user.isVerified) {
    throw ApiError.conflict('Your account is already verified.', 'ALREADY_VERIFIED');
  }
  await enforceRateLimit(db, RATE_LIMITS.otpVerify, user.id, 'Too many attempts. Request a new code.');

  // Refusals are *returned* from the transaction and thrown only after it commits.
  // Throwing inside would roll back the very write that records the failed attempt,
  // and the attempt limit would never be reached: a code could be guessed forever.
  const outcome = await db.transaction(async (tx): Promise<VerificationResult | ApiError> => {
    // Lock the record so two concurrent attempts cannot both consume it.
    const { rows } = await tx.query<{
      id: string;
      code_hash: string;
      attempts: number;
      expires_at: Date;
    }>(
      `SELECT id, code_hash, attempts, expires_at
         FROM verification_records
        WHERE user_id = $1 AND method = 'COLLEGE_EMAIL' AND status = 'PENDING'
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE`,
      [user.id],
    );
    const record = rows[0];
    if (!record) {
      return ApiError.badRequest('Request a verification code first.');
    }

    if (new Date(record.expires_at).getTime() <= Date.now()) {
      await tx.query(
        `UPDATE verification_records SET status = 'EXPIRED', failure_reason = 'expired' WHERE id = $1`,
        [record.id],
      );
      return new ApiError(410, 'OTP_EXPIRED', 'That code has expired. Request a new one.');
    }

    if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
      await tx.query(
        `UPDATE verification_records SET status = 'FAILED', failure_reason = 'too_many_attempts' WHERE id = $1`,
        [record.id],
      );
      return new ApiError(
        429,
        'OTP_ATTEMPTS_EXCEEDED',
        'Too many incorrect codes. Request a new one.',
      );
    }

    if (!constantTimeEquals(record.code_hash, hashOtp(user.id, code))) {
      const attempts = record.attempts + 1;
      const exhausted = attempts >= env.OTP_MAX_ATTEMPTS;
      // The last permitted miss retires the code there and then.
      await tx.query(
        `UPDATE verification_records
            SET attempts = $2,
                status = CASE WHEN $3::boolean THEN 'FAILED' ELSE status END,
                failure_reason = CASE WHEN $3::boolean THEN 'too_many_attempts' ELSE failure_reason END
          WHERE id = $1`,
        [record.id, attempts, exhausted],
      );
      const remaining = env.OTP_MAX_ATTEMPTS - attempts;
      return new ApiError(
        400,
        'OTP_INVALID',
        remaining > 0
          ? `That code is not correct. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'That code is not correct. Request a new code to try again.',
      );
    }

    const verifiedAt = new Date();
    await tx.query(
      `UPDATE verification_records
          SET status = 'VERIFIED', verified_at = $2, code_hash = NULL
        WHERE id = $1`,
      [record.id, verifiedAt],
    );
    await tx.query(
      `UPDATE users
          SET is_verified = true, verification_method = 'COLLEGE_EMAIL', verified_at = $2
        WHERE id = $1`,
      [user.id, verifiedAt],
    );
    await recordAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: 'verification.email_verified',
      entityType: 'user',
      entityId: user.id,
    });

    logger.info('Student verified by college email', { userId: user.id });
    return {
      verified: true,
      method: 'COLLEGE_EMAIL',
      verifiedAt: verifiedAt.toISOString(),
    };
  });

  if (outcome instanceof ApiError) throw outcome;
  return outcome;
}

export interface LocationVerificationInput {
  lat: number;
  lng: number;
  accuracyMetres?: number;
}

export async function verifyCampusLocation(
  db: Database,
  user: AuthenticatedUser,
  input: LocationVerificationInput,
): Promise<VerificationResult> {
  if (user.isVerified) {
    throw ApiError.conflict('Your account is already verified.', 'ALREADY_VERIFIED');
  }
  await enforceRateLimit(
    db,
    RATE_LIMITS.locationVerify,
    user.id,
    'Too many location checks. Please try again later.',
  );

  if (!isValidCoordinate({ lat: input.lat, lng: input.lng })) {
    throw ApiError.badRequest('That location reading is not valid. Try again outdoors.');
  }

  const { rows } = await db.query<{
    id: string;
    centre_lat: number;
    centre_lng: number;
    geofence_radius_metres: number;
  }>(
    'SELECT id, centre_lat, centre_lng, geofence_radius_metres FROM campuses WHERE id = $1',
    [user.campusId],
  );
  const campus = rows[0];
  if (!campus) throw ApiError.internal('Campus configuration is missing.');

  const distance = haversineMetres(
    { lat: input.lat, lng: input.lng },
    { lat: campus.centre_lat, lng: campus.centre_lng },
  );
  const inside = distance <= campus.geofence_radius_metres;

  // A very poor GPS fix is rejected rather than quietly accepted, because a 2 km
  // accuracy radius says nothing about whether the student is actually on campus.
  const accuracyTooPoor =
    input.accuracyMetres !== undefined &&
    input.accuracyMetres > campus.geofence_radius_metres;

  const verifiedAt = new Date();
  const success = inside && !accuracyTooPoor;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO verification_records
         (user_id, campus_id, method, status, observed_lat, observed_lng,
          distance_metres, accuracy_metres, verified_at, failure_reason)
       VALUES ($1, $2, 'CAMPUS_LOCATION', $3, $4, $5, $6, $7, $8, $9)`,
      [
        user.id,
        user.campusId,
        success ? 'VERIFIED' : 'FAILED',
        input.lat,
        input.lng,
        distance,
        input.accuracyMetres ?? null,
        success ? verifiedAt : null,
        success ? null : accuracyTooPoor ? 'accuracy_too_poor' : 'outside_geofence',
      ],
    );

    if (success) {
      await tx.query(
        `UPDATE users
            SET is_verified = true, verification_method = 'CAMPUS_LOCATION', verified_at = $2
          WHERE id = $1`,
        [user.id, verifiedAt],
      );
      await recordAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: 'verification.location_verified',
        entityType: 'user',
        entityId: user.id,
        metadata: { distanceMetres: Math.round(distance) },
      });
    }
  });

  if (!success) {
    throw new ApiError(
      403,
      accuracyTooPoor ? 'LOCATION_ACCURACY_TOO_POOR' : 'OUTSIDE_CAMPUS',
      accuracyTooPoor
        ? 'Your location reading is not precise enough. Move outdoors and try again.'
        : `You appear to be about ${Math.round(distance)} m from the campus centre, outside the ${campus.geofence_radius_metres} m verification zone. Try again from inside campus, or verify with your college email.`,
      { distanceMetres: Math.round(distance), radiusMetres: campus.geofence_radius_metres },
    );
  }

  logger.info('Student verified by campus location', {
    userId: user.id,
    distanceMetres: Math.round(distance),
  });
  return { verified: true, method: 'CAMPUS_LOCATION', verifiedAt: verifiedAt.toISOString() };
}

export async function getVerificationStatus(
  db: Database,
  user: AuthenticatedUser,
): Promise<{
  isVerified: boolean;
  method: string | null;
  verifiedAt: string | null;
  pendingEmailOtp: { expiresAt: string; attemptsRemaining: number } | null;
}> {
  const { rows } = await db.query<{
    is_verified: boolean;
    verification_method: string | null;
    verified_at: Date | null;
  }>('SELECT is_verified, verification_method, verified_at FROM users WHERE id = $1', [user.id]);
  const profile = rows[0];

  const pending = await db.query<{ expires_at: Date; attempts: number }>(
    `SELECT expires_at, attempts FROM verification_records
      WHERE user_id = $1 AND method = 'COLLEGE_EMAIL' AND status = 'PENDING'
        AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [user.id],
  );

  return {
    isVerified: profile?.is_verified ?? false,
    method: profile?.verification_method ?? null,
    verifiedAt: profile?.verified_at ? new Date(profile.verified_at).toISOString() : null,
    pendingEmailOtp: pending.rows[0]
      ? {
          expiresAt: new Date(pending.rows[0].expires_at).toISOString(),
          attemptsRemaining: Math.max(0, env.OTP_MAX_ATTEMPTS - pending.rows[0].attempts),
        }
      : null,
  };
}
