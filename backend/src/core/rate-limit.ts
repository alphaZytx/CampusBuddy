import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import type { Database } from '../db/client.js';

/**
 * Sliding-window rate limiting backed by the database, so limits survive restarts
 * and hold across multiple server processes (spec §48, §63).
 *
 * Used for the abuse-prone paths: login, registration, OTP requests, request
 * creation, offers and messages.
 */

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  // Per account: the brute-force guard on one student's password.
  login: { bucket: 'login', limit: env.AUTH_RATE_LIMIT_MAX, windowSeconds: 300 },
  // Per network address: loose enough for a hostel sharing one Wi-Fi address, tight
  // enough to stop one machine spraying passwords across many accounts.
  loginIp: { bucket: 'login_ip', limit: env.AUTH_IP_RATE_LIMIT_MAX, windowSeconds: 300 },
  // Configurable so an integration test suite can create many accounts without
  // weakening the protection that ships by default.
  register: { bucket: 'register', limit: env.REGISTER_RATE_LIMIT_MAX, windowSeconds: 3600 },
  otpRequest: { bucket: 'otp_request', limit: 5, windowSeconds: 3600 },
  otpVerify: { bucket: 'otp_verify', limit: 10, windowSeconds: 900 },
  locationVerify: { bucket: 'location_verify', limit: 10, windowSeconds: 3600 },
  createRequest: { bucket: 'create_request', limit: 20, windowSeconds: 3600 },
  createOffer: { bucket: 'create_offer', limit: 60, windowSeconds: 3600 },
  sendMessage: { bucket: 'send_message', limit: 120, windowSeconds: 300 },
  upload: { bucket: 'upload', limit: 30, windowSeconds: 3600 },
  report: { bucket: 'report', limit: 10, windowSeconds: 86400 },
  overall: {
    bucket: 'overall',
    limit: env.RATE_LIMIT_MAX_REQUESTS,
    windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
  },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Records one attempt and reports whether it is within the limit.
 * Runs in the service context because the counters must not be readable or
 * forgeable by the very users being limited.
 */
export async function consumeRateLimit(
  db: Database,
  rule: RateLimitRule,
  identifier: string,
): Promise<RateLimitResult> {
  return db.transaction(async (tx) => {
    // Attempts on the same counter queue behind each other. Without this, a burst
    // of parallel requests could all read "under the limit" before any of them is
    // recorded, and a brute-force script would get far more than its allowance.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${rule.bucket}:${identifier}`,
    ]);

    const since = new Date(Date.now() - rule.windowSeconds * 1000);

    const { rows } = await tx.query<{ count: string; oldest: Date | null }>(
      `SELECT count(*)::text AS count, min(created_at) AS oldest
         FROM rate_limit_events
        WHERE bucket = $1 AND identifier = $2 AND created_at > $3`,
      [rule.bucket, identifier, since],
    );
    const used = Number(rows[0]?.count ?? 0);

    if (used >= rule.limit) {
      const oldest = rows[0]?.oldest ? new Date(rows[0].oldest) : new Date();
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest.getTime() + rule.windowSeconds * 1000 - Date.now()) / 1000),
      );
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    await tx.query(
      'INSERT INTO rate_limit_events (bucket, identifier) VALUES ($1, $2)',
      [rule.bucket, identifier],
    );
    return { allowed: true, remaining: rule.limit - used - 1, retryAfterSeconds: 0 };
  });
}

/** Consume a slot or throw the 429 directly. */
export async function enforceRateLimit(
  db: Database,
  rule: RateLimitRule,
  identifier: string,
  message = 'Too many attempts. Please wait a moment and try again.',
): Promise<void> {
  const result = await consumeRateLimit(db, rule, identifier);
  if (!result.allowed) {
    throw ApiError.tooManyRequests(message, result.retryAfterSeconds);
  }
}

/** Housekeeping: drop counters older than the longest window we use. */
export async function pruneRateLimitEvents(db: Database): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM rate_limit_events WHERE created_at < now() - interval '2 days'`,
  );
  return rowCount;
}

// ---------------------------------------------------------------------------
// Overall request budget
// ---------------------------------------------------------------------------

interface RequestWindow {
  startedAt: number;
  count: number;
}

const requestWindows = new Map<string, RequestWindow>();

/**
 * A fixed-window ceiling on overall API traffic per signed-in student
 * (RATE_LIMIT_MAX_REQUESTS per RATE_LIMIT_WINDOW_SECONDS). It exists to stop a runaway
 * script, not to meter normal use, so it is generous and kept in memory rather than
 * costing a database write on every request. It is per process, which matches the
 * single-process deployment described in DEPLOYMENT.md.
 */
export function consumeRequestBudget(key: string, now: number = Date.now()): RateLimitResult {
  const windowMs = env.RATE_LIMIT_WINDOW_SECONDS * 1000;
  let window = requestWindows.get(key);
  if (!window || now - window.startedAt >= windowMs) {
    if (requestWindows.size >= 10_000) pruneRequestWindows(now, windowMs);
    window = { startedAt: now, count: 0 };
    requestWindows.set(key, window);
  }

  window.count += 1;
  if (window.count > env.RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + windowMs - now) / 1000)),
    };
  }
  return {
    allowed: true,
    remaining: env.RATE_LIMIT_MAX_REQUESTS - window.count,
    retryAfterSeconds: 0,
  };
}

function pruneRequestWindows(now: number, windowMs: number): void {
  for (const [key, window] of requestWindows) {
    if (now - window.startedAt >= windowMs) requestWindows.delete(key);
  }
}
