import type { AuthSession, SelfUser } from '@campusbuddy/shared';
import { env } from '../../config/env.js';
import type { Database, Queryable } from '../../db/client.js';
import { getCampus } from '../../db/bootstrap.js';
import { ApiError } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import {
  accessTokenTtlSeconds,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../core/tokens.js';
import { toSelfUser, type SelfUserRow } from '../../core/serializers.js';
import { recordAudit } from '../../core/audit.js';

/**
 * Authentication.
 *
 * All of this runs in the trusted service context, because it must read
 * `user_credentials` — a table the RLS-bound application role has no privileges on
 * at all. Registration also decides campus membership, which is precisely the value
 * a client must never be able to choose for itself (spec §95).
 */

export const SELF_USER_COLUMNS = `
  p.id, p.full_name, p.avatar_attachment_id, p.bio, p.department_code, p.department_name,
  p.department_id, p.hostel_id, p.year_of_study, p.is_verified, p.verification_method,
  p.average_rating, p.rating_count, p.completed_tasks, p.completion_rate,
  p.cancellation_rate, p.response_rate, p.reliability_score, p.tier, p.availability,
  p.skills, p.badges, p.member_since, p.campus_id, p.role, p.account_status,
  u.email, u.phone, u.upi_id, u.upi_qr_attachment_id, u.total_earned_paise,
  h.name AS hostel_name,
  COALESCE(pref.preferred_categories, '{}') AS preferred_categories,
  COALESCE(pref.min_reward_paise, 0)        AS min_reward_paise,
  COALESCE(pref.max_distance_metres, 2000)  AS max_distance_metres,
  to_jsonb(np)                              AS notification_preferences,
  COALESCE((
    SELECT sum(pay.amount_paise) FROM payments pay
     WHERE pay.payee_id = u.id
       AND pay.status IN ('PAYMENT_PENDING','PAYMENT_INITIATED','PAYMENT_CLAIMED')
  ), 0) AS pending_earnings_paise
`;

const SELF_USER_FROM = `
  FROM users u
  JOIN public_user_profiles p ON p.id = u.id
  LEFT JOIN hostels h                  ON h.id = u.hostel_id
  LEFT JOIN user_preferences pref      ON pref.user_id = u.id
  LEFT JOIN notification_preferences np ON np.user_id = u.id
`;

/** Loads the full self-profile. Runs in the service context; callers must authorise. */
export async function loadSelfUser(tx: Queryable, userId: string): Promise<SelfUser> {
  const { rows } = await tx.query<SelfUserRow>(
    `SELECT ${SELF_USER_COLUMNS} ${SELF_USER_FROM} WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw ApiError.notFound('Account not found.');
  return toSelfUser(row);
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * Campus membership is derived from the email domain, never accepted from the client.
 * An address outside the configured domains cannot create an account at all.
 */
export function assertAllowedEmailDomain(email: string): void {
  const domain = emailDomain(email);
  if (!env.allowedEmailDomains.includes(domain)) {
    const allowed = env.allowedEmailDomains.map((d) => `@${d}`).join(', ');
    throw new ApiError(
      403,
      'EMAIL_DOMAIN_NOT_ALLOWED',
      `CampusBuddy is only for ${env.INSTITUTION_SHORT_NAME} ${env.CAMPUS_NAME} students. Register with your college email (${allowed}).`,
    );
  }
}

/** Advisory check on the local part, e.g. `rahul.ug22.cs@nitp.ac.in`. Never blocking. */
export function looksLikeStudentAddress(email: string): boolean {
  try {
    return new RegExp(env.STUDENT_EMAIL_PATTERN, 'i').test(email);
  } catch {
    return true;
  }
}

export interface RegisterParams {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  departmentId?: string;
  hostelId?: string;
  yearOfStudy?: number;
  semester?: number;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function registerStudent(db: Database, params: RegisterParams): Promise<AuthSession> {
  assertAllowedEmailDomain(params.email);
  const campus = await getCampus(db);
  const passwordHash = await hashPassword(params.password);

  const userId = await db.transaction(async (tx) => {
    // Referenced department/hostel must belong to this campus; otherwise a client
    // could point at another campus's rows.
    if (params.departmentId) {
      const { rows } = await tx.query('SELECT 1 FROM departments WHERE id = $1 AND campus_id = $2', [
        params.departmentId,
        campus.campusId,
      ]);
      if (rows.length === 0) throw ApiError.badRequest('That department is not on this campus.');
    }
    if (params.hostelId) {
      const { rows } = await tx.query('SELECT 1 FROM hostels WHERE id = $1 AND campus_id = $2', [
        params.hostelId,
        campus.campusId,
      ]);
      if (rows.length === 0) throw ApiError.badRequest('That hostel is not on this campus.');
    }

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO users (campus_id, department_id, hostel_id, email, full_name, phone,
                          year_of_study, semester)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        campus.campusId,
        params.departmentId ?? null,
        params.hostelId ?? null,
        params.email,
        params.fullName,
        params.phone ?? null,
        params.yearOfStudy ?? null,
        params.semester ?? null,
      ],
    );
    const id = inserted.rows[0].id;

    await tx.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
      id,
      passwordHash,
    ]);
    await tx.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [id]);
    await tx.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [id]);

    await recordAudit(tx, {
      actorId: id,
      actorRole: 'STUDENT',
      action: 'auth.register',
      entityType: 'user',
      entityId: id,
      metadata: { emailDomain: emailDomain(params.email) },
      ipAddress: params.ipAddress ?? null,
    });

    return id;
  });

  return issueSession(db, userId, params.userAgent ?? null, params.ipAddress ?? null);
}

export interface LoginParams {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export async function loginStudent(db: Database, params: LoginParams): Promise<AuthSession> {
  const campus = await getCampus(db);

  const { rows } = await db.query<{
    id: string;
    account_status: string;
    suspension_reason: string | null;
    password_hash: string | null;
  }>(
    `SELECT u.id, u.account_status, u.suspension_reason, c.password_hash
       FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE u.campus_id = $1 AND lower(u.email) = lower($2) AND u.deleted_at IS NULL`,
    [campus.campusId, params.email],
  );
  const row = rows[0];

  // Always run a hash comparison, even when no such account exists, so response time
  // does not reveal whether an email is registered.
  const stored = row?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
  const passwordMatches = await verifyPassword(params.password, stored);

  if (!row || !row.password_hash || !passwordMatches) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email or password is not correct.');
  }
  if (row.account_status === 'SUSPENDED') throw ApiError.suspended(row.suspension_reason);
  if (row.account_status === 'DEACTIVATED') {
    throw ApiError.forbidden('This account has been deactivated.');
  }

  await db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [row.id]);
  return issueSession(db, row.id, params.userAgent ?? null, params.ipAddress ?? null);
}

/** Mints an access token and a fresh refresh token, storing only the refresh hash. */
export async function issueSession(
  db: Database,
  userId: string,
  userAgent: string | null,
  ipAddress: string | null,
  replacesSessionId?: string,
): Promise<AuthSession> {
  return db.transaction(async (tx) => {
    const user = await loadSelfUser(tx, userId);

    const refreshToken = generateRefreshToken();
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, hashToken(refreshToken), userAgent, ipAddress, refreshTokenExpiry()],
    );

    if (replacesSessionId) {
      await tx.query('UPDATE sessions SET replaced_by = $1 WHERE id = $2', [
        rows[0].id,
        replacesSessionId,
      ]);
    }

    const accessToken = await signAccessToken({
      sub: user.id,
      campusId: user.campusId,
      role: user.role,
      verified: user.isVerified,
    });

    return { accessToken, refreshToken, expiresIn: accessTokenTtlSeconds(), user };
  });
}

/**
 * Exchanges a refresh token for a new pair, rotating the old one.
 *
 * Presenting an already-rotated token is treated as theft: every session for that
 * user is revoked, because either the token was stolen or the legitimate client is
 * replaying — and both warrant re-authentication.
 */
export async function refreshSession(
  db: Database,
  refreshToken: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<AuthSession> {
  const tokenHash = hashToken(refreshToken);

  const { rows } = await db.query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    replaced_by: string | null;
    account_status: string;
    suspension_reason: string | null;
  }>(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.replaced_by,
            u.account_status, u.suspension_reason
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND u.deleted_at IS NULL`,
    [tokenHash],
  );
  const session = rows[0];
  if (!session) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Please sign in again.');

  if (session.replaced_by || session.revoked_at) {
    await db.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [session.user_id],
    );
    throw new ApiError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Your session was refreshed elsewhere. Please sign in again.',
    );
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new ApiError(401, 'REFRESH_TOKEN_EXPIRED', 'Your session expired. Please sign in again.');
  }
  if (session.account_status === 'SUSPENDED') throw ApiError.suspended(session.suspension_reason);
  if (session.account_status === 'DEACTIVATED') {
    throw ApiError.forbidden('This account has been deactivated.');
  }

  // Claim the rotation atomically. Two refreshes racing with the same token (two tabs
  // waking at once) must not both succeed. The loser is refused, but a race is not
  // theft, so the student's other devices stay signed in.
  const claimed = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 AND revoked_at IS NULL AND replaced_by IS NULL`,
    [session.id],
  );
  if (claimed.rowCount === 0) {
    throw new ApiError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Your session was refreshed elsewhere. Please sign in again.',
    );
  }
  return issueSession(db, session.user_id, userAgent, ipAddress, session.id);
}

/**
 * Ends one session (identified by its refresh token) or, given only a user, every
 * session that user has.
 */
export async function logout(
  db: Database,
  refreshToken: string | null,
  userId: string | null,
): Promise<void> {
  if (refreshToken) {
    await db.query(
      'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hashToken(refreshToken)],
    );
    return;
  }
  if (!userId) return;
  await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}

export async function changePassword(
  db: Database,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { rows } = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM user_credentials WHERE user_id = $1',
    [userId],
  );
  const stored = rows[0]?.password_hash;
  if (!stored || !(await verifyPassword(currentPassword, stored))) {
    throw new ApiError(400, 'INVALID_CREDENTIALS', 'Your current password is not correct.');
  }

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.query(
      'UPDATE user_credentials SET password_hash = $1, updated_at = now() WHERE user_id = $2',
      [passwordHash, userId],
    );
    // Changing a password invalidates every other device.
    await tx.query(
      'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    await recordAudit(tx, {
      actorId: userId,
      actorRole: 'STUDENT',
      action: 'auth.change_password',
      entityType: 'user',
      entityId: userId,
    });
  });
}
