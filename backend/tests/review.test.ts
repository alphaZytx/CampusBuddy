import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createTestApp,
  destroyTestApp,
  futureIso,
  promoteToAdmin,
  registerStudent,
  uploadFile,
  type TestUser,
} from './helpers.js';
import { TINY_PNG } from './fixtures.js';
import { getDatabase } from '../src/db/client.js';
import { bootstrapCampus } from '../src/db/bootstrap.js';
import { activateScheduledRequests, escalateRewards } from '../src/jobs/scheduler.js';
import { consumeRequestBudget } from '../src/core/rate-limit.js';
import { campusHour, formatCampusTime } from '../src/core/campus-time.js';
import { env } from '../src/config/env.js';

/**
 * Regression tests for the problems found in the pre-release review. Each `it`
 * failed, or could not have passed, before its fix.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => destroyTestApp(app));

interface RequestView {
  id: string;
  status: string;
  rewardPaise: number;
  availableActions: string[];
  payment: { status: string } | null;
}
type RequestResponse = { request: RequestView; error?: { code: string; message: string } };

async function postRequest(owner: TestUser, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await api<RequestResponse>(app, 'POST', '/api/requests', {
    token: owner.accessToken,
    body: { title: 'Bring a phone charger', categorySlug: 'quick-delivery', rewardPaise: 2000, ...overrides },
  });
  expect(response.status).toBe(201);
  return response.body.request.id;
}

async function offer(helper: TestUser, requestId: string): Promise<string> {
  const response = await api<{ offer: { id: string } }>(app, 'POST', `/api/requests/${requestId}/offers`, {
    token: helper.accessToken,
    body: {},
  });
  expect(response.status).toBe(201);
  return response.body.offer.id;
}

function act(user: TestUser, requestId: string, path: string, body: unknown = {}) {
  return api<RequestResponse>(app, 'POST', `/api/requests/${requestId}/${path}`, {
    token: user.accessToken,
    body,
  });
}

async function viewRequest(user: TestUser, requestId: string): Promise<RequestView> {
  const response = await api<RequestResponse>(app, 'GET', `/api/requests/${requestId}`, { token: user.accessToken });
  expect(response.status).toBe(200);
  return response.body.request;
}

/** A helper who has been selected, accepted and started on a fresh request. */
async function taskInProgress(): Promise<{ requester: TestUser; helper: TestUser; requestId: string }> {
  const requester = await registerStudent(app);
  const helper = await registerStudent(app);
  const requestId = await postRequest(requester);
  const offerId = await offer(helper, requestId);
  expect((await act(requester, requestId, 'select-helper', { offerId })).status).toBe(200);
  expect((await act(helper, requestId, 'accept')).status).toBe(200);
  expect((await act(helper, requestId, 'start')).status).toBe(200);
  return { requester, helper, requestId };
}

async function notifiedAbout(requestId: string, type: string): Promise<string[]> {
  const db = await getDatabase();
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM notifications WHERE type = $1 AND data->>'requestId' = $2`,
    [type, requestId],
  );
  return rows.map((row) => row.user_id);
}

// ---------------------------------------------------------------------------

describe('a helper leaving a task', () => {
  it('lets a selected helper decline, reopening the request', async () => {
    const requester = await registerStudent(app);
    const helper = await registerStudent(app);
    const requestId = await postRequest(requester);
    const offerId = await offer(helper, requestId);
    await act(requester, requestId, 'select-helper', { offerId });

    const declined = await act(helper, requestId, 'decline-selection');
    expect(declined.status).toBe(200);
    expect((await viewRequest(requester, requestId)).status).toBe('OPEN');
  });

  it('lets a helper withdraw mid-task, and the requester choose someone else', async () => {
    const requester = await registerStudent(app);
    const first = await registerStudent(app);
    const second = await registerStudent(app);
    const requestId = await postRequest(requester);
    const firstOffer = await offer(first, requestId);
    await offer(second, requestId);

    await act(requester, requestId, 'select-helper', { offerId: firstOffer });
    await act(first, requestId, 'accept');
    await act(first, requestId, 'start');

    const withdrew = await act(first, requestId, 'withdraw');
    expect(withdrew.status).toBe(200);

    const reopened = await act(requester, requestId, 'reopen');
    expect(reopened.status).toBe(200);
    expect(reopened.body.request.status).toBe('OPEN');

    // The helper passed over the first time can offer again...
    expect((await viewRequest(second, requestId)).availableActions).toContain('make_offer');
    const renewed = await offer(second, requestId);

    // ...and be chosen, which the first helper's stale accepted offer used to block.
    const selected = await act(requester, requestId, 'select-helper', { offerId: renewed });
    expect(selected.status).toBe(200);
    expect(selected.body.request.status).toBe('HELPER_SELECTED');

    // The withdrawal is on the first helper's record...
    const db = await getDatabase();
    const { rows } = await db.query<{ cancelled_tasks: number }>(
      'SELECT cancelled_tasks FROM users WHERE id = $1',
      [first.id],
    );
    expect(rows[0].cancelled_tasks).toBe(1);

    // ...and they can no longer read the chat the requester now shares with the new helper.
    const chat = await api<{ conversationId: string }>(app, 'GET', `/api/requests/${requestId}/conversation`, {
      token: requester.accessToken,
    });
    const thread = `/api/conversations/${chat.body.conversationId}/messages`;
    expect((await api(app, 'GET', thread, { token: first.accessToken })).status).toBe(404);
    expect((await api(app, 'GET', thread, { token: second.accessToken })).status).toBe(200);
  });
});

describe('lifecycle moves that are not allowed', () => {
  it('answers a stale action with 409 and the wrong party with 403, never 500', async () => {
    const requester = await registerStudent(app);
    const helper = await registerStudent(app);
    const requestId = await postRequest(requester);

    // Reopening a request that is already open: the kind of thing a stale screen sends.
    const stale = await act(requester, requestId, 'reopen');
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('INVALID_TRANSITION');

    const offerId = await offer(helper, requestId);
    await act(requester, requestId, 'select-helper', { offerId });
    await act(helper, requestId, 'accept');

    // Starting the work is the helper's move, not the requester's.
    const wrongParty = await act(requester, requestId, 'start');
    expect(wrongParty.status).toBe(403);
    expect(wrongParty.body.error?.code).toBe('ACTION_NOT_ALLOWED');
  });
});

describe('notification preferences', () => {
  it('alerts only the helpers whose own settings match, and never the requester', async () => {
    const requester = await registerStudent(app);
    const willing = await registerStudent(app);
    const optedOut = await registerStudent(app);
    const busy = await registerStudent(app);

    const db = await getDatabase();
    // Preferring the category puts this helper at the top of the ranking, whatever
    // else this suite has registered.
    await db.query(`UPDATE user_preferences SET preferred_categories = '{quick-delivery}' WHERE user_id = $1`, [
      willing.id,
    ]);
    await db.query('UPDATE notification_preferences SET new_matching_requests = false WHERE user_id = $1', [
      optedOut.id,
    ]);
    await db.query(`UPDATE user_preferences SET availability = 'BUSY' WHERE user_id = $1`, [busy.id]);

    const requestId = await postRequest(requester);
    const notified = await notifiedAbout(requestId, 'REQUEST_CREATED');
    expect(notified).toContain(willing.id);
    expect(notified).not.toContain(optedOut.id);
    expect(notified).not.toContain(busy.id);
    expect(notified).not.toContain(requester.id);
  });

  it('honours a helper who switched off offer notifications', async () => {
    const requester = await registerStudent(app);
    const helper = await registerStudent(app);
    await api(app, 'PATCH', '/api/users/me/notification-preferences', {
      token: helper.accessToken,
      body: { offers: false },
    });

    const requestId = await postRequest(requester);
    const offerId = await offer(helper, requestId);
    await act(requester, requestId, 'select-helper', { offerId });

    expect(await notifiedAbout(requestId, 'HELPER_SELECTED')).not.toContain(helper.id);
  });

  it('keeps quiet hours when another setting is saved, and clears them only when asked', async () => {
    const student = await registerStudent(app);
    type Prefs = { user: { notificationPreferences: Record<string, unknown> } };
    const path = '/api/users/me/notification-preferences';

    await api(app, 'PATCH', path, { token: student.accessToken, body: { quietHoursStart: 22, quietHoursEnd: 7 } });
    const saved = await api<Prefs>(app, 'PATCH', path, { token: student.accessToken, body: { chat: false } });
    expect(saved.body.user.notificationPreferences).toMatchObject({
      chat: false,
      quietHoursStart: 22,
      quietHoursEnd: 7,
    });

    const cleared = await api<Prefs>(app, 'PATCH', path, {
      token: student.accessToken,
      body: { quietHoursStart: null, quietHoursEnd: null },
    });
    expect(cleared.body.user.notificationPreferences.quietHoursStart).toBeNull();
  });

  it('lets an availability end time be cleared', async () => {
    const student = await registerStudent(app);
    await api(app, 'PATCH', '/api/users/me/preferences', {
      token: student.accessToken,
      body: { availability: 'AVAILABLE_NOW', availableUntil: futureIso(60) },
    });
    await api(app, 'PATCH', '/api/users/me/preferences', {
      token: student.accessToken,
      body: { availableUntil: null },
    });

    const db = await getDatabase();
    const { rows } = await db.query<{ available_until: Date | null }>(
      'SELECT available_until FROM user_preferences WHERE user_id = $1',
      [student.id],
    );
    expect(rows[0].available_until).toBeNull();
  });
});

describe('email verification', () => {
  it('counts wrong codes, and retires the code after the last allowed attempt', async () => {
    const student = await registerStudent(app, { verify: false });
    const sent = await api<{ devCode: string }>(app, 'POST', '/api/verification/email/request', {
      token: student.accessToken,
      body: {},
    });
    const wrong = sent.body.devCode === '000000' ? '111111' : '000000';

    const messages: string[] = [];
    for (let attempt = 0; attempt < env.OTP_MAX_ATTEMPTS; attempt += 1) {
      const response = await api<{ error: { message: string } }>(app, 'POST', '/api/verification/email/verify', {
        token: student.accessToken,
        body: { code: wrong },
      });
      expect(response.status).toBe(400);
      messages.push(response.body.error.message);
    }
    expect(messages[0]).toContain(`${env.OTP_MAX_ATTEMPTS - 1} attempts left`);
    expect(messages[messages.length - 1]).toContain('Request a new code');

    // Once the attempts are used up, even the right code no longer works.
    const late = await api(app, 'POST', '/api/verification/email/verify', {
      token: student.accessToken,
      body: { code: sent.body.devCode },
    });
    expect(late.status).toBe(400);
  });
});

describe('sessions', () => {
  it('signs out only the device whose refresh token is presented, without an access token', async () => {
    const student = await registerStudent(app);
    const otherDevice = await api<{ refreshToken: string }>(app, 'POST', '/api/auth/login', {
      body: { email: student.email, password: 'CampusBuddy@2026' },
    });

    const signedOut = await api(app, 'POST', '/api/auth/logout', { body: { refreshToken: student.refreshToken } });
    expect(signedOut.status).toBe(204);

    const stillSignedIn = await api(app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: otherDevice.body.refreshToken },
    });
    expect(stillSignedIn.status).toBe(200);
    expect(
      (await api(app, 'POST', '/api/auth/refresh', { body: { refreshToken: student.refreshToken } })).status,
    ).toBe(401);
  });
});

describe('HTTP hygiene', () => {
  it('ignores a client-supplied X-Forwarded-For when no proxy is configured', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'x-forwarded-for': '203.0.113.77' },
      payload: { fullName: 'Spoof Test', email: 'spoof.test@nitp.ac.in', password: 'CampusBuddy@2026' },
    });
    expect(response.statusCode).toBe(201);

    const db = await getDatabase();
    const { rows } = await db.query<{ ip_address: string | null }>(
      `SELECT ip_address::text AS ip_address FROM audit_logs WHERE action = 'auth.register' AND entity_id = $1`,
      [(JSON.parse(response.body) as { user: { id: string } }).user.id],
    );
    expect(rows[0].ip_address).not.toContain('203.0.113.77');
  });

  it('refuses an unknown origin quietly rather than with a 500', async () => {
    const refused = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(refused.statusCode).toBe(200);
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();

    const allowed = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('marks API responses as private and not to be sniffed', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('private invitations', () => {
  it('invites only verified students on this campus, never yourself', async () => {
    const requester = await registerStudent(app);
    const unverified = await registerStudent(app, { verify: false });
    const trusted = await registerStudent(app);
    const bystander = await registerStudent(app);
    const invite = (ids: string[]) =>
      api<RequestResponse>(app, 'POST', '/api/requests', {
        token: requester.accessToken,
        body: {
          title: 'Proofread my report',
          categorySlug: 'academic-help',
          rewardPaise: 5000,
          visibility: 'FAVOURITES',
          invitedHelperIds: ids,
        },
      });

    expect((await invite([requester.id])).status).toBe(400);
    expect((await invite([unverified.id])).status).toBe(400);

    const sent = await invite([trusted.id]);
    expect(sent.status).toBe(201);
    const requestId = sent.body.request.id;
    expect(await notifiedAbout(requestId, 'REQUEST_CREATED')).toEqual([trusted.id]);
    expect((await api(app, 'GET', `/api/requests/${requestId}`, { token: bystander.accessToken })).status).toBe(404);
  });
});

describe('attached files', () => {
  async function uploadListingPhoto(owner: TestUser): Promise<string> {
    const upload = await uploadFile<{ attachment: { id: string } }>(
      app, 'POST', '/api/uploads?purpose=LISTING', owner.accessToken, TINY_PNG, 'lamp.png', 'image/png',
    );
    expect(upload.status).toBe(201);
    return upload.body.attachment.id;
  }

  const listing = (imageIds: string[]) => ({
    title: 'Desk lamp',
    categorySlug: 'marketplace',
    listingType: 'SELL',
    pricePaise: 20000,
    condition: 'GOOD',
    imageIds,
  });

  it('refuses to attach someone else’s upload', async () => {
    const owner = await registerStudent(app);
    const other = await registerStudent(app);
    const photo = await uploadListingPhoto(owner);

    const stolen = await api(app, 'POST', '/api/listings', { token: other.accessToken, body: listing([photo]) });
    expect(stolen.status).toBe(403);
  });

  it('shows a listing photo to other students through a link an <img> can load', async () => {
    const seller = await registerStudent(app);
    const buyer = await registerStudent(app);
    const photo = await uploadListingPhoto(seller);
    const created = await api<{ listing: { id: string } }>(app, 'POST', '/api/listings', {
      token: seller.accessToken,
      body: listing([photo]),
    });
    expect(created.status).toBe(201);

    const seen = await api<{ listing: { images: Array<{ url: string }> } }>(
      app, 'GET', `/api/listings/${created.body.listing.id}`, { token: buyer.accessToken },
    );
    expect(seen.body.listing.images).toHaveLength(1);
    const image = await app.inject({ method: 'GET', url: seen.body.listing.images[0].url });
    expect(image.statusCode).toBe(200);
  });
});

describe('administrator safeguards', () => {
  it('stops a campus admin changing the platform admin, and anyone suspending themselves', async () => {
    const platform = await registerStudent(app);
    await promoteToAdmin(platform.id, 'PLATFORM_ADMIN');
    const campusAdmin = await registerStudent(app);
    await promoteToAdmin(campusAdmin.id, 'CAMPUS_ADMIN');

    const demote = await api(app, 'PATCH', `/api/admin/users/${platform.id}`, {
      token: campusAdmin.accessToken,
      body: { role: 'STUDENT' },
    });
    expect(demote.status).toBe(403);

    const lockOut = await api(app, 'PATCH', `/api/admin/users/${platform.id}`, {
      token: campusAdmin.accessToken,
      body: { accountStatus: 'SUSPENDED', suspensionReason: 'Testing' },
    });
    expect(lockOut.status).toBe(403);

    const self = await api(app, 'PATCH', `/api/admin/users/${campusAdmin.id}`, {
      token: campusAdmin.accessToken,
      body: { accountStatus: 'SUSPENDED', suspensionReason: 'Oops' },
    });
    expect(self.status).toBe(400);
  });

  it('keeps the geofence an admin saved when the server restarts', async () => {
    const admin = await registerStudent(app);
    await promoteToAdmin(admin.id, 'CAMPUS_ADMIN');
    const saved = await api(app, 'PATCH', '/api/admin/campus', {
      token: admin.accessToken,
      body: { centreLat: 25.6012, centreLng: 84.8467, geofenceRadiusMetres: 1800 },
    });
    expect(saved.status).toBe(200);

    const db = await getDatabase();
    await bootstrapCampus(db); // what every restart does
    const { rows } = await db.query<{ centre_lat: number; centre_lng: number; geofence_radius_metres: number }>(
      'SELECT centre_lat, centre_lng, geofence_radius_metres FROM campuses LIMIT 1',
    );
    expect(rows[0]).toMatchObject({ centre_lat: 25.6012, centre_lng: 84.8467, geofence_radius_metres: 1800 });
  });
});

describe('dispute outcomes', () => {
  async function disputeAndRule(status: string): Promise<{ requester: TestUser; requestId: string }> {
    const { requester, requestId } = await taskInProgress();
    const opened = await api<{ dispute: { id: string } }>(app, 'POST', '/api/disputes', {
      token: requester.accessToken,
      body: {
        subjectType: 'REQUEST',
        subjectId: requestId,
        reason: 'Running late',
        description: 'The helper has not replied for an hour.',
      },
    });
    expect(opened.status).toBe(201);
    expect((await viewRequest(requester, requestId)).status).toBe('DISPUTED');

    const admin = await registerStudent(app);
    await promoteToAdmin(admin.id, 'CAMPUS_ADMIN');
    const ruled = await api(app, 'PATCH', `/api/admin/disputes/${opened.body.dispute.id}`, {
      token: admin.accessToken,
      body: { status, resolution: 'Reviewed with both students.' },
    });
    expect(ruled.status).toBe(200);
    return { requester, requestId };
  }

  it('returns a dismissed dispute to where it was, without recording a payment', async () => {
    const { requester, requestId } = await disputeAndRule('DISMISSED');
    const request = await viewRequest(requester, requestId);
    expect(request.status).toBe('IN_PROGRESS');
    expect(request.payment).toBeNull();
  });

  it('opens the missing payment when a mid-task dispute is ruled for the helper', async () => {
    const { requester, requestId } = await disputeAndRule('RESOLVED_HELPER');
    const request = await viewRequest(requester, requestId);
    expect(request.status).toBe('PAYMENT_PENDING');
    expect(request.payment?.status).toBe('PAYMENT_PENDING');
  });
});

describe('rentals', () => {
  async function listCalculator(owner: TestUser): Promise<string> {
    const item = await api<{ item: { id: string } }>(app, 'POST', '/api/rental-items', {
      token: owner.accessToken,
      body: {
        name: 'Scientific calculator',
        categorySlug: 'borrow-rent',
        condition: 'GOOD',
        pricePaise: 3000,
        rentalUnit: 'DAY',
        depositPaise: 0,
      },
    });
    expect(item.status).toBe(201);
    return item.body.item.id;
  }

  async function reserve(owner: TestUser, renter: TestUser, itemId: string): Promise<string> {
    const rental = await api<{ rental: { id: string } }>(app, 'POST', '/api/rentals', {
      token: renter.accessToken,
      body: { itemId, startAt: futureIso(30), expectedReturnAt: futureIso(30 + 24 * 60) },
    });
    expect(rental.status).toBe(201);
    const id = rental.body.rental.id;
    expect((await api(app, 'POST', `/api/rentals/${id}/accept`, { token: owner.accessToken, body: {} })).status).toBe(200);
    return id;
  }

  const itemStatus = async (viewer: TestUser, itemId: string): Promise<string> =>
    (await api<{ item: { status: string } }>(app, 'GET', `/api/rental-items/${itemId}`, { token: viewer.accessToken }))
      .body.item.status;

  it('lets the owner call off a reservation, as the app offers', async () => {
    const owner = await registerStudent(app);
    const renter = await registerStudent(app);
    const rentalId = await reserve(owner, renter, await listCalculator(owner));

    const cancelled = await api<{ rental: { status: string } }>(app, 'POST', `/api/rentals/${rentalId}/cancel`, {
      token: owner.accessToken,
      body: {},
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.rental.status).toBe('CANCELLED');
  });

  it('does not let staff act as one side of a rental', async () => {
    const owner = await registerStudent(app);
    const renter = await registerStudent(app);
    const moderator = await registerStudent(app);
    await promoteToAdmin(moderator.id, 'MODERATOR');
    const rentalId = await reserve(owner, renter, await listCalculator(owner));

    const response = await api(app, 'POST', `/api/rentals/${rentalId}/cancel`, {
      token: moderator.accessToken,
      body: {},
    });
    expect(response.status).toBe(403);
  });

  it('keeps a disputed item out of circulation until the dispute is resolved', async () => {
    const owner = await registerStudent(app);
    const renter = await registerStudent(app);
    const itemId = await listCalculator(owner);
    const rentalId = await reserve(owner, renter, itemId);
    await api(app, 'POST', `/api/rentals/${rentalId}/confirm-pickup`, { token: owner.accessToken, body: {} });

    const dispute = () =>
      api<{ dispute: { id: string } }>(app, 'POST', '/api/disputes', {
        token: renter.accessToken,
        body: {
          subjectType: 'RENTAL',
          subjectId: rentalId,
          reason: 'Item damaged',
          description: 'The screen was cracked when I received it.',
        },
      });
    const opened = await dispute();
    expect(opened.status).toBe(201);
    expect(await itemStatus(owner, itemId)).toBe('RENTED');

    const admin = await registerStudent(app);
    await promoteToAdmin(admin.id, 'CAMPUS_ADMIN');
    await api(app, 'PATCH', `/api/admin/disputes/${opened.body.dispute.id}`, {
      token: admin.accessToken,
      body: { status: 'RESOLVED_REQUESTER', resolution: 'Deposit returned in person.' },
    });
    expect(await itemStatus(owner, itemId)).toBe('AVAILABLE');

    // A finished rental cannot be dragged back into a dispute.
    expect((await dispute()).status).toBe(409);
  });
});

describe('scheduled requests', () => {
  it('stays quiet, unescalated and closed to offers until its time, then announces itself', async () => {
    const requester = await registerStudent(app);
    const helper = await registerStudent(app);
    const db = await getDatabase();
    await db.query(`UPDATE user_preferences SET preferred_categories = '{quick-delivery}' WHERE user_id = $1`, [
      helper.id,
    ]);

    const requestId = await postRequest(requester, {
      scheduledFor: futureIso(60),
      deadlineAt: futureIso(180),
      maxRewardPaise: 5000,
      autoEscalate: true,
    });
    expect(await notifiedAbout(requestId, 'REQUEST_CREATED')).toEqual([]);

    const early = await api<{ error: { code: string } }>(app, 'POST', `/api/requests/${requestId}/offers`, {
      token: helper.accessToken,
      body: {},
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('REQUEST_SCHEDULED');

    // Even long past the escalation interval, a request nobody can see yet keeps its reward.
    await db.query(`UPDATE requests SET created_at = now() - interval '2 hours' WHERE id = $1`, [requestId]);
    await escalateRewards(db);
    expect((await viewRequest(requester, requestId)).rewardPaise).toBe(2000);

    // Its time arrives.
    await db.query(`UPDATE requests SET scheduled_for = now() - interval '1 minute' WHERE id = $1`, [requestId]);
    expect(await activateScheduledRequests(db)).toBeGreaterThanOrEqual(1);
    const notified = await notifiedAbout(requestId, 'REQUEST_CREATED');
    expect(notified).toContain(helper.id);
    expect(notified).not.toContain(requester.id);

    // Automatic increases count from going live, not from when it was written.
    await escalateRewards(db);
    expect((await viewRequest(requester, requestId)).rewardPaise).toBe(2000);
  });
});

describe('campus time and request budgets', () => {
  it('reads clock times in campus time, whatever timezone the server runs in', () => {
    // 20:00 UTC is 01:30 the next morning in Bihta.
    expect(campusHour(new Date('2026-01-01T20:00:00Z'))).toBe(1);
    expect(formatCampusTime(new Date('2026-01-01T12:00:00Z'))).toMatch(/5:30\s?pm/i);
  });

  it('allows the configured number of requests per window, then asks the student to wait', () => {
    const key = 'user:budget-test';
    const start = 1_000_000;
    for (let i = 0; i < env.RATE_LIMIT_MAX_REQUESTS; i += 1) {
      expect(consumeRequestBudget(key, start).allowed).toBe(true);
    }
    const over = consumeRequestBudget(key, start + 1000);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);

    // A new window starts afresh.
    expect(consumeRequestBudget(key, start + env.RATE_LIMIT_WINDOW_SECONDS * 1000).allowed).toBe(true);
  });
});
