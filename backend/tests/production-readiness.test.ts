import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, destroyTestApp, promoteToAdmin, registerStudent, uploadFile, type TestUser } from './helpers.js';
import { TINY_PNG } from './fixtures.js';

let app: FastifyInstance;
let requester: TestUser;
let helper: TestUser;
let admin: TestUser;

beforeAll(async () => {
  app = await createTestApp();
  requester = await registerStudent(app, { fullName: 'Ready Requester', email: 'ready.requester@nitp.ac.in' });
  helper = await registerStudent(app, { fullName: 'Ready Helper', email: 'ready.helper@nitp.ac.in' });
  admin = await registerStudent(app, { fullName: 'Ready Admin', email: 'ready.admin@nitp.ac.in' });
  await promoteToAdmin(admin.id, 'PLATFORM_ADMIN');
});

afterAll(async () => destroyTestApp(app));

describe('request photos and safe retries', () => {
  it('shows attached request photos to another campus student', async () => {
    const upload = await uploadFile<{ attachment: { id: string } }>(
      app, 'POST', '/api/uploads?purpose=REQUEST', requester.accessToken, TINY_PNG, 'reference.png', 'image/png',
    );
    expect(upload.status).toBe(201);
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: requester.accessToken,
      body: {
        title: 'Match this reference photo', description: 'Please get the exact notebook shown.',
        categorySlug: 'quick-delivery', rewardPaise: 2000, attachmentIds: [upload.body.attachment.id],
      },
    });
    expect(created.status).toBe(201);
    const viewed = await api<{ request: { attachments: Array<{ id: string; url: string }> } }>(
      app, 'GET', `/api/requests/${created.body.request.id}`, { token: helper.accessToken },
    );
    expect(viewed.body.request.attachments[0].id).toBe(upload.body.attachment.id);
    expect(viewed.body.request.attachments[0].url).toContain('/api/uploads/');
  });

  it('replays an idempotent create without creating a second request', async () => {
    const payload = { title: 'One retry-safe task', categorySlug: 'academic-help', rewardPaise: 1500 };
    const headers = { authorization: `Bearer ${requester.accessToken}`, 'idempotency-key': 'test:create:request:0001' };
    const first = await app.inject({ method: 'POST', url: '/api/requests', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/api/requests', headers, payload });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().request.id).toBe(first.json().request.id);
  });
});

describe('safety, privacy and devices', () => {
  let moderationActionId = '';

  it('blocks interaction in either direction and exposes the current control', async () => {
    const blocked = await api(app, 'PUT', `/api/safety/controls/${helper.id}`, {
      token: requester.accessToken, body: { blocked: true, muted: true, reason: 'No more contact' },
    });
    expect(blocked.status).toBe(200);
    const controls = await api<{ controls: Array<{ user: { id: string }; blocked: boolean }> }>(
      app, 'GET', '/api/safety/controls', { token: requester.accessToken },
    );
    expect(controls.body.controls).toContainEqual(expect.objectContaining({ user: expect.objectContaining({ id: helper.id }), blocked: true }));

    const request = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: requester.accessToken,
      body: { title: 'A blocked helper cannot offer', categorySlug: 'academic-help', rewardPaise: 1000 },
    });
    const feed = await api<{ items: Array<{ id: string }> }>(app, 'GET', '/api/requests', { token: helper.accessToken });
    expect(feed.body.items.some((item) => item.id === request.body.request.id)).toBe(false);
    const directory = await api<{ users: Array<{ id: string }> }>(app, 'GET', '/api/users', { token: helper.accessToken });
    expect(directory.body.users.some((item) => item.id === requester.id)).toBe(false);
    const offer = await api(app, 'POST', `/api/requests/${request.body.request.id}/offers`, {
      token: helper.accessToken, body: { offeredRewardPaise: 1000 },
    });
    expect(offer.status).toBe(403);
  });

  it('records push devices, policy consent, and returns a personal export', async () => {
    const device = await api(app, 'POST', '/api/push/devices', {
      token: helper.accessToken,
      body: { token: 'fcm-test-token-that-is-long-enough-12345', platform: 'ANDROID', deviceName: 'Pixel test' },
    });
    expect(device.status).toBe(201);

    const documents = await api<{ documents: Array<{ documentType: string; version: string }> }>(
      app, 'GET', '/api/privacy/documents', { token: helper.accessToken },
    );
    expect(documents.body.documents).toHaveLength(3);
    const privacy = documents.body.documents.find((item) => item.documentType === 'PRIVACY')!;
    const consent = await api(app, 'POST', '/api/privacy/consents', {
      token: helper.accessToken,
      body: { documentType: privacy.documentType, version: privacy.version, accepted: true },
    });
    expect(consent.status).toBe(201);
    const exported = await api<{ profile: { id: string }; consents: unknown[] }>(
      app, 'GET', '/api/privacy/export', { token: helper.accessToken },
    );
    expect(exported.body.profile.id).toBe(helper.id);
    expect(exported.body.consents).toHaveLength(1);
  });

  it('keeps report evidence private and makes it available to moderators', async () => {
    const upload = await uploadFile<{ attachment: { id: string; url: string } }>(
      app, 'POST', '/api/uploads?purpose=REPORT', helper.accessToken, TINY_PNG, 'report.png', 'image/png',
    );
    const report = await api<{ report: { id: string } }>(app, 'POST', '/api/reports', {
      token: helper.accessToken,
      body: { targetType: 'USER', targetId: requester.id, reason: 'Harassment', description: 'Repeated unwanted contact.' },
    });
    const evidence = await api(app, 'POST', `/api/reports/${report.body.report.id}/evidence`, {
      token: helper.accessToken, body: { attachmentId: upload.body.attachment.id, note: 'Screenshot from the conversation.' },
    });
    expect(evidence.status).toBe(201);
    const plain = upload.body.attachment.url.split('?')[0];
    expect((await app.inject({ method: 'GET', url: plain, headers: { authorization: `Bearer ${requester.accessToken}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: plain, headers: { authorization: `Bearer ${admin.accessToken}` } })).statusCode).toBe(200);
    const queue = await api<{ reports: Array<{ id: string; evidence: Array<{ attachment: { id: string } }> }> }>(
      app, 'GET', '/api/admin/reports?status=OPEN', { token: admin.accessToken },
    );
    expect(queue.body.reports.find((item) => item.id === report.body.report.id)?.evidence[0].attachment.id).toBe(upload.body.attachment.id);
  });

  it('supports warnings, student appeals, review, and the operations dashboard', async () => {
    const action = await api<{ id: string }>(app, 'POST', `/api/admin/users/${helper.id}/moderation-actions`, {
      token: admin.accessToken,
      body: { actionType: 'WARNING', reason: 'Repeatedly cancelling accepted tasks', points: 10 },
    });
    expect(action.status).toBe(201);
    moderationActionId = action.body.id;

    const actions = await api<{ actions: Array<{ id: string; actionType: string }> }>(
      app, 'GET', '/api/safety/actions', { token: helper.accessToken },
    );
    expect(actions.body.actions[0]).toEqual(expect.objectContaining({ id: moderationActionId, actionType: 'WARNING' }));
    const appeal = await api(app, 'POST', '/api/safety/appeals', {
      token: helper.accessToken,
      body: { moderationActionId, statement: 'Two cancellations were caused by a campus network outage.' },
    });
    expect(appeal.status).toBe(201);

    const queue = await api<{ appeals: Array<{ id: string }> }>(app, 'GET', '/api/admin/safety', { token: admin.accessToken });
    expect(queue.body.appeals).toHaveLength(1);
    const reviewed = await api(app, 'PATCH', `/api/admin/safety/appeals/${queue.body.appeals[0].id}`, {
      token: admin.accessToken, body: { status: 'UPHELD', resolution: 'Warning remains proportionate.' },
    });
    expect(reviewed.status).toBe(200);

    const operations = await api<{ driver: string; outbox: { pending: number } }>(
      app, 'GET', '/api/admin/operations', { token: admin.accessToken },
    );
    expect(operations.status).toBe(200);
    expect(operations.body.driver).toBe('pglite');
    expect(operations.body.outbox.pending).toBeGreaterThanOrEqual(0);
  });
});
