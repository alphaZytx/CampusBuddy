import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, destroyTestApp, promoteToAdmin, registerStudent, type TestUser } from './helpers.js';
import { getDatabase } from '../src/db/client.js';

/**
 * Security tests (spec §69, §89, §95).
 *
 * These assert the things a determined client must not be able to do: read another
 * campus's data, act as somebody else, forge money or status, escalate their own
 * privileges, or read a conversation they are not part of.
 */

let app: FastifyInstance;
let rahul: TestUser;
let aman: TestUser;
let outsider: TestUser;
let requestId: string;

beforeAll(async () => {
  app = await createTestApp();
  rahul = await registerStudent(app, { fullName: 'Rahul Kumar', email: 'sec.rahul@nitp.ac.in' });
  aman = await registerStudent(app, { fullName: 'Aman Singh', email: 'sec.aman@nitp.ac.in' });
  outsider = await registerStudent(app, { fullName: 'Nosy Student', email: 'sec.nosy@nitp.ac.in' });

  const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
    token: rahul.accessToken,
    body: {
      title: 'Private errand',
      description: 'Something confidential.',
      categorySlug: 'campus-assistance',
      rewardPaise: 5000,
    },
  });
  requestId = created.body.request.id;
});

afterAll(async () => destroyTestApp(app));

describe('authentication', () => {
  it('refuses protected routes without a token', async () => {
    const response = await api(app, 'GET', '/api/requests');
    expect(response.status).toBe(401);
  });

  it('refuses a forged or tampered token', async () => {
    const tampered = `${rahul.accessToken.slice(0, -6)}AAAAAA`;
    const response = await api(app, 'GET', '/api/requests', { token: tampered });
    expect(response.status).toBe(401);
  });

  it('refuses a token signed with a different secret', async () => {
    const notAToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const response = await api(app, 'GET', '/api/requests', { token: notAToken });
    expect(response.status).toBe(401);
  });

  it('does not reveal whether an email is registered', async () => {
    const unknown = await api<{ error: { message: string } }>(app, 'POST', '/api/auth/login', {
      body: { email: 'nobody.here@nitp.ac.in', password: 'CampusBuddy@2026' },
    });
    const wrongPassword = await api<{ error: { message: string } }>(app, 'POST', '/api/auth/login', {
      body: { email: rahul.email, password: 'WrongPassword@123' },
    });
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    // Identical wording for both cases.
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects registration from outside the permitted email domain', async () => {
    const response = await api<{ error: { code: string } }>(app, 'POST', '/api/auth/register', {
      body: { fullName: 'Outside Person', email: 'someone@gmail.com', password: 'CampusBuddy@2026' },
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });

  it('never stores or returns a password', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM user_credentials WHERE user_id = $1',
      [rahul.id],
    );
    expect(rows[0].password_hash).not.toContain('CampusBuddy@2026');
    expect(rows[0].password_hash.startsWith('scrypt$')).toBe(true);

    const me = await api<Record<string, unknown>>(app, 'GET', '/api/auth/me', {
      token: rahul.accessToken,
    });
    expect(JSON.stringify(me.body)).not.toContain('password');
  });

  it('revokes every session when the password changes', async () => {
    const victim = await registerStudent(app, { email: 'sec.rotate@nitp.ac.in' });
    await api(app, 'POST', '/api/auth/change-password', {
      token: victim.accessToken,
      body: { currentPassword: 'CampusBuddy@2026', newPassword: 'BrandNewPass@456' },
    });
    const refreshed = await api(app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: victim.refreshToken },
    });
    expect(refreshed.status).toBe(401);
  });

  it('treats a reused refresh token as theft and kills the session family', async () => {
    const victim = await registerStudent(app, { email: 'sec.reuse@nitp.ac.in' });
    const first = await api<{ refreshToken: string }>(app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: victim.refreshToken },
    });
    expect(first.status).toBe(200);

    // Replaying the original, already-rotated token.
    const replay = await api<{ error: { code: string } }>(app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: victim.refreshToken },
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // And the token the attacker's replay invalidated is dead too.
    const afterwards = await api(app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: first.body.refreshToken },
    });
    expect(afterwards.status).toBe(401);
  });
});

describe('verification gating', () => {
  it('stops an unverified student from posting a request', async () => {
    const unverified = await registerStudent(app, { email: 'sec.unverified@nitp.ac.in', verify: false });
    const response = await api<{ error: { code: string } }>(app, 'POST', '/api/requests', {
      token: unverified.accessToken,
      body: { title: 'Should not work', description: 'x', categorySlug: 'quick-delivery', rewardPaise: 1000 },
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOT_VERIFIED');
  });

  it('refuses campus verification from outside the geofence', async () => {
    const student = await registerStudent(app, { email: 'sec.faraway@nitp.ac.in', verify: false });
    const response = await api<{ error: { code: string } }>(
      app, 'POST', '/api/verification/location/verify',
      // Mumbai, ~1000 km from the Bihta campus.
      { token: student.accessToken, body: { lat: 19.076, lng: 72.8777, accuracyMetres: 10 } },
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('OUTSIDE_CAMPUS');
  });

  it('accepts campus verification from inside the geofence', async () => {
    const student = await registerStudent(app, { email: 'sec.oncampus@nitp.ac.in', verify: false });
    const response = await api<{ verified: boolean; method: string }>(
      app, 'POST', '/api/verification/location/verify',
      { token: student.accessToken, body: { lat: 25.5856, lng: 84.8516, accuracyMetres: 12 } },
    );
    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.method).toBe('CAMPUS_LOCATION');
  });

  it('rejects a wrong OTP and does not verify the account', async () => {
    const student = await registerStudent(app, { email: 'sec.badotp@nitp.ac.in', verify: false });
    await api(app, 'POST', '/api/verification/email/request', { token: student.accessToken, body: {} });
    const response = await api<{ error: { code: string } }>(
      app, 'POST', '/api/verification/email/verify',
      { token: student.accessToken, body: { code: '000000' } },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('OTP_INVALID');

    const status = await api<{ isVerified: boolean }>(app, 'GET', '/api/verification/status', {
      token: student.accessToken,
    });
    expect(status.body.isVerified).toBe(false);
  });
});

describe('ownership and impersonation', () => {
  it('ignores a requester_id supplied by the client', async () => {
    const response = await api<{ request: { requester: { id: string } } }>(
      app, 'POST', '/api/requests',
      {
        token: aman.accessToken,
        body: {
          title: 'Posted as someone else?',
          description: 'Attempting to spoof the requester.',
          categorySlug: 'quick-delivery',
          rewardPaise: 1000,
          // Not part of the schema; the server derives ownership from the session.
          requesterId: rahul.id,
          campusId: '00000000-0000-0000-0000-000000000000',
          status: 'PAID',
        },
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.request.requester.id).toBe(aman.id);
  });

  it('ignores a client-supplied status and always starts at OPEN', async () => {
    const response = await api<{ request: { status: string } }>(app, 'POST', '/api/requests', {
      token: aman.accessToken,
      body: {
        title: 'Trying to start as paid',
        description: 'x',
        categorySlug: 'quick-delivery',
        rewardPaise: 1000,
        status: 'PAID',
      },
    });
    expect(response.body.request.status).toBe('OPEN');
  });

  it('stops a stranger cancelling someone else’s request', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/cancel`, {
      token: outsider.accessToken,
      body: { reason: 'Because I feel like it' },
    });
    expect([403, 404]).toContain(response.status);
  });

  it('stops a stranger editing someone else’s request', async () => {
    const response = await api(app, 'PATCH', `/api/requests/${requestId}`, {
      token: outsider.accessToken,
      body: { title: 'Hijacked title' },
    });
    expect([403, 404]).toContain(response.status);

    const detail = await api<{ request: { title: string } }>(
      app, 'GET', `/api/requests/${requestId}`, { token: rahul.accessToken },
    );
    expect(detail.body.request.title).toBe('Private errand');
  });

  it('stops a student withdrawing another student’s offer', async () => {
    const offer = await api<{ offer: { id: string } }>(
      app, 'POST', `/api/requests/${requestId}/offers`,
      { token: aman.accessToken, body: { offeredRewardPaise: 5000 } },
    );
    const response = await api(
      app, 'POST', `/api/requests/${requestId}/offers/${offer.body.offer.id}/withdraw`,
      { token: outsider.accessToken, body: {} },
    );
    expect([403, 404]).toContain(response.status);
  });

  it('stops a student rating a task they had nothing to do with', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/ratings`, {
      token: outsider.accessToken,
      body: { stars: 1, review: 'Sabotage' },
    });
    expect([403, 404, 409]).toContain(response.status);
  });
});

describe('privilege escalation', () => {
  it('cannot make itself an admin through the profile endpoint', async () => {
    await api(app, 'PATCH', '/api/users/me', {
      token: outsider.accessToken,
      body: { fullName: 'Still A Student', role: 'PLATFORM_ADMIN', isVerified: true },
    });
    const db = await getDatabase();
    const { rows } = await db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [
      outsider.id,
    ]);
    expect(rows[0].role).toBe('STUDENT');
  });

  it('blocks a role change attempted directly against the database as the app role', async () => {
    // The immutability trigger is the backstop behind the API-level checks.
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [outsider.id],
    );
    const context = { userId: outsider.id, campusId: rows[0].campus_id, role: 'STUDENT' as const };

    await expect(
      db.asUser(context, (tx) =>
        tx.query(`UPDATE users SET role = 'PLATFORM_ADMIN' WHERE id = $1`, [outsider.id]),
      ),
    ).rejects.toThrow(/Roles can only be changed by an administrator/);
  });

  it('blocks self-verification straight against the database', async () => {
    const db = await getDatabase();
    const student = await registerStudent(app, { email: 'sec.selfverify@nitp.ac.in', verify: false });
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [student.id],
    );
    const context = { userId: student.id, campusId: rows[0].campus_id, role: 'STUDENT' as const };

    await expect(
      db.asUser(context, (tx) =>
        tx.query(`UPDATE users SET is_verified = true WHERE id = $1`, [student.id]),
      ),
    ).rejects.toThrow(/verification service only/);
  });

  it('blocks a student inflating their own reputation or earnings', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [outsider.id],
    );
    const context = { userId: outsider.id, campusId: rows[0].campus_id, role: 'STUDENT' as const };

    await expect(
      db.asUser(context, (tx) =>
        tx.query(`UPDATE users SET total_earned_paise = 99999999 WHERE id = $1`, [outsider.id]),
      ),
    ).rejects.toThrow(/maintained by the server/);
  });

  it('keeps the admin panel closed to ordinary students', async () => {
    for (const path of ['/api/admin/analytics', '/api/admin/users', '/api/admin/reports']) {
      const response = await api(app, 'GET', path, { token: outsider.accessToken });
      expect(response.status).toBe(403);
    }
  });

  it('opens the admin panel once the role is genuinely granted', async () => {
    const staff = await registerStudent(app, { email: 'sec.moderator@nitp.ac.in' });
    await promoteToAdmin(staff.id, 'CAMPUS_ADMIN');
    const response = await api(app, 'GET', '/api/admin/analytics', { token: staff.accessToken });
    expect(response.status).toBe(200);
  });

  it('refuses a self-signed claim of admin in the token payload', async () => {
    // A token whose body claims PLATFORM_ADMIN but which is not validly signed.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: outsider.id, role: 'PLATFORM_ADMIN', verified: true }),
    ).toString('base64url');
    const forged = `${header}.${payload}.notarealsignature`;

    const response = await api(app, 'GET', '/api/admin/analytics', { token: forged });
    expect(response.status).toBe(401);
  });
});

describe('database-level guarantees', () => {
  it('makes ratings permanently immutable', async () => {
    const db = await getDatabase();
    await expect(
      db.query(`UPDATE ratings SET stars = 1 WHERE true`),
    ).resolves.toBeDefined(); // No rows yet in this suite; the trigger fires only per row.

    // Insert one, then prove it cannot be edited even in the service context.
    const helper = await registerStudent(app, { email: 'sec.rater@nitp.ac.in' });
    const { rows: campusRows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [helper.id],
    );
    await db.query(
      `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars)
       VALUES ($1, $2, $3, $4, 'REQUESTER_TO_HELPER', 5)`,
      [campusRows[0].campus_id, requestId, rahul.id, helper.id],
    );
    await expect(
      db.query(`UPDATE ratings SET stars = 1 WHERE rater_id = $1`, [rahul.id]),
    ).rejects.toThrow(/cannot be modified/);
  });

  it('refuses a self-rating outright', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [rahul.id],
    );
    await expect(
      db.query(
        `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars)
         VALUES ($1, $2, $3, $3, 'REQUESTER_TO_HELPER', 5)`,
        [rows[0].campus_id, requestId, rahul.id],
      ),
    ).rejects.toThrow();
  });

  it('refuses to let a request have two accepted offers', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [rahul.id],
    );
    const created = await db.query<{ id: string }>(
      `INSERT INTO requests (campus_id, requester_id, title, description, category_slug, reward_paise)
       VALUES ($1, $2, 'Two helpers?', 'x', 'quick-delivery', 2000) RETURNING id`,
      [rows[0].campus_id, rahul.id],
    );
    const targetId = created.rows[0].id;

    for (const helperId of [aman.id, outsider.id]) {
      await db.query(
        `INSERT INTO request_offers (campus_id, request_id, helper_id, offered_reward_paise, status)
         VALUES ($1, $2, $3, 2000, 'PENDING')`,
        [rows[0].campus_id, targetId, helperId],
      );
    }

    await db.query(
      `UPDATE request_offers SET status = 'ACCEPTED' WHERE request_id = $1 AND helper_id = $2`,
      [targetId, aman.id],
    );
    // The partial unique index makes a second acceptance impossible.
    await expect(
      db.query(
        `UPDATE request_offers SET status = 'ACCEPTED' WHERE request_id = $1 AND helper_id = $2`,
        [targetId, outsider.id],
      ),
    ).rejects.toThrow();
  });

  it('refuses a payment whose payer and payee are the same person', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [rahul.id],
    );
    await expect(
      db.query(
        `INSERT INTO payments (campus_id, request_id, payer_id, payee_id, amount_paise)
         VALUES ($1, $2, $3, $3, 1000)`,
        [rows[0].campus_id, requestId, rahul.id],
      ),
    ).rejects.toThrow();
  });

  it('refuses to change a payment amount after the fact', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>(
      'SELECT campus_id FROM users WHERE id = $1',
      [rahul.id],
    );
    const created = await db.query<{ id: string }>(
      `INSERT INTO payments (campus_id, request_id, payer_id, payee_id, amount_paise)
       VALUES ($1, $2, $3, $4, 5000) RETURNING id`,
      [rows[0].campus_id, requestId, rahul.id, aman.id],
    );
    await expect(
      db.query('UPDATE payments SET amount_paise = 1 WHERE id = $1', [created.rows[0].id]),
    ).rejects.toThrow(/amount is fixed/);
  });
});
