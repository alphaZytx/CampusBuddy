import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loginSchema, passwordSchema, refreshSchema, registerSchema } from '@campusbuddy/shared';
import { clientIp, requireAuth } from '../../core/context.js';
import { enforceRateLimit, RATE_LIMITS } from '../../core/rate-limit.js';
import { parseOrThrow } from '../../core/validate.js';
import {
  changePassword,
  loadSelfUser,
  loginStudent,
  logout,
  refreshSession,
  registerStudent,
} from './service.js';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});

const logoutSchema = z.object({ refreshToken: z.string().optional() });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Create an account. Campus membership comes from the email domain, not the body. */
  app.post('/register', async (request, reply) => {
    const body = parseOrThrow(registerSchema, request.body);
    const ip = clientIp(request);

    // Limited per IP: one machine cannot mass-register accounts (spec §63).
    await enforceRateLimit(
      request.db,
      RATE_LIMITS.register,
      ip,
      'Too many accounts created from this network. Please try again later.',
    );

    const session = await registerStudent(request.db, {
      ...body,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: ip,
    });
    return reply.code(201).send(session);
  });

  app.post('/login', async (request) => {
    const body = parseOrThrow(loginSchema, request.body);
    const ip = clientIp(request);

    // Throttled on both the account and the source address, so neither a single
    // account nor a single machine can be used to brute force.
    await enforceRateLimit(
      request.db,
      RATE_LIMITS.login,
      `email:${body.email}`,
      'Too many sign-in attempts for this account. Please wait a few minutes.',
    );
    await enforceRateLimit(
      request.db,
      RATE_LIMITS.loginIp,
      `ip:${ip}`,
      'Too many sign-in attempts from this network. Please wait a few minutes.',
    );

    return loginStudent(request.db, {
      ...body,
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: ip,
    });
  });

  app.post('/refresh', async (request) => {
    const body = parseOrThrow(refreshSchema, request.body);
    return refreshSession(
      request.db,
      body.refreshToken,
      request.headers['user-agent'] ?? null,
      clientIp(request),
    );
  });

  app.post('/logout', async (request, reply) => {
    const body = parseOrThrow(logoutSchema, request.body ?? {});
    if (body.refreshToken) {
      // Presenting a refresh token ends exactly that session. Possession is proof
      // enough, so this works even after the access token has expired, which is
      // precisely when a student coming back to the app tends to sign out.
      await logout(request.db, body.refreshToken, null);
    } else {
      // Without one, a signed-in student is signed out on every device.
      const auth = requireAuth(request);
      await logout(request.db, null, auth.id);
    }
    return reply.code(204).send();
  });

  /** The signed-in student's own profile, including private fields. */
  app.get('/me', async (request) => {
    const auth = requireAuth(request);
    const user = await loadSelfUser(request.db, auth.id);
    return { user };
  });

  app.post('/change-password', async (request, reply) => {
    const auth = requireAuth(request);
    const body = parseOrThrow(changePasswordSchema, request.body);
    await changePassword(request.db, auth.id, body.currentPassword, body.newPassword);
    return reply.code(204).send();
  });
}
