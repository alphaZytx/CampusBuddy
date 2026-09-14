import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, destroyTestApp, futureIso, registerStudent, uploadFile, type TestUser } from './helpers.js';
import { getDatabase } from '../src/db/client.js';
import { TINY_PNG } from './fixtures.js';

/**
 * The complete transaction, end to end (spec §100, §118).
 *
 *   Rahul posts "Bring Cold Drink" → Aman offers → Rahul selects → Aman accepts,
 *   starts, completes → Rahul confirms → payment → both rate → reputation updates.
 *
 * This is the demo flow, exercised through the real HTTP stack.
 */

let app: FastifyInstance;
let rahul: TestUser;
let aman: TestUser;
let requestId: string;
let offerId: string;
let paymentId: string;

beforeAll(async () => {
  app = await createTestApp();
  rahul = await registerStudent(app, { fullName: 'Rahul Kumar', email: 'rahul.ug22.cs@nitp.ac.in' });
  aman = await registerStudent(app, { fullName: 'Aman Singh', email: 'aman.ug22.ec@nitp.ac.in' });
});

afterAll(async () => {
  await destroyTestApp(app);
});

describe('the complete CampusBuddy transaction', () => {
  it('1. Rahul posts a request with a product cost and a reward', async () => {
    const response = await api<{ request: Record<string, unknown> }>(app, 'POST', '/api/requests', {
      token: rahul.accessToken,
      body: {
        title: 'Bring Cold Drink',
        description: 'A cold drink from the campus canteen, please.',
        categorySlug: 'quick-delivery',
        subcategory: 'Cold Drinks',
        productCostPaise: 2000, // ₹20
        rewardPaise: 1000, // ₹10
        pickupLocation: { label: 'Campus Canteen', lat: 25.5854, lng: 84.8514 },
        deliveryLocation: { label: 'Hostel A', lat: 25.5861, lng: 84.852 },
        deadlineAt: futureIso(20),
        urgency: 'NORMAL',
        visibility: 'CAMPUS',
      },
    });

    expect(response.status).toBe(201);
    const created = response.body.request;
    expect(created.status).toBe('OPEN');
    // The total is a generated column: ₹20 + ₹10 = ₹30.
    expect(created.totalBudgetPaise).toBe(3000);
    expect(created.offerCount).toBe(0);
    requestId = created.id as string;
  });

  it('2. the request appears in Aman’s campus feed, but not in his own-requests list', async () => {
    const feed = await api<{ items: { id: string }[] }>(app, 'GET', '/api/requests?scope=ALL', {
      token: aman.accessToken,
    });
    expect(feed.status).toBe(200);
    expect(feed.body.items.map((item) => item.id)).toContain(requestId);

    const mine = await api<{ items: { id: string }[] }>(app, 'GET', '/api/requests?scope=MINE', {
      token: aman.accessToken,
    });
    expect(mine.body.items.map((item) => item.id)).not.toContain(requestId);
  });

  it('3. Rahul cannot offer to help with his own request', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/offers`, {
      token: rahul.accessToken,
      body: { offeredRewardPaise: 1000 },
    });
    expect(response.status).toBe(400);
  });

  it('4. Aman offers to help, moving the request to OFFERS_RECEIVED', async () => {
    const response = await api<{ offer: { id: string; status: string } }>(
      app,
      'POST',
      `/api/requests/${requestId}/offers`,
      { token: aman.accessToken, body: { offeredRewardPaise: 1000, etaMinutes: 12 } },
    );
    expect(response.status).toBe(201);
    expect(response.body.offer.status).toBe('PENDING');
    offerId = response.body.offer.id;

    const detail = await api<{ request: { status: string; offerCount: number } }>(
      app, 'GET', `/api/requests/${requestId}`, { token: rahul.accessToken },
    );
    expect(detail.body.request.status).toBe('OFFERS_RECEIVED');
    expect(detail.body.request.offerCount).toBe(1);
  });

  it('5. offering again updates the existing offer instead of creating a second one', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/offers`, {
      token: aman.accessToken,
      body: { offeredRewardPaise: 1000, etaMinutes: 10 },
    });
    expect(response.status).toBe(201);

    // The unique index on (request_id, helper_id) makes a genuine duplicate impossible.
    const offers = await api<{ offers: { etaMinutes: number }[] }>(
      app, 'GET', `/api/requests/${requestId}/offers`, { token: rahul.accessToken },
    );
    expect(offers.body.offers).toHaveLength(1);
    expect(offers.body.offers[0].etaMinutes).toBe(10);
  });

  it('6. Rahul is notified that an offer arrived', async () => {
    const response = await api<{ notifications: { type: string }[] }>(
      app, 'GET', '/api/notifications', { token: rahul.accessToken },
    );
    expect(response.body.notifications.some((n) => n.type === 'OFFER_CREATED')).toBe(true);
  });

  it('7. Rahul selects Aman, which opens the chat', async () => {
    const response = await api<{ request: { status: string; selectedHelper: { id: string } } }>(
      app, 'POST', `/api/requests/${requestId}/select-helper`,
      { token: rahul.accessToken, body: { offerId } },
    );
    expect(response.status).toBe(200);
    expect(response.body.request.status).toBe('HELPER_SELECTED');
    expect(response.body.request.selectedHelper.id).toBe(aman.id);

    const conversation = await api<{ conversationId: string }>(
      app, 'GET', `/api/requests/${requestId}/conversation`, { token: aman.accessToken },
    );
    expect(conversation.status).toBe(200);
    expect(conversation.body.conversationId).toBeTruthy();
  });

  it('8. Aman accepts, starts, and completes the task', async () => {
    const accepted = await api<{ request: { status: string } }>(
      app, 'POST', `/api/requests/${requestId}/accept`, { token: aman.accessToken, body: {} },
    );
    expect(accepted.body.request.status).toBe('ACCEPTED');

    const started = await api<{ request: { status: string } }>(
      app, 'POST', `/api/requests/${requestId}/start`, { token: aman.accessToken, body: {} },
    );
    expect(started.body.request.status).toBe('IN_PROGRESS');

    const completed = await api<{ request: { status: string } }>(
      app, 'POST', `/api/requests/${requestId}/complete`,
      { token: aman.accessToken, body: { note: 'Delivered to Hostel A reception.' } },
    );
    expect(completed.body.request.status).toBe('COMPLETED');
  });

  it('9. Aman cannot confirm his own completion', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/confirm`, {
      token: aman.accessToken,
      body: {},
    });
    expect(response.status).toBe(403);
  });

  it('10. Rahul confirms, and a payment for ₹30 is opened', async () => {
    const response = await api<{
      request: { status: string; payment: { id: string; amountPaise: number; status: string } };
    }>(app, 'POST', `/api/requests/${requestId}/confirm`, { token: rahul.accessToken, body: {} });

    expect(response.body.request.status).toBe('PAYMENT_PENDING');
    const payment = response.body.request.payment;
    // The amount is derived server-side: reward + what the helper spent.
    expect(payment.amountPaise).toBe(3000);
    expect(payment.status).toBe('PAYMENT_PENDING');
    paymentId = payment.id;
  });

  it('11. rating is refused until the payment is actually confirmed', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/ratings`, {
      token: rahul.accessToken,
      body: { stars: 5 },
    });
    expect(response.status).toBe(409);
  });

  it('12. Rahul claiming payment does NOT by itself mark the request paid', async () => {
    const receipt = await uploadFile<{ attachment: { id: string } }>(
      app, 'POST', '/api/uploads?purpose=PROOF', rahul.accessToken, TINY_PNG, 'upi-receipt.png', 'image/png',
    );
    expect(receipt.status).toBe(201);
    const claimed = await api<{ payment: { status: string; transactionReference: string; receipt: { id: string } } }>(
      app, 'POST', `/api/payments/${paymentId}/action`,
      { token: rahul.accessToken, body: {
        action: 'claim_sent', transactionReference: 'UPI-TEST-REF-1234', receiptAttachmentId: receipt.body.attachment.id,
      } },
    );
    expect(claimed.body.payment.status).toBe('PAYMENT_CLAIMED');
    expect(claimed.body.payment.transactionReference).toBe('UPI-TEST-REF-1234');
    expect(claimed.body.payment.receipt.id).toBe(receipt.body.attachment.id);

    // This is the central honesty guarantee: an unverified claim is not proof.
    const detail = await api<{ request: { status: string } }>(
      app, 'GET', `/api/requests/${requestId}`, { token: rahul.accessToken },
    );
    expect(detail.body.request.status).toBe('PAYMENT_PENDING');
  });

  it('13. Rahul cannot confirm receipt on Aman’s behalf', async () => {
    const response = await api(app, 'POST', `/api/payments/${paymentId}/action`, {
      token: rahul.accessToken,
      body: { action: 'confirm_received' },
    });
    expect(response.status).toBe(403);
  });

  it('14. Aman confirms he received the money, moving the request to PAID', async () => {
    const confirmed = await api<{ payment: { status: string } }>(
      app, 'POST', `/api/payments/${paymentId}/action`,
      { token: aman.accessToken, body: { action: 'confirm_received' } },
    );
    expect(confirmed.body.payment.status).toBe('PAYMENT_CONFIRMED');

    const detail = await api<{ request: { status: string } }>(
      app, 'GET', `/api/requests/${requestId}`, { token: rahul.accessToken },
    );
    expect(detail.body.request.status).toBe('PAID');
  });

  it('15. both students rate each other, and the request reaches RATED', async () => {
    const fromRahul = await api(app, 'POST', `/api/requests/${requestId}/ratings`, {
      token: rahul.accessToken,
      body: { stars: 5, punctuality: 5, reliability: 5, communication: 5, quality: 5, review: 'Very quick!' },
    });
    expect(fromRahul.status).toBe(201);

    const detailMidway = await api<{ request: { status: string } }>(
      app, 'GET', `/api/requests/${requestId}`, { token: rahul.accessToken },
    );
    // One rating is not enough to close the request.
    expect(detailMidway.body.request.status).toBe('PAID');

    const fromAman = await api(app, 'POST', `/api/requests/${requestId}/ratings`, {
      token: aman.accessToken,
      body: { stars: 5, clearInstructions: 5, paymentReliability: 5, respectfulness: 5 },
    });
    expect(fromAman.status).toBe(201);

    const detail = await api<{ request: { status: string } }>(
      app, 'GET', `/api/requests/${requestId}`, { token: rahul.accessToken },
    );
    expect(detail.body.request.status).toBe('RATED');
  });

  it('16. a duplicate rating is refused', async () => {
    const response = await api(app, 'POST', `/api/requests/${requestId}/ratings`, {
      token: rahul.accessToken,
      body: { stars: 1 },
    });
    expect(response.status).toBe(409);
  });

  it('17. Aman’s reputation and earnings update', async () => {
    const profile = await api<{
      user: { averageRating: number; completedTasks: number; ratingCount: number; completionRate: number };
    }>(app, 'GET', `/api/users/${aman.id}`, { token: rahul.accessToken });

    expect(profile.body.user.ratingCount).toBe(1);
    expect(profile.body.user.averageRating).toBe(5);
    expect(profile.body.user.completedTasks).toBe(1);
    expect(profile.body.user.completionRate).toBe(1);

    const earnings = await api<{ totalEarnedPaise: number; completedTasks: number }>(
      app, 'GET', '/api/users/me/earnings', { token: aman.accessToken },
    );
    expect(earnings.body.totalEarnedPaise).toBe(3000);
    expect(earnings.body.completedTasks).toBe(1);
  });

  it('18. the full status history was recorded', async () => {
    const response = await api<{ statusHistory: { to_status: string; action: string }[] }>(
      app, 'GET', `/api/requests/${requestId}/history`, { token: rahul.accessToken },
    );
    const statuses = response.body.statusHistory.map((entry) => entry.to_status);
    expect(statuses).toEqual([
      'OPEN',
      'OFFERS_RECEIVED',
      'HELPER_SELECTED',
      'ACCEPTED',
      'IN_PROGRESS',
      'COMPLETED',
      'PAYMENT_PENDING',
      'PAID',
      'RATED',
    ]);
  });

  it('19. the badge for a first completed task was awarded', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ badges: string[] }>('SELECT badges FROM users WHERE id = $1', [
      aman.id,
    ]);
    expect(rows[0].badges).toContain('first-task');
  });
});

describe('payment notifications', () => {
  it('tells the payee when money is sent, and the payer when receipt is confirmed', async () => {
    type Feed = { notifications: { type: string; title: string }[] };
    const forAman = await api<Feed>(app, 'GET', '/api/notifications', { token: aman.accessToken });
    expect(
      forAman.body.notifications.some((n) => n.type === 'PAYMENT_UPDATED' && n.title === 'Payment sent'),
    ).toBe(true);

    const forRahul = await api<Feed>(app, 'GET', '/api/notifications', { token: rahul.accessToken });
    expect(
      forRahul.body.notifications.some((n) => n.type === 'PAYMENT_UPDATED' && n.title === 'Payment confirmed'),
    ).toBe(true);
  });
});

describe('dynamic reward escalation', () => {
  it('raises the reward, records the history, and refuses a decrease', async () => {
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: rahul.accessToken,
      body: {
        title: 'Bring Maggie',
        description: 'Late night Maggie run.',
        categorySlug: 'quick-delivery',
        rewardPaise: 3000,
        maxRewardPaise: 6000,
        deadlineAt: futureIso(60),
      },
    });
    const id = created.body.request.id;

    const raised = await api<{ request: { rewardPaise: number } }>(
      app, 'POST', `/api/requests/${id}/reward`,
      { token: rahul.accessToken, body: { rewardPaise: 4000 } },
    );
    expect(raised.body.request.rewardPaise).toBe(4000);

    // Downward is not an escalation.
    const lowered = await api(app, 'POST', `/api/requests/${id}/reward`, {
      token: rahul.accessToken,
      body: { rewardPaise: 3500 },
    });
    expect(lowered.status).toBe(400);

    // And the ceiling the requester set is enforced.
    const beyondCap = await api(app, 'POST', `/api/requests/${id}/reward`, {
      token: rahul.accessToken,
      body: { rewardPaise: 9000 },
    });
    expect(beyondCap.status).toBe(400);

    const history = await api<{ rewardHistory: { from_paise: string; to_paise: string }[] }>(
      app, 'GET', `/api/requests/${id}/history`, { token: rahul.accessToken },
    );
    expect(history.body.rewardHistory).toHaveLength(1);
    expect(Number(history.body.rewardHistory[0].to_paise)).toBe(4000);
  });

  it('does not let a helper change the reward', async () => {
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: rahul.accessToken,
      body: {
        title: 'Collect printout',
        description: 'From the library print shop.',
        categorySlug: 'campus-assistance',
        rewardPaise: 2000,
      },
    });
    const response = await api(app, 'POST', `/api/requests/${created.body.request.id}/reward`, {
      token: aman.accessToken,
      body: { rewardPaise: 5000 },
    });
    expect(response.status).toBe(403);
  });
});
