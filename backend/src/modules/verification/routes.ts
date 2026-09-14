import type { FastifyInstance } from 'fastify';
import { requestEmailOtpSchema, verifyEmailOtpSchema, verifyLocationSchema } from '@campusbuddy/shared';
import { requireAuth } from '../../core/context.js';
import { parseOrThrow } from '../../core/validate.js';
import { loadSelfUser } from '../auth/service.js';
import {
  getVerificationStatus,
  requestEmailOtp,
  verifyCampusLocation,
  verifyEmailOtp,
} from './service.js';

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async (request) => {
    const auth = requireAuth(request);
    return getVerificationStatus(request.db, auth);
  });

  /** Send a one-time code to the student's registered college email. */
  app.post('/email/request', async (request) => {
    const auth = requireAuth(request);
    parseOrThrow(requestEmailOtpSchema, request.body ?? {});
    return requestEmailOtp(request.db, auth);
  });

  app.post('/email/verify', async (request) => {
    const auth = requireAuth(request);
    const body = parseOrThrow(verifyEmailOtpSchema, request.body);
    const result = await verifyEmailOtp(request.db, auth, body.code);
    // Return the refreshed profile so the client's verified flag updates at once.
    return { ...result, user: await loadSelfUser(request.db, auth.id) };
  });

  /** Verify by proving the device is physically inside the campus geofence. */
  app.post('/location/verify', async (request) => {
    const auth = requireAuth(request);
    const body = parseOrThrow(verifyLocationSchema, request.body);
    const result = await verifyCampusLocation(request.db, auth, body);
    return { ...result, user: await loadSelfUser(request.db, auth.id) };
  });
}
