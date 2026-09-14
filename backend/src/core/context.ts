import type { FastifyRequest } from 'fastify';
import type { AccountStatus, UserRole } from '@campusbuddy/shared';
import { ADMIN_ROLES } from '@campusbuddy/shared';
import type { Database, Queryable, RlsContext } from '../db/client.js';
import { ApiError } from './errors.js';
import { verifyAccessToken } from './tokens.js';

/**
 * Authenticated request context.
 *
 * Everything security-relevant here — the user id, campus and role — comes from a
 * signed token and is then re-checked against the live database row on every request,
 * so a suspension or role change takes effect immediately rather than at token expiry.
 */

export interface AuthenticatedUser {
  id: string;
  campusId: string;
  role: UserRole;
  isVerified: boolean;
  accountStatus: AccountStatus;
  suspensionReason: string | null;
  fullName: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedUser | null;
    db: Database;
  }
}

const BEARER = /^Bearer\s+(.+)$/i;

export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = BEARER.exec(header);
  return match ? match[1].trim() : null;
}

/**
 * Resolves the caller, or returns null for anonymous requests.
 * Never throws for a missing token — routes decide whether auth is required.
 */
export async function resolveAuth(
  db: Database,
  token: string | null,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  // Re-read the user in the service context: the token is proof of identity, not a
  // cache of authorisation state.
  const { rows } = await db.query<{
    id: string;
    campus_id: string;
    role: UserRole;
    is_verified: boolean;
    account_status: AccountStatus;
    suspension_reason: string | null;
    full_name: string;
    email: string;
  }>(
    `SELECT id, campus_id, role, is_verified, account_status, suspension_reason, full_name, email
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [claims.sub],
  );

  const row = rows[0];
  if (!row) return null;
  // A token minted before the student changed campus must not keep working.
  if (row.campus_id !== claims.campusId) return null;

  return {
    id: row.id,
    campusId: row.campus_id,
    role: row.role,
    isVerified: row.is_verified,
    accountStatus: row.account_status,
    suspensionReason: row.suspension_reason,
    fullName: row.full_name,
    email: row.email,
  };
}

/** Require a signed-in, non-suspended account. */
export function requireAuth(request: FastifyRequest): AuthenticatedUser {
  const auth = request.auth;
  if (!auth) throw ApiError.unauthorized();
  if (auth.accountStatus === 'SUSPENDED') throw ApiError.suspended(auth.suspensionReason);
  if (auth.accountStatus === 'DEACTIVATED') {
    throw ApiError.forbidden('This account has been deactivated.');
  }
  return auth;
}

/**
 * Require a verified student. Verification is what separates "has an account" from
 * "may transact with other students" (spec §94).
 */
export function requireVerified(request: FastifyRequest): AuthenticatedUser {
  const auth = requireAuth(request);
  if (!auth.isVerified) throw ApiError.notVerified();
  return auth;
}

export function requireStaff(request: FastifyRequest): AuthenticatedUser {
  const auth = requireAuth(request);
  if (!ADMIN_ROLES.includes(auth.role)) {
    throw ApiError.forbidden('This area is restricted to campus staff.');
  }
  return auth;
}

export function requireAdmin(request: FastifyRequest): AuthenticatedUser {
  const auth = requireAuth(request);
  if (auth.role !== 'CAMPUS_ADMIN' && auth.role !== 'PLATFORM_ADMIN') {
    throw ApiError.forbidden('This action requires administrator access.');
  }
  return auth;
}

export function rlsContextFor(user: AuthenticatedUser): RlsContext {
  return { userId: user.id, campusId: user.campusId, role: user.role };
}

/**
 * Runs `fn` inside a transaction where every PostgreSQL RLS policy applies to the
 * given user. This is the default path for user-initiated work.
 */
export function asUser<T>(
  db: Database,
  user: AuthenticatedUser,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return db.asUser(rlsContextFor(user), fn);
}

/**
 * The client's address. Fastify reads X-Forwarded-For into `request.ip` only as far
 * back as TRUST_PROXY allows, so a client cannot claim an address of its own choosing
 * — which is what every per-address rate limit depends on.
 */
export function clientIp(request: FastifyRequest): string {
  return request.ip;
}
