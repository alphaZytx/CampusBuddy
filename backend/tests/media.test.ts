import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createTestApp,
  destroyTestApp,
  registerStudent,
  uploadFile,
  type TestUser,
} from './helpers.js';
import { jpegWithMetadata, PNG_SIGNATURE, pngWithMetadata, TINY_PNG } from './fixtures.js';
import { getDatabase } from '../src/db/client.js';

/**
 * Profile photos and payment QR codes, end to end: upload, display through signed
 * links, metadata removal, replacement, removal — and who may see what.
 */

let app: FastifyInstance;
let rahul: TestUser;
let aman: TestUser;
let priya: TestUser;

beforeAll(async () => {
  app = await createTestApp();
  rahul = await registerStudent(app, { fullName: 'Rahul Kumar', email: 'media.rahul@nitp.ac.in' });
  aman = await registerStudent(app, { fullName: 'Aman Singh', email: 'media.aman@nitp.ac.in' });
  priya = await registerStudent(app, { fullName: 'Priya Sharma', email: 'media.priya@nitp.ac.in' });
});

afterAll(async () => destroyTestApp(app));

/** Fetches a file the way a browser would, optionally with a bearer token. */
async function fetchFile(
  url: string,
  token?: string,
): Promise<{ status: number; bytes: Buffer; contentType: string }> {
  const response = await app.inject({
    method: 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return {
    status: response.statusCode,
    bytes: response.rawPayload,
    contentType: String(response.headers['content-type'] ?? ''),
  };
}

function attachmentIdFrom(url: string): string {
  return new URL(url, 'http://localhost').pathname.split('/').pop() ?? '';
}

type UserBody = { user: { avatarUrl: string | null; upiQrUrl: string | null; upiId: string | null } };

describe('profile photos', () => {
  let firstPhotoUrl = '';

  it('uploads a photo and shows it to other students as a signed link', async () => {
    const response = await uploadFile<UserBody>(
      app, 'PUT', '/api/users/me/avatar', rahul.accessToken, TINY_PNG, 'me.png', 'image/png',
    );
    expect(response.status).toBe(200);
    expect(response.body.user.avatarUrl).toMatch(
      /^\/api\/uploads\/[0-9a-f-]{36}\?expires=\d+&signature=[\w-]+$/,
    );
    firstPhotoUrl = response.body.user.avatarUrl ?? '';

    const seenByOthers = await api<{ user: { avatarUrl: string | null } }>(
      app, 'GET', `/api/users/${rahul.id}`, { token: aman.accessToken },
    );
    expect(attachmentIdFrom(seenByOthers.body.user.avatarUrl ?? '')).toBe(attachmentIdFrom(firstPhotoUrl));
  });

  it('serves the photo through the signed link without a bearer token', async () => {
    const file = await fetchFile(firstPhotoUrl);
    expect(file.status).toBe(200);
    expect(file.contentType).toBe('image/png');
    expect(file.bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('refuses an altered signature, a link moved to another file, or a missing signature', async () => {
    const altered = firstPhotoUrl.slice(0, -1) + (firstPhotoUrl.endsWith('A') ? 'B' : 'A');
    expect((await fetchFile(altered)).status).toBe(403);

    const otherFile = firstPhotoUrl.replace(
      /uploads\/[0-9a-f-]{36}/,
      'uploads/00000000-0000-4000-8000-000000000000',
    );
    expect((await fetchFile(otherFile)).status).toBe(403);

    const unsigned = firstPhotoUrl.split('&signature=')[0];
    expect((await fetchFile(unsigned)).status).toBe(403);
  });

  it('strips location and camera metadata from a JPEG photo', async () => {
    const response = await uploadFile<UserBody>(
      app, 'PUT', '/api/users/me/avatar', aman.accessToken, jpegWithMetadata(), 'camera.jpg', 'image/jpeg',
    );
    expect(response.status).toBe(200);

    const stored = await fetchFile(response.body.user.avatarUrl ?? '');
    const text = stored.bytes.toString('latin1');
    expect(text).toContain('JFIF');
    expect(text).not.toContain('GPS-SECRET');
    expect(text).not.toContain('SECRET-COMMENT');
    expect(text).not.toContain('APPENDED-TRAILER');
  });

  it('replaces an old photo and deletes the previous file', async () => {
    const replaced = await uploadFile<UserBody>(
      app, 'PUT', '/api/users/me/avatar', rahul.accessToken, pngWithMetadata(), 'new.png', 'image/png',
    );
    expect(replaced.status).toBe(200);
    const newUrl = replaced.body.user.avatarUrl ?? '';
    expect(attachmentIdFrom(newUrl)).not.toBe(attachmentIdFrom(firstPhotoUrl));

    // The earlier link is still correctly signed, but the file behind it is gone.
    expect((await fetchFile(firstPhotoUrl)).status).toBe(404);
    const db = await getDatabase();
    const { rows } = await db.query('SELECT 1 FROM attachments WHERE id = $1', [
      attachmentIdFrom(firstPhotoUrl),
    ]);
    expect(rows).toHaveLength(0);

    // PNG text chunks and appended data were removed too.
    const text = (await fetchFile(newUrl)).bytes.toString('latin1');
    expect(text).not.toContain('SECRET-PNG');
    expect(text).not.toContain('APPENDED-PNG-TRAILER');
  });

  it('removes the photo', async () => {
    const before = await api<UserBody>(app, 'GET', '/api/auth/me', { token: rahul.accessToken });
    const previousUrl = before.body.user.avatarUrl ?? '';

    const removed = await api<UserBody>(app, 'DELETE', '/api/users/me/avatar', { token: rahul.accessToken });
    expect(removed.status).toBe(200);
    expect(removed.body.user.avatarUrl).toBeNull();
    expect((await fetchFile(previousUrl)).status).toBe(404);
  });

  it('accepts only JPG and PNG images', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.alloc(64, 0x20)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]);
    const script = Buffer.from('<script>alert(1)</script>'.repeat(4));

    for (const [file, name, type] of [
      [pdf, 'cv.pdf', 'application/pdf'],
      [gif, 'a.gif', 'image/gif'],
      [script, 'looks-like.png', 'image/png'],
    ] as const) {
      const response = await uploadFile(app, 'PUT', '/api/users/me/avatar', priya.accessToken, file, name, type);
      expect(response.status).toBe(400);
    }
  });

  it('rejects a damaged image instead of storing it with its metadata', async () => {
    const truncated = jpegWithMetadata().subarray(0, 40);
    const response = await uploadFile(
      app, 'PUT', '/api/users/me/avatar', priya.accessToken, truncated, 'broken.jpg', 'image/jpeg',
    );
    expect(response.status).toBe(400);
  });

  it('ignores an external image address sent through the profile endpoint', async () => {
    const response = await api<UserBody>(app, 'PATCH', '/api/users/me', {
      token: priya.accessToken,
      body: { fullName: 'Priya Sharma', avatarUrl: 'https://tracker.example/pixel.gif' },
    });
    expect(response.status).toBe(200);
    expect(response.body.user.avatarUrl).toBeNull();
  });

  it('refuses to point a profile at another student’s upload, even directly in the database', async () => {
    const amanSelf = await api<UserBody>(app, 'GET', '/api/auth/me', { token: aman.accessToken });
    const amanPhotoId = attachmentIdFrom(amanSelf.body.user.avatarUrl ?? '');

    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>('SELECT campus_id FROM users WHERE id = $1', [
      priya.id,
    ]);
    const context = { userId: priya.id, campusId: rows[0].campus_id, role: 'STUDENT' as const };

    await expect(
      db.asUser(context, (tx) =>
        tx.query('UPDATE users SET avatar_attachment_id = $2 WHERE id = $1', [priya.id, amanPhotoId]),
      ),
    ).rejects.toThrow(/must be your own uploaded image/);
  });
});

describe('payment QR codes', () => {
  let qrUrl = '';
  let paymentId = '';

  it('saves a QR code on the helper’s profile', async () => {
    const response = await uploadFile<UserBody>(
      app, 'PUT', '/api/users/me/payment-qr', aman.accessToken, TINY_PNG, 'qr.png', 'image/png',
    );
    expect(response.status).toBe(200);
    expect(response.body.user.upiQrUrl).toMatch(/^\/api\/uploads\//);
    qrUrl = response.body.user.upiQrUrl ?? '';
  });

  it('keeps the QR code when the UPI ID is edited', async () => {
    const response = await api<UserBody>(app, 'PATCH', '/api/users/me/payment-details', {
      token: aman.accessToken,
      body: { upiId: 'aman.singh@okaxis' },
    });
    expect(response.status).toBe(200);
    expect(response.body.user.upiId).toBe('aman.singh@okaxis');
    expect(response.body.user.upiQrUrl).toBeTruthy();
  });

  it('is never part of the public profile', async () => {
    const profile = await api(app, 'GET', `/api/users/${aman.id}`, { token: priya.accessToken });
    expect(JSON.stringify(profile.body)).not.toContain(attachmentIdFrom(qrUrl));
  });

  it('is shown to the student who owes money while the payment is due', async () => {
    // Rahul posts, Aman helps, Rahul confirms: a payment to Aman is now due.
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: rahul.accessToken,
      body: {
        title: 'Bring a notebook',
        description: 'Ruled, A4.',
        categorySlug: 'quick-delivery',
        rewardPaise: 2000,
        productCostPaise: 6000,
      },
    });
    const requestId = created.body.request.id;
    const offer = await api<{ offer: { id: string } }>(
      app, 'POST', `/api/requests/${requestId}/offers`, { token: aman.accessToken, body: {} },
    );
    await api(app, 'POST', `/api/requests/${requestId}/select-helper`, {
      token: rahul.accessToken,
      body: { offerId: offer.body.offer.id },
    });
    for (const step of ['accept', 'start', 'complete']) {
      await api(app, 'POST', `/api/requests/${requestId}/${step}`, { token: aman.accessToken, body: {} });
    }

    const confirmed = await api<{
      request: {
        status: string;
        payment: { id: string; payeeUpiQrUrl: string | null; payeeUpiId: string | null };
      };
    }>(app, 'POST', `/api/requests/${requestId}/confirm`, { token: rahul.accessToken, body: {} });

    expect(confirmed.body.request.status).toBe('PAYMENT_PENDING');
    const payment = confirmed.body.request.payment;
    paymentId = payment.id;
    expect(attachmentIdFrom(payment.payeeUpiQrUrl ?? '')).toBe(attachmentIdFrom(qrUrl));
    expect(payment.payeeUpiId).toBe('aman.singh@okaxis');

    // And the link works in an <img>, with no bearer token.
    const file = await fetchFile(payment.payeeUpiQrUrl ?? '');
    expect(file.status).toBe(200);
    expect(file.contentType).toBe('image/png');
  });

  it('is not shown to the helper themselves, and the payment is hidden from everyone else', async () => {
    const asPayee = await api<{ payment: { payeeUpiQrUrl: string | null } }>(
      app, 'GET', `/api/payments/${paymentId}`, { token: aman.accessToken },
    );
    expect(asPayee.body.payment.payeeUpiQrUrl).toBeNull();

    const asStranger = await api(app, 'GET', `/api/payments/${paymentId}`, { token: priya.accessToken });
    expect(asStranger.status).toBe(404);
  });

  it('cannot be fetched by id with another student’s own token', async () => {
    const plain = `/api/uploads/${attachmentIdFrom(qrUrl)}`;
    expect((await fetchFile(plain, priya.accessToken)).status).toBe(403);
    // The owner can still open it that way.
    expect((await fetchFile(plain, aman.accessToken)).status).toBe(200);
  });

  it('stops being shown once the helper confirms the money arrived', async () => {
    await api(app, 'POST', `/api/payments/${paymentId}/action`, {
      token: rahul.accessToken,
      body: { action: 'claim_sent' },
    });
    await api(app, 'POST', `/api/payments/${paymentId}/action`, {
      token: aman.accessToken,
      body: { action: 'confirm_received' },
    });
    const after = await api<{ payment: { status: string; payeeUpiQrUrl: string | null } }>(
      app, 'GET', `/api/payments/${paymentId}`, { token: rahul.accessToken },
    );
    expect(after.body.payment.status).toBe('PAYMENT_CONFIRMED');
    expect(after.body.payment.payeeUpiQrUrl).toBeNull();
  });

  it('removes the QR code but keeps the UPI ID', async () => {
    const removed = await api<UserBody>(app, 'DELETE', '/api/users/me/payment-qr', { token: aman.accessToken });
    expect(removed.status).toBe(200);
    expect(removed.body.user.upiQrUrl).toBeNull();
    expect(removed.body.user.upiId).toBe('aman.singh@okaxis');
    expect((await fetchFile(qrUrl)).status).toBe(404);
  });
});

describe('general uploads', () => {
  it('stores a private general image: a signed link for its owner, refused by id to anyone else', async () => {
    const response = await uploadFile<{ attachment: { url: string } }>(
      app, 'POST', '/api/uploads?purpose=GENERAL', priya.accessToken, TINY_PNG, 'notes.png', 'image/png',
    );
    expect(response.status).toBe(201);

    // The uploader is entitled to the file, so they are handed a link an <img> can use.
    const url = response.body.attachment.url;
    expect(url).toMatch(/\?expires=\d+&signature=/);
    expect((await fetchFile(url)).status).toBe(200);

    // By id alone, the file stays private to its owner.
    const plain = url.split('?')[0];
    expect((await fetchFile(plain, priya.accessToken)).status).toBe(200);
    expect((await fetchFile(plain, rahul.accessToken)).status).toBe(403);
    expect((await fetchFile(plain)).status).toBe(401);
  });

  it('sends profile photos and QR codes to their own endpoints', async () => {
    for (const purpose of ['AVATAR', 'UPI_QR']) {
      const response = await uploadFile(
        app, 'POST', `/api/uploads?purpose=${purpose}`, priya.accessToken, TINY_PNG, 'a.png', 'image/png',
      );
      expect(response.status).toBe(400);
    }
  });

  it('accepts files larger than the 1 MB JSON body limit', async () => {
    const large = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(1_500_000)]);
    const response = await uploadFile(
      app, 'POST', '/api/uploads?purpose=GENERAL', priya.accessToken, large, 'large.png', 'image/png',
    );
    expect(response.status).toBe(201);
  });

  it('rejects a file over the upload limit with a clear message', async () => {
    const huge = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const response = await uploadFile<{ error: { code: string } }>(
      app, 'POST', '/api/uploads?purpose=GENERAL', priya.accessToken, huge, 'huge.png', 'image/png',
    );
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a request with no file attached', async () => {
    const response = await api(app, 'PUT', '/api/users/me/avatar', { token: priya.accessToken, body: {} });
    expect(response.status).toBe(400);
  });
});
