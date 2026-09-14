import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { InvalidTransitionError } from '@campusbuddy/shared';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { getDatabase, type Database } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { bootstrapCampus, getCampus } from './db/bootstrap.js';
import { ApiError, mapDatabaseError } from './core/errors.js';
import { extractBearerToken, resolveAuth } from './core/context.js';
import { consumeRateLimit, consumeRequestBudget, RATE_LIMITS } from './core/rate-limit.js';
import { authRoutes } from './modules/auth/routes.js';
import { verificationRoutes } from './modules/verification/routes.js';
import { requestRoutes } from './modules/requests/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { ratingRoutes } from './modules/ratings/routes.js';
import { listingRoutes } from './modules/listings/routes.js';
import { rentalRoutes } from './modules/rentals/routes.js';
import { moderationRoutes } from './modules/moderation/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { referenceRoutes } from './modules/users/reference.js';
import { productionRoutes } from './modules/production/routes.js';
import { lostFoundRoutes } from './modules/lost-found/routes.js';
import { registerWebsocket } from './realtime/ws.js';

export interface BuildOptions {
  /** Skip migrations when the caller has already prepared the schema (tests). */
  skipMigrations?: boolean;
}

/** 'IN_PROGRESS' → 'in progress', for messages a student reads. */
const humanStatus = (status: string): string => status.toLowerCase().replace(/_/g, ' ');

function isTransitionError(error: unknown): error is InvalidTransitionError {
  return (
    error instanceof InvalidTransitionError ||
    (error as { name?: string } | null)?.name === 'InvalidTransitionError'
  );
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const db: Database = await getDatabase();

  if (!options.skipMigrations) {
    await runMigrations(db);
    await bootstrapCampus(db);
  }

  const app = Fastify({
    logger: false, // We use our own redacting logger.
    // X-Forwarded-For is believed only as far back as there are real proxies in
    // front of the API. Trusting it unconditionally would let any client choose the
    // address that every per-address rate limit is keyed on.
    // A function rather than the hop count because Fastify's types omit the numeric
    // form; it means exactly the same thing: trust the nearest TRUST_PROXY hops.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY,
    bodyLimit: 1_000_000,
    // Correlation ids make a 500 in the log traceable to the response the user saw.
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Same-origin and non-browser callers send no Origin header. An origin that is
      // not on the list simply receives no CORS headers, so the browser blocks the
      // response; that is a refusal, not a server error.
      callback(null, !origin || env.corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Multipart parsing is registered once for the whole app, so any route — general
  // uploads, profile photos, payment QR codes — can accept a file.
  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  });

  // The database handle and the resolved identity are attached to every request.
  // These are assigned in the hook rather than via decorateRequest because Fastify 5
  // does not allow a plain `null` default for a reference-typed request decorator.
  app.addHook('onRequest', async (request) => {
    request.db = db;
    request.auth = await resolveAuth(db, extractBearerToken(request));

    // An overall ceiling per signed-in student, against runaway scripts. The
    // anonymous endpoints (sign-in, registration) carry their own, stricter limits.
    if (request.auth) {
      const budget = env.isProduction
        ? await consumeRateLimit(db, RATE_LIMITS.overall, `user:${request.auth.id}`)
        : consumeRequestBudget(`user:${request.auth.id}`);
      if (!budget.allowed) {
        throw ApiError.tooManyRequests(
          'You are doing that too often. Please slow down for a moment.',
          budget.retryAfterSeconds,
        );
      }
    }
  });

  // Mutating clients may retry after a timeout. An Idempotency-Key makes the
  // operation safe across retries and across API instances.
  const idempotencyRequests = new WeakMap<FastifyRequest, { userId: string; key: string }>();
  app.addHook('preHandler', async (request, reply) => {
    if (!request.auth || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    if (request.isMultipart()) return;
    const rawKey = request.headers['idempotency-key'];
    if (!rawKey) return;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw ApiError.badRequest('Idempotency-Key must be 8–128 letters, numbers or . _ : - characters.');
    }
    const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? null)).digest('hex');
    const inserted = await db.query(
      `INSERT INTO idempotency_keys (user_id, key, method, path, request_hash)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [request.auth.id, key, request.method, request.url, requestHash],
    );
    if (inserted.rowCount === 0) {
      const existing = await db.query<{
        method: string; path: string; request_hash: string; status_code: number | null; response_body: unknown;
      }>('SELECT method, path, request_hash, status_code, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2', [request.auth.id, key]);
      const row = existing.rows[0];
      if (!row || row.method !== request.method || row.path !== request.url || row.request_hash !== requestHash) {
        throw ApiError.conflict('That idempotency key was already used for a different request.', 'IDEMPOTENCY_KEY_REUSED');
      }
      if (row.status_code === null) {
        throw ApiError.conflict('An identical request is still being processed.', 'REQUEST_IN_PROGRESS');
      }
      return reply.code(row.status_code).send(row.response_body);
    }
    idempotencyRequests.set(request, { userId: request.auth.id, key });
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    // API responses carry private data and must never sit in a shared cache. File
    // downloads set their own, deliberately cacheable, policy.
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    const idempotency = idempotencyRequests.get(_request);
    if (idempotency && reply.statusCode < 500) {
      let body: unknown = null;
      if (typeof payload === 'string') {
        try { body = JSON.parse(payload); } catch { body = payload; }
      }
      await db.query(
        `UPDATE idempotency_keys SET status_code = $3, response_body = $4
          WHERE user_id = $1 AND key = $2`,
        [idempotency.userId, idempotency.key, reply.statusCode, JSON.stringify(body)],
      );
    } else if (idempotency) {
      // A transient server failure must remain retryable with the same key. Keeping
      // an unfinished row would turn every retry into REQUEST_IN_PROGRESS for 24h.
      await db.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [
        idempotency.userId,
        idempotency.key,
      ]);
    }
    return payload;
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof ApiError) {
      const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (error.statusCode === 429 && retryAfter) reply.header('retry-after', String(retryAfter));
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          requestId: request.id,
        },
      });
    }

    // A lifecycle move the state machine forbids. That is a stale screen or a double
    // tap, never a server fault, so it must not surface as a 500.
    if (isTransitionError(error)) {
      const actorRefused = error.reason === 'ACTOR_NOT_ALLOWED';
      const entity = error.entity.toLowerCase();
      return reply.code(actorRefused ? 403 : 409).send({
        error: {
          code: actorRefused ? 'ACTION_NOT_ALLOWED' : 'INVALID_TRANSITION',
          message: actorRefused
            ? `You cannot do that on this ${entity}.`
            : `That can no longer be done: this ${entity} is now ${humanStatus(error.from)}. Refresh to see the latest.`,
          details: { from: error.from, to: error.to },
          requestId: request.id,
        },
      });
    }

    // Constraint and RLS violations are meaningful refusals, not server faults.
    const mapped = mapDatabaseError(error);
    if (mapped) {
      return reply.code(mapped.statusCode).send({
        error: {
          code: mapped.code,
          message: mapped.message,
          ...(mapped.details !== undefined ? { details: mapped.details } : {}),
          requestId: request.id,
        },
      });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code ?? 'BAD_REQUEST',
          message: error.message,
          requestId: request.id,
        },
      });
    }

    // Anything else is a genuine bug: log it in full, tell the user nothing specific.
    logger.error('Unhandled error', {
      requestId: request.id,
      method: request.method,
      url: request.url,
      message: error.message,
      stack: error.stack,
    });
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  // --- Health -------------------------------------------------------------
  app.get('/api/health', async () => {
    const campus = await getCampus(db);
    return {
      status: 'ok',
      driver: db.driver,
      campus: campus.name,
      institution: campus.institutionName,
      time: new Date().toISOString(),
    };
  });

  // --- Routes -------------------------------------------------------------
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(verificationRoutes, { prefix: '/api/verification' });
  await app.register(referenceRoutes, { prefix: '/api' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(requestRoutes, { prefix: '/api/requests' });
  await app.register(chatRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(paymentRoutes, { prefix: '/api/payments' });
  await app.register(ratingRoutes, { prefix: '/api' });
  await app.register(listingRoutes, { prefix: '/api/listings' });
  await app.register(lostFoundRoutes, { prefix: '/api/lost-found' });
  await app.register(rentalRoutes, { prefix: '/api' });
  await app.register(moderationRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(uploadRoutes, { prefix: '/api/uploads' });
  await app.register(productionRoutes, { prefix: '/api' });

  await registerWebsocket(app, db);

  return app;
}
