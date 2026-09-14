import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, destroyTestApp, futureIso, promoteToAdmin, registerStudent, type TestUser } from './helpers.js';
import { getDatabase } from '../src/db/client.js';
import { escalateRewards, expireRequests, runJobsOnce } from '../src/jobs/scheduler.js';

/**
 * Feature coverage beyond the core transaction: chat, rentals, the marketplace,
 * discovery, disputes, moderation, the admin surface and the background jobs.
 */

let app: FastifyInstance;
let owner: TestUser;
let renter: TestUser;
let admin: TestUser;

beforeAll(async () => {
  app = await createTestApp();
  owner = await registerStudent(app, { fullName: 'Aman Singh', email: 'feat.owner@nitp.ac.in' });
  renter = await registerStudent(app, { fullName: 'Rahul Kumar', email: 'feat.renter@nitp.ac.in' });
  admin = await registerStudent(app, { fullName: 'Campus Admin', email: 'feat.admin@nitp.ac.in' });
  await promoteToAdmin(admin.id, 'CAMPUS_ADMIN');
});

afterAll(async () => destroyTestApp(app));

describe('chat', () => {
  let requestId: string;
  let conversationId: string;
  let stranger: TestUser;

  it('opens only after a helper is committed, and only for the two participants', async () => {
    stranger = await registerStudent(app, { email: 'feat.stranger@nitp.ac.in' });

    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: renter.accessToken,
      body: { title: 'Need DBMS notes', description: 'Unit 3 and 4.', categorySlug: 'academic-help', rewardPaise: 5000 },
    });
    requestId = created.body.request.id;

    // No chat before a helper exists.
    const tooEarly = await api(app, 'GET', `/api/requests/${requestId}/conversation`, {
      token: renter.accessToken,
    });
    expect(tooEarly.status).toBe(404);

    const offer = await api<{ offer: { id: string } }>(
      app, 'POST', `/api/requests/${requestId}/offers`,
      { token: owner.accessToken, body: { offeredRewardPaise: 5000 } },
    );
    await api(app, 'POST', `/api/requests/${requestId}/select-helper`, {
      token: renter.accessToken,
      body: { offerId: offer.body.offer.id },
    });

    const conversation = await api<{ conversationId: string }>(
      app, 'GET', `/api/requests/${requestId}/conversation`, { token: renter.accessToken },
    );
    expect(conversation.status).toBe(200);
    conversationId = conversation.body.conversationId;
  });

  it('lets the two participants exchange messages', async () => {
    const sent = await api<{ message: { body: string } }>(
      app, 'POST', `/api/conversations/${conversationId}/messages`,
      { token: renter.accessToken, body: { body: 'Hi! Are the notes handwritten?' } },
    );
    expect(sent.status).toBe(201);

    const reply = await api(app, 'POST', `/api/conversations/${conversationId}/messages`, {
      token: owner.accessToken,
      body: { body: 'Yes, scanned PDFs. Sending now.' },
    });
    expect(reply.status).toBe(201);

    const messages = await api<{ messages: { body: string }[] }>(
      app, 'GET', `/api/conversations/${conversationId}/messages`, { token: renter.accessToken },
    );
    expect(messages.body.messages).toHaveLength(2);
    // Oldest first, so the thread reads top to bottom.
    expect(messages.body.messages[0].body).toContain('handwritten');
  });

  it('hides the conversation from everybody else', async () => {
    const read = await api(app, 'GET', `/api/conversations/${conversationId}/messages`, {
      token: stranger.accessToken,
    });
    expect(read.status).toBe(404);

    const write = await api(app, 'POST', `/api/conversations/${conversationId}/messages`, {
      token: stranger.accessToken,
      body: { body: 'Let me in' },
    });
    expect([403, 404]).toContain(write.status);
  });

  it('rejects an empty message', async () => {
    const response = await api(app, 'POST', `/api/conversations/${conversationId}/messages`, {
      token: renter.accessToken,
      body: {},
    });
    expect(response.status).toBe(422);
  });

  it('tracks unread counts and clears them on read', async () => {
    await api(app, 'POST', `/api/conversations/${conversationId}/messages`, {
      token: owner.accessToken,
      body: { body: 'One more thing' },
    });
    const before = await api<{ conversations: { unreadCount: number }[] }>(
      app, 'GET', '/api/conversations', { token: renter.accessToken },
    );
    expect(before.body.conversations[0].unreadCount).toBeGreaterThan(0);

    await api(app, 'POST', `/api/conversations/${conversationId}/read`, {
      token: renter.accessToken,
      body: {},
    });
    const after = await api<{ conversations: { unreadCount: number }[] }>(
      app, 'GET', '/api/conversations', { token: renter.accessToken },
    );
    expect(after.body.conversations[0].unreadCount).toBe(0);
  });
});

describe('rentals', () => {
  let itemId: string;
  let rentalId: string;

  it('lists an item for rent', async () => {
    const response = await api<{ item: { id: string; status: string; depositPaise: number } }>(
      app, 'POST', '/api/rental-items',
      {
        token: owner.accessToken,
        body: {
          name: 'Scientific Calculator',
          description: 'Casio FX-991EX, works perfectly.',
          categorySlug: 'borrow-rent',
          condition: 'GOOD',
          pricePaise: 3000, // ₹30
          rentalUnit: 'DAY',
          depositPaise: 20000, // ₹200
          pickupZone: 'Hostel A',
        },
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.item.status).toBe('AVAILABLE');
    itemId = response.body.item.id;
  });

  it('refuses to let the owner rent their own item', async () => {
    const response = await api(app, 'POST', '/api/rentals', {
      token: owner.accessToken,
      body: { itemId, startAt: futureIso(60), expectedReturnAt: futureIso(60 + 24 * 60) },
    });
    expect(response.status).toBe(400);
  });

  it('computes the fee server-side from the stored price', async () => {
    const response = await api<{ rental: { id: string; units: number; rentalFeePaise: number; depositPaise: number } }>(
      app, 'POST', '/api/rentals',
      {
        token: renter.accessToken,
        body: {
          itemId,
          startAt: futureIso(60),
          expectedReturnAt: futureIso(60 + 3 * 24 * 60), // three days
          message: 'Need it for the maths exam.',
          // A client-supplied price must be ignored.
          rentalFeePaise: 1,
        },
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.rental.units).toBe(3);
    expect(response.body.rental.rentalFeePaise).toBe(9000); // 3 × ₹30
    expect(response.body.rental.depositPaise).toBe(20000);
    rentalId = response.body.rental.id;
  });

  it('walks the full rental lifecycle through to a settled deposit', async () => {
    const accepted = await api<{ rental: { status: string } }>(
      app, 'POST', `/api/rentals/${rentalId}/accept`, { token: owner.accessToken, body: {} },
    );
    expect(accepted.body.rental.status).toBe('RESERVED');

    // Reserving takes the item off the market.
    const item = await api<{ item: { status: string } }>(app, 'GET', `/api/rental-items/${itemId}`, {
      token: renter.accessToken,
    });
    expect(item.body.item.status).toBe('RESERVED');

    const pickedUp = await api<{ rental: { status: string } }>(
      app, 'POST', `/api/rentals/${rentalId}/confirm-pickup`, { token: owner.accessToken, body: {} },
    );
    expect(pickedUp.body.rental.status).toBe('RENTED');

    const returned = await api<{ rental: { status: string } }>(
      app, 'POST', `/api/rentals/${rentalId}/mark-returned`, { token: renter.accessToken, body: {} },
    );
    expect(returned.body.rental.status).toBe('RETURN_PENDING');

    const settled = await api<{ rental: { status: string; depositReturnedPaise: number } }>(
      app, 'POST', `/api/rentals/${rentalId}/confirm-return`,
      { token: owner.accessToken, body: { depositReturnedPaise: 20000 } },
    );
    expect(settled.body.rental.status).toBe('COMPLETED');
    expect(settled.body.rental.depositReturnedPaise).toBe(20000);

    // And the item is available again.
    const after = await api<{ item: { status: string } }>(app, 'GET', `/api/rental-items/${itemId}`, {
      token: renter.accessToken,
    });
    expect(after.body.item.status).toBe('AVAILABLE');
  });

  it('refuses to return more deposit than was taken', async () => {
    const second = await api<{ rental: { id: string } }>(app, 'POST', '/api/rentals', {
      token: renter.accessToken,
      body: { itemId, startAt: futureIso(10), expectedReturnAt: futureIso(10 + 24 * 60) },
    });
    const id = second.body.rental.id;
    await api(app, 'POST', `/api/rentals/${id}/accept`, { token: owner.accessToken, body: {} });
    await api(app, 'POST', `/api/rentals/${id}/confirm-pickup`, { token: owner.accessToken, body: {} });
    await api(app, 'POST', `/api/rentals/${id}/mark-returned`, { token: renter.accessToken, body: {} });

    const response = await api(app, 'POST', `/api/rentals/${id}/confirm-return`, {
      token: owner.accessToken,
      body: { depositReturnedPaise: 999999 },
    });
    expect(response.status).toBe(400);
  });

  it('prevents two simultaneous bookings of the same item', async () => {
    const db = await getDatabase();
    const { rows } = await db.query<{ campus_id: string }>('SELECT campus_id FROM users WHERE id = $1', [owner.id]);
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(Date.now() + 2 * 86_400_000);

    const insert = (renterId: string, status: string) =>
      db.query(
        `INSERT INTO rentals (campus_id, item_id, owner_id, renter_id, status, start_at,
                              expected_return_at, units, rental_fee_paise, deposit_paise)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,3000,20000)`,
        [rows[0].campus_id, itemId, owner.id, renterId, status, start, end],
      );

    // Clear any live booking left over from the previous test so this one starts
    // from a known state.
    await db.query(
      `UPDATE rentals SET status = 'COMPLETED'
        WHERE item_id = $1 AND status IN ('RESERVED','RENTED','RETURN_PENDING')`,
      [itemId],
    );

    const third = await registerStudent(app, { email: 'feat.thirdrenter@nitp.ac.in' });
    await insert(third.id, 'RESERVED');

    // The partial unique index allows exactly one live booking per item, so a
    // second overlapping reservation cannot be written at all.
    await expect(insert(renter.id, 'RESERVED')).rejects.toThrow(
      /rentals_one_active_per_item|duplicate key/,
    );
  });
});

describe('marketplace', () => {
  let listingId: string;

  it('creates a listing and finds it by search', async () => {
    const created = await api<{ listing: { id: string; status: string } }>(
      app, 'POST', '/api/listings',
      {
        token: owner.accessToken,
        body: {
          title: 'Engineering Mathematics textbook',
          description: 'Second semester, barely used.',
          categorySlug: 'marketplace',
          listingType: 'SELL',
          pricePaise: 25000,
          condition: 'LIKE_NEW',
          pickupZone: 'Hostel A',
        },
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.listing.status).toBe('ACTIVE');
    listingId = created.body.listing.id;

    const found = await api<{ listings: { id: string }[] }>(
      app, 'GET', '/api/listings?q=mathematics', { token: renter.accessToken },
    );
    expect(found.body.listings.map((l) => l.id)).toContain(listingId);
  });

  it('forces a giveaway to be free', async () => {
    const response = await api<{ listing: { pricePaise: number } }>(app, 'POST', '/api/listings', {
      token: owner.accessToken,
      body: {
        title: 'Free lab coat',
        description: 'Taking it off my hands.',
        categorySlug: 'marketplace',
        listingType: 'GIVEAWAY',
        pricePaise: 50000,
        condition: 'GOOD',
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.listing.pricePaise).toBe(0);
  });

  it('stops anyone but the seller editing a listing', async () => {
    const response = await api(app, 'PATCH', `/api/listings/${listingId}`, {
      token: renter.accessToken,
      body: { pricePaise: 1 },
    });
    expect([403, 404]).toContain(response.status);
  });

  it('removes a listing softly and drops it from the feed', async () => {
    await api(app, 'DELETE', `/api/listings/${listingId}`, { token: owner.accessToken });
    const found = await api<{ listings: { id: string }[] }>(app, 'GET', '/api/listings', {
      token: renter.accessToken,
    });
    expect(found.body.listings.map((l) => l.id)).not.toContain(listingId);
  });
});

describe('Lost & Found', () => {
  let postId: string;
  let claimId: string;

  it('creates a dedicated found-item post and exposes it in campus search', async () => {
    const created = await api<{post:{id:string;status:string}}>(app,'POST','/api/lost-found',{token:owner.accessToken,body:{
      postType:'FOUND',title:'Black Casio calculator',description:'Found near the library staircase.',
      category:'ELECTRONICS',color:'Black',brand:'Casio',approximateLocation:'Library entrance',
      occurredAt:new Date().toISOString(),verificationQuestion:'What is written on the back?',imageIds:[],
    }});
    expect(created.status).toBe(201); expect(created.body.post.status).toBe('OPEN'); postId=created.body.post.id;
    const feed=await api<{posts:{id:string}[]}>(app,'GET','/api/lost-found?q=calculator',{token:renter.accessToken});
    expect(feed.body.posts.map(post=>post.id)).toContain(postId);
  });

  it('keeps ownership proof private and lets the author accept one response', async () => {
    const created=await api<{claim:{id:string}}>(app,'POST',`/api/lost-found/${postId}/claims`,{token:renter.accessToken,body:{message:'I believe this is mine.',verificationAnswer:'My roll number is engraved under the cover.'}});
    expect(created.status).toBe(201);claimId=created.body.claim.id;
    const publicDetail=await api<{post:{claims:unknown[];myClaim:{id:string}}}>(app,'GET',`/api/lost-found/${postId}`,{token:renter.accessToken});
    expect(publicDetail.body.post.claims).toHaveLength(0);expect(publicDetail.body.post.myClaim.id).toBe(claimId);
    const accepted=await api<{claim:{status:string}}>(app,'PATCH',`/api/lost-found/${postId}/claims/${claimId}`,{token:owner.accessToken,body:{status:'ACCEPTED'}});
    expect(accepted.body.claim.status).toBe('ACCEPTED');
    const detail=await api<{post:{status:string;claims:{verificationAnswer:string}[]}}>(app,'GET',`/api/lost-found/${postId}`,{token:owner.accessToken});
    expect(detail.body.post.status).toBe('MATCHED');expect(detail.body.post.claims[0].verificationAnswer).toContain('roll number');
  });

  it('marks a matched item returned and supports moderation', async () => {
    const returned=await api<{post:{status:string}}>(app,'POST',`/api/lost-found/${postId}/actions`,{token:owner.accessToken,body:{action:'MARK_RETURNED'}});
    expect(returned.body.post.status).toBe('RETURNED');
    const moderated=await api(app,'PATCH',`/api/admin/lost-found/${postId}`,{token:admin.accessToken,body:{status:'CLOSED',reason:'Test moderation action'}});
    expect(moderated.status).toBe(200);
  });
});

describe('discovery', () => {
  it('filters by category, reward and search text, and sorts by reward', async () => {
    await api(app, 'POST', '/api/requests', {
      token: owner.accessToken,
      body: { title: 'Bring samosa from canteen', description: 'Evening snack.', categorySlug: 'quick-delivery', rewardPaise: 2000 },
    });
    await api(app, 'POST', '/api/requests', {
      token: owner.accessToken,
      body: { title: 'Explain pointers in C', description: 'Half an hour of tutoring.', categorySlug: 'academic-help', rewardPaise: 15000 },
    });

    const byCategory = await api<{ items: { categorySlug: string }[] }>(
      app, 'GET', '/api/requests?categorySlug=academic-help', { token: renter.accessToken },
    );
    expect(byCategory.body.items.every((item) => item.categorySlug === 'academic-help')).toBe(true);

    const byReward = await api<{ items: { rewardPaise: number }[] }>(
      app, 'GET', '/api/requests?minRewardPaise=10000', { token: renter.accessToken },
    );
    expect(byReward.body.items.every((item) => item.rewardPaise >= 10000)).toBe(true);

    const search = await api<{ items: { title: string }[] }>(
      app, 'GET', '/api/requests?q=samosa', { token: renter.accessToken },
    );
    expect(search.body.items.some((item) => item.title.includes('samosa'))).toBe(true);

    const sorted = await api<{ items: { rewardPaise: number }[] }>(
      app, 'GET', '/api/requests?sort=HIGHEST_REWARD', { token: renter.accessToken },
    );
    const rewards = sorted.body.items.map((item) => item.rewardPaise);
    expect([...rewards].sort((a, b) => b - a)).toEqual(rewards);
  });

  it('paginates rather than returning everything', async () => {
    const page = await api<{ items: unknown[]; nextCursor: string | null }>(
      app, 'GET', '/api/requests?limit=1', { token: renter.accessToken },
    );
    expect(page.body.items).toHaveLength(1);
    expect(page.body.nextCursor).toBeTruthy();

    const next = await api<{ items: unknown[] }>(
      app, 'GET', `/api/requests?limit=1&cursor=${encodeURIComponent(page.body.nextCursor!)}`,
      { token: renter.accessToken },
    );
    expect(next.body.items).toHaveLength(1);
    expect(next.body.items[0]).not.toEqual(page.body.items[0]);
  });

  it('keeps a department-restricted request away from other departments', async () => {
    const db = await getDatabase();
    const { rows: departments } = await db.query<{ id: string }>(
      'SELECT id FROM departments ORDER BY code LIMIT 2',
    );
    await db.query('UPDATE users SET department_id = $2 WHERE id = $1', [owner.id, departments[0].id]);
    await db.query('UPDATE users SET department_id = $2 WHERE id = $1', [renter.id, departments[1].id]);

    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: owner.accessToken,
      body: {
        title: 'Department only notice',
        description: 'Just for my branch.',
        categorySlug: 'academic-help',
        rewardPaise: 3000,
        visibility: 'DEPARTMENT',
      },
    });
    const restrictedId = created.body.request.id;

    const otherDepartment = await api<{ items: { id: string }[] }>(
      app, 'GET', '/api/requests?limit=50', { token: renter.accessToken },
    );
    expect(otherDepartment.body.items.map((item) => item.id)).not.toContain(restrictedId);

    // And it is not reachable by direct id either.
    const direct = await api(app, 'GET', `/api/requests/${restrictedId}`, { token: renter.accessToken });
    expect(direct.status).toBe(404);
  });

  it('hides the requester’s exact position from non-participants', async () => {
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: owner.accessToken,
      body: {
        title: 'Deliver to my room',
        description: 'x',
        categorySlug: 'quick-delivery',
        rewardPaise: 2000,
        lat: 25.585432,
        lng: 84.851987,
      },
    });
    const viewed = await api<{ request: { exactLat: number | null; approximateLat: number | null } }>(
      app, 'GET', `/api/requests/${created.body.request.id}`, { token: renter.accessToken },
    );
    expect(viewed.body.request.exactLat).toBeNull();
    expect(viewed.body.request.approximateLat).toBe(25.585);

    // The requester still sees their own exact position.
    const asOwner = await api<{ request: { exactLat: number | null } }>(
      app, 'GET', `/api/requests/${created.body.request.id}`, { token: owner.accessToken },
    );
    expect(asOwner.body.request.exactLat).toBeCloseTo(25.585432, 5);
  });
});

describe('background jobs', () => {
  it('expires a request whose deadline has passed', async () => {
    const db = await getDatabase();
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: owner.accessToken,
      body: {
        title: 'Expires very soon',
        description: 'x',
        categorySlug: 'quick-delivery',
        rewardPaise: 2000,
        deadlineAt: futureIso(1),
      },
    });
    const id = created.body.request.id;
    // Move the deadline into the past rather than waiting for it.
    await db.query(`UPDATE requests SET deadline_at = now() - interval '1 minute' WHERE id = $1`, [id]);

    const expired = await expireRequests(db);
    expect(expired).toBeGreaterThanOrEqual(1);

    const detail = await api<{ request: { status: string } }>(
      app, 'GET', `/api/requests/${id}`, { token: owner.accessToken },
    );
    expect(detail.body.request.status).toBe('EXPIRED');
  });

  it('escalates an opted-in reward up to its ceiling and no further', async () => {
    const db = await getDatabase();
    const created = await api<{ request: { id: string; rewardPaise: number } }>(
      app, 'POST', '/api/requests',
      {
        token: owner.accessToken,
        body: {
          title: 'Bring Maggie at midnight',
          description: 'Nobody is taking this.',
          categorySlug: 'quick-delivery',
          rewardPaise: 3000,
          maxRewardPaise: 3500,
          autoEscalate: true,
        },
      },
    );
    const id = created.body.request.id;
    await db.query(`UPDATE requests SET created_at = now() - interval '2 hours' WHERE id = $1`, [id]);

    await escalateRewards(db);
    const first = await api<{ request: { rewardPaise: number } }>(
      app, 'GET', `/api/requests/${id}`, { token: owner.accessToken },
    );
    // A 20% step would be ₹36, so it is clamped to the ₹35 ceiling.
    expect(first.body.request.rewardPaise).toBe(3500);

    await db.query(`UPDATE requests SET last_escalated_at = now() - interval '2 hours' WHERE id = $1`, [id]);
    await escalateRewards(db);
    const second = await api<{ request: { rewardPaise: number } }>(
      app, 'GET', `/api/requests/${id}`, { token: owner.accessToken },
    );
    expect(second.body.request.rewardPaise).toBe(3500);
  });

  it('runs a full pass without error', async () => {
    const db = await getDatabase();
    await expect(runJobsOnce(db)).resolves.toBeDefined();
  });
});

describe('reports, disputes and the admin surface', () => {
  let disputeId: string;
  let reportedRequestId: string;

  it('accepts a report and refuses a duplicate while it is still open', async () => {
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: owner.accessToken,
      body: { title: 'Questionable request', description: 'x', categorySlug: 'quick-delivery', rewardPaise: 2000 },
    });
    reportedRequestId = created.body.request.id;

    const first = await api(app, 'POST', '/api/reports', {
      token: renter.accessToken,
      body: { targetType: 'REQUEST', targetId: reportedRequestId, reason: 'Spam', description: 'Posted repeatedly.' },
    });
    expect(first.status).toBe(201);

    const duplicate = await api<{ error: { code: string } }>(app, 'POST', '/api/reports', {
      token: renter.accessToken,
      body: { targetType: 'REQUEST', targetId: reportedRequestId, reason: 'Spam' },
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('REPORT_EXISTS');
  });

  it('freezes a request when a participant opens a dispute', async () => {
    const created = await api<{ request: { id: string } }>(app, 'POST', '/api/requests', {
      token: renter.accessToken,
      body: { title: 'Disputed delivery', description: 'x', categorySlug: 'quick-delivery', rewardPaise: 4000 },
    });
    const id = created.body.request.id;
    const offer = await api<{ offer: { id: string } }>(
      app, 'POST', `/api/requests/${id}/offers`, { token: owner.accessToken, body: {} },
    );
    await api(app, 'POST', `/api/requests/${id}/select-helper`, {
      token: renter.accessToken, body: { offerId: offer.body.offer.id },
    });
    await api(app, 'POST', `/api/requests/${id}/accept`, { token: owner.accessToken, body: {} });
    await api(app, 'POST', `/api/requests/${id}/start`, { token: owner.accessToken, body: {} });

    const dispute = await api<{ dispute: { id: string; status: string } }>(app, 'POST', '/api/disputes', {
      token: renter.accessToken,
      body: {
        subjectType: 'REQUEST',
        subjectId: id,
        reason: 'Item never arrived',
        description: 'It has been an hour and nothing was delivered.',
      },
    });
    expect(dispute.status).toBe(201);
    disputeId = dispute.body.dispute.id;

    const detail = await api<{ request: { status: string } }>(
      app, 'GET', `/api/requests/${id}`, { token: renter.accessToken },
    );
    expect(detail.body.request.status).toBe('DISPUTED');
  });

  it('stops an outsider opening a dispute on a transaction they are not part of', async () => {
    const stranger = await registerStudent(app, { email: 'feat.meddler@nitp.ac.in' });
    const response = await api(app, 'POST', '/api/disputes', {
      token: stranger.accessToken,
      body: {
        subjectType: 'REQUEST',
        subjectId: reportedRequestId,
        reason: 'Meddling',
        description: 'I am not involved in this at all.',
      },
    });
    expect([403, 404]).toContain(response.status);
  });

  it('lets an admin resolve the dispute and unfreeze the request', async () => {
    const response = await api(app, 'PATCH', `/api/admin/disputes/${disputeId}`, {
      token: admin.accessToken,
      body: { status: 'RESOLVED_HELPER', resolution: 'Delivery photo confirms the item arrived.' },
    });
    expect(response.status).toBe(200);

    const disputes = await api<{ disputes: { id: string; status: string }[] }>(
      app, 'GET', '/api/admin/disputes', { token: admin.accessToken },
    );
    expect(disputes.body.disputes.find((d) => d.id === disputeId)?.status).toBe('RESOLVED_HELPER');
  });

  it('reports analytics without dividing by zero', async () => {
    const response = await api<{
      registeredStudents: number;
      completionRate: number;
      popularCategories: unknown[];
    }>(app, 'GET', '/api/admin/analytics', { token: admin.accessToken });

    expect(response.status).toBe(200);
    expect(response.body.registeredStudents).toBeGreaterThan(0);
    expect(Number.isFinite(response.body.completionRate)).toBe(true);
    expect(Array.isArray(response.body.popularCategories)).toBe(true);
  });

  it('suspends a student, signing them out immediately', async () => {
    const troublemaker = await registerStudent(app, { email: 'feat.suspended@nitp.ac.in' });
    const suspend = await api(app, 'PATCH', `/api/admin/users/${troublemaker.id}`, {
      token: admin.accessToken,
      body: { accountStatus: 'SUSPENDED', suspensionReason: 'Repeated fake completions' },
    });
    expect(suspend.status).toBe(200);

    const blocked = await api<{ error: { code: string } }>(app, 'GET', '/api/requests', {
      token: troublemaker.accessToken,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('writes an audit record for every admin action', async () => {
    const response = await api<{ logs: { action: string }[] }>(app, 'GET', '/api/admin/audit-logs', {
      token: admin.accessToken,
    });
    const actions = response.body.logs.map((log) => log.action);
    expect(actions).toContain('admin.update_user');
    expect(actions).toContain('admin.resolve_dispute');
  });
});

describe('preferences and favourites', () => {
  it('saves availability and matching preferences', async () => {
    const response = await api<{ user: { availability: string; minRewardPaise: number } }>(
      app, 'PATCH', '/api/users/me/preferences',
      {
        token: renter.accessToken,
        body: { availability: 'BUSY', minRewardPaise: 5000, maxDistanceMetres: 800, preferredCategories: ['academic-help'] },
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.user.availability).toBe('BUSY');
    expect(response.body.user.minRewardPaise).toBe(5000);
  });

  it('keeps favourites private to the student who set them', async () => {
    await api(app, 'PUT', `/api/users/${owner.id}/favourite`, { token: renter.accessToken, body: {} });

    const mine = await api<{ helpers: { id: string }[] }>(app, 'GET', '/api/users/me/favourites', {
      token: renter.accessToken,
    });
    expect(mine.body.helpers.map((h) => h.id)).toContain(owner.id);

    // The favourited student cannot see that they were favourited.
    const theirs = await api<{ helpers: unknown[] }>(app, 'GET', '/api/users/me/favourites', {
      token: owner.accessToken,
    });
    expect(theirs.body.helpers).toHaveLength(0);
  });

  it('refuses to let a student favourite themselves', async () => {
    const response = await api(app, 'PUT', `/api/users/${renter.id}/favourite`, {
      token: renter.accessToken,
      body: {},
    });
    expect(response.status).toBe(400);
  });

  it('lets a student clear their shared location', async () => {
    await api(app, 'POST', '/api/users/me/location', {
      token: renter.accessToken,
      body: { lat: 25.5854, lng: 84.8514 },
    });
    const cleared = await api(app, 'DELETE', '/api/users/me/location', { token: renter.accessToken });
    expect(cleared.status).toBe(204);

    const db = await getDatabase();
    const { rows } = await db.query<{ last_lat: number | null }>(
      'SELECT last_lat FROM user_preferences WHERE user_id = $1',
      [renter.id],
    );
    expect(rows[0].last_lat).toBeNull();
  });
});
