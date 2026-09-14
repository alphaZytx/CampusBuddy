import { randomUUID } from 'node:crypto';
import { rupeesToPaise } from '@campusbuddy/shared';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { closeDatabase, getDatabase, type Database, type Queryable } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { bootstrapCampus } from '../src/db/bootstrap.js';
import { hashPassword } from '../src/core/password.js';
import { LISTINGS, PLACES, RENTAL_ITEMS, REQUESTS, REVIEWS, STAFF, STUDENTS } from './data.js';

/**
 * Development seed.
 *
 * Builds a believable campus: students with varied reputations, requests spread
 * across every stage of the lifecycle, a completed rental, marketplace listings,
 * and an open report and dispute so the admin panel has something to moderate.
 *
 * Runs in the trusted service context, which is why it can create history that a
 * user could never fabricate through the API.
 *
 *   npm run db:seed     add demo data to the current database
 *   npm run db:reset    drop everything, migrate, then seed
 */

const RESET = process.argv.includes('--reset');

/** Deterministic pseudo-randomness, so a demo looks the same every time it is rebuilt. */
let seedState = 42;
function random(): number {
  seedState = (seedState * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seedState / 2_147_483_648;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const randomInt = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);
const minutesAhead = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

async function resetSchema(db: Database): Promise<void> {
  logger.warn('Dropping and recreating the public schema');
  // Works on both drivers. The application role is a cluster-level object and survives.
  await db.exec('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
}

interface CreatedUser {
  id: string;
  name: string;
  email: string;
}

async function main(): Promise<void> {
  const db = await getDatabase();

  if (RESET) await resetSchema(db);
  await runMigrations(db);
  const campus = await bootstrapCampus(db);

  const existing = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM requests WHERE campus_id = $1`,
    [campus.campusId],
  );
  if (Number(existing.rows[0].count) > 0 && !RESET) {
    logger.warn('Database already contains requests. Use `npm run db:reset` to rebuild from scratch.');
    await closeDatabase();
    return;
  }

  const domain = env.allowedEmailDomains[0] ?? 'nitp.ac.in';
  const passwordHash = await hashPassword(env.SEED_PASSWORD);

  const departments = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM departments WHERE campus_id = $1',
    [campus.campusId],
  );
  const hostels = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM hostels WHERE campus_id = $1',
    [campus.campusId],
  );
  const departmentByCode = new Map(departments.rows.map((row) => [row.code, row.id]));
  const hostelByName = new Map(hostels.rows.map((row) => [row.name, row.id]));

  const centre = { lat: env.CAMPUS_CENTRE_LAT, lng: env.CAMPUS_CENTRE_LNG };
  const placeCoords = (label: string | undefined): { lat: number; lng: number } | null => {
    const place = PLACES.find((p) => p.label === label);
    return place ? { lat: centre.lat + place.dLat, lng: centre.lng + place.dLng } : null;
  };

  const students: CreatedUser[] = [];

  await db.transaction(async (tx) => {
    // ---------------------------------------------------------------- students
    for (const student of STUDENTS) {
      const email = `${student.handle}@${domain}`;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (campus_id, department_id, hostel_id, email, full_name, phone,
                            year_of_study, semester, bio, skills, is_verified,
                            verification_method, verified_at, upi_id, last_seen_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'COLLEGE_EMAIL',now(),$11,$12,$13)
         RETURNING id`,
        [
          campus.campusId,
          departmentByCode.get(student.department) ?? null,
          hostelByName.get(student.hostel) ?? null,
          email,
          student.name,
          // Clearly fictional numbers in a reserved-looking range.
          `9${String(randomInt(100000000, 199999999)).padStart(9, '0')}`,
          student.year,
          student.year * 2 - randomInt(0, 1),
          student.bio ?? null,
          student.skills,
          `${student.handle}@demoupi`,
          minutesAgo(randomInt(1, 2880)),
          minutesAgo(randomInt(30 * 1440, 400 * 1440)),
        ],
      );
      const id = rows[0].id;
      students.push({ id, name: student.name, email });

      await tx.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1,$2)', [
        id,
        passwordHash,
      ]);
      const place = pick(PLACES);
      await tx.query(
        `INSERT INTO user_preferences (user_id, availability, preferred_categories,
                                       min_reward_paise, max_distance_metres,
                                       last_lat, last_lng, last_location_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
        [
          id,
          pick(['AVAILABLE_NOW', 'AVAILABLE_NOW', 'AVAILABLE_NOW', 'AVAILABLE_LATER', 'BUSY']),
          student.categories,
          rupeesToPaise(pick([0, 0, 10, 20])),
          pick([1000, 1500, 2000, 3000]),
          centre.lat + place.dLat,
          centre.lng + place.dLng,
        ],
      );
      await tx.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [id]);
    }

    // ------------------------------------------------------------------- staff
    for (const member of STAFF) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (campus_id, email, full_name, role, is_verified,
                            verification_method, verified_at, created_at)
         VALUES ($1,$2,$3,$4,true,'MANUAL_REVIEW',now(),$5)
         RETURNING id`,
        [campus.campusId, `${member.handle}@${domain}`, member.name, member.role, minutesAgo(500 * 1440)],
      );
      await tx.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1,$2)', [
        rows[0].id,
        passwordHash,
      ]);
      await tx.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [rows[0].id]);
      await tx.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [rows[0].id]);
    }
  });

  logger.info(`Created ${students.length} students and ${STAFF.length} staff accounts`);

  // ------------------------------------------------------------------ requests
  for (const [index, template] of REQUESTS.entries()) {
    const requester = students[index % students.length];
    // The helper is always somebody else.
    const helper = students[(index + 5 + randomInt(0, 3)) % students.length].id === requester.id
      ? students[(index + 7) % students.length]
      : students[(index + 5 + randomInt(0, 3)) % students.length];

    await db.transaction(async (tx) => {
      await seedRequest(tx, {
        campusId: campus.campusId,
        template,
        requester,
        helper,
        students,
        placeCoords,
      });
    });
  }
  logger.info(`Created ${REQUESTS.length} requests across the lifecycle`);

  // --------------------------------------------------------- extra reputation
  // A handful of extra completed-and-rated tasks so profiles show real history.
  await db.transaction(async (tx) => {
    for (let i = 0; i < 40; i += 1) {
      const requester = students[randomInt(0, students.length - 1)];
      let helper = students[randomInt(0, students.length - 1)];
      if (helper.id === requester.id) helper = students[(students.indexOf(requester) + 1) % students.length];

      const reward = rupeesToPaise(pick([20, 30, 40, 50, 60, 80, 100]));
      const daysAgo = randomInt(2, 60);
      const requestId = randomUUID();

      await tx.query(
        `INSERT INTO requests (id, campus_id, requester_id, title, description, category_slug,
                               reward_paise, product_cost_paise, status, selected_helper_id,
                               created_at, accepted_at, started_at, completed_at, confirmed_at)
         VALUES ($1,$2,$3,$4,'Completed earlier this term.',$5,$6,0,'RATED',$7,$8,$8,$8,$8,$8)`,
        [
          requestId,
          campus.campusId,
          requester.id,
          pick([
            'Canteen run',
            'Printout collection',
            'Notes handover',
            'Parcel pickup',
            'Stationery delivery',
            'Quick tutoring session',
          ]),
          pick(['quick-delivery', 'campus-assistance', 'academic-help', 'technical-help']),
          reward,
          helper.id,
          minutesAgo(daysAgo * 1440),
        ],
      );

      const paymentId = randomUUID();
      await tx.query(
        `INSERT INTO payments (id, campus_id, request_id, payer_id, payee_id, amount_paise,
                               method, status, claimed_at, confirmed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'UPI_QR','PAYMENT_CONFIRMED',$7,$7,$7)`,
        [paymentId, campus.campusId, requestId, requester.id, helper.id, reward, minutesAgo(daysAgo * 1440)],
      );

      // Mostly excellent, occasionally middling — a believable spread.
      const helperStars = pick([5, 5, 5, 4, 4, 3]);
      const requesterStars = pick([5, 5, 4, 4]);
      await tx.query(
        `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars,
                              punctuality, reliability, communication, quality, review, created_at)
         VALUES ($1,$2,$3,$4,'REQUESTER_TO_HELPER',$5,$5,$5,$5,$5,$6,$7)`,
        [campus.campusId, requestId, requester.id, helper.id, helperStars, pick(REVIEWS.helper), minutesAgo(daysAgo * 1440)],
      );
      await tx.query(
        `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars,
                              clear_instructions, payment_reliability, respectfulness, communication, review, created_at)
         VALUES ($1,$2,$3,$4,'HELPER_TO_REQUESTER',$5,$5,$5,$5,$5,$6,$7)`,
        [campus.campusId, requestId, helper.id, requester.id, requesterStars, pick(REVIEWS.requester), minutesAgo(daysAgo * 1440)],
      );

      // The counters the triggers would normally maintain, applied for seeded history.
      await tx.query(
        'UPDATE users SET completed_tasks = completed_tasks + 1, selections_received = selections_received + 1, selections_responded = selections_responded + 1 WHERE id = $1',
        [helper.id],
      );
      await tx.query('UPDATE users SET total_earned_paise = total_earned_paise + $2 WHERE id = $1', [
        helper.id,
        reward,
      ]);
    }

    // A few cancellations, so completion rates are not all a flat 100%.
    for (let i = 0; i < 6; i += 1) {
      const student = students[randomInt(0, students.length - 1)];
      await tx.query('UPDATE users SET cancelled_tasks = cancelled_tasks + 1 WHERE id = $1', [student.id]);
    }
  });

  // Recompute reputation from the seeded counters.
  await db.query('SELECT refresh_user_reputation(id) FROM users');
  logger.info('Seeded transaction history and recomputed reputation');

  // ------------------------------------------------------------- marketplace
  await db.transaction(async (tx) => {
    for (const [index, listing] of LISTINGS.entries()) {
      const seller = students[(index * 3) % students.length];
      await tx.query(
        `INSERT INTO listings (campus_id, seller_id, title, description, category_slug,
                               listing_type, price_paise, condition, status, pickup_zone, created_at)
         VALUES ($1,$2,$3,$4,'marketplace',$5,$6,$7,'ACTIVE',$8,$9)`,
        [
          campus.campusId,
          seller.id,
          listing.title,
          listing.description,
          listing.type,
          rupeesToPaise(listing.priceRupees),
          listing.condition,
          listing.zone,
          minutesAgo(randomInt(60, 20 * 1440)),
        ],
      );
    }
  });
  logger.info(`Created ${LISTINGS.length} marketplace listings`);

  // ----------------------------------------------------------------- rentals
  const rentalItemIds: string[] = [];
  await db.transaction(async (tx) => {
    for (const [index, item] of RENTAL_ITEMS.entries()) {
      const owner = students[(index * 5 + 2) % students.length];
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO rental_items (campus_id, owner_id, name, description, category_slug,
                                   condition, price_paise, rental_unit, deposit_paise,
                                   status, pickup_zone, rules, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AVAILABLE',$10,$11,$12)
         RETURNING id`,
        [
          campus.campusId,
          owner.id,
          item.name,
          item.description,
          item.category,
          item.condition,
          rupeesToPaise(item.priceRupees),
          item.unit,
          rupeesToPaise(item.depositRupees),
          item.zone,
          item.rules ?? null,
          minutesAgo(randomInt(1440, 30 * 1440)),
        ],
      );
      rentalItemIds.push(rows[0].id);
    }
  });

  // One completed rental and one live rental, so both states are demonstrable.
  await db.transaction(async (tx) => {
    const { rows: items } = await tx.query<{ id: string; owner_id: string; price_paise: number; deposit_paise: number }>(
      'SELECT id, owner_id, price_paise, deposit_paise FROM rental_items WHERE campus_id = $1 ORDER BY created_at LIMIT 2',
      [campus.campusId],
    );

    for (const [index, item] of items.entries()) {
      const renter = students.find((s) => s.id !== item.owner_id);
      if (!renter) continue;
      const isCompleted = index === 0;

      await tx.query(
        `INSERT INTO rentals (campus_id, item_id, owner_id, renter_id, status, start_at,
                              expected_return_at, actual_return_at, units, rental_fee_paise,
                              deposit_paise, deposit_returned_paise, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,2,$9,$10,$11,$12)`,
        [
          campus.campusId,
          item.id,
          item.owner_id,
          renter.id,
          isCompleted ? 'COMPLETED' : 'RENTED',
          isCompleted ? minutesAgo(5 * 1440) : minutesAgo(1440),
          isCompleted ? minutesAgo(3 * 1440) : minutesAhead(1440),
          isCompleted ? minutesAgo(3 * 1440) : null,
          Number(item.price_paise) * 2,
          item.deposit_paise,
          isCompleted ? item.deposit_paise : null,
          isCompleted ? minutesAgo(6 * 1440) : minutesAgo(2 * 1440),
        ],
      );
    }
  });
  logger.info(`Created ${RENTAL_ITEMS.length} rental items and 2 rentals`);

  // ------------------------------------------------------ moderation examples
  await db.transaction(async (tx) => {
    const { rows: openRequests } = await tx.query<{ id: string; requester_id: string }>(
      `SELECT id, requester_id FROM requests WHERE campus_id = $1 AND status = 'OPEN' LIMIT 1`,
      [campus.campusId],
    );
    if (openRequests[0]) {
      const reporter = students.find((s) => s.id !== openRequests[0].requester_id);
      if (reporter) {
        await tx.query(
          `INSERT INTO reports (campus_id, reporter_id, target_type, target_id, reason, description)
           VALUES ($1,$2,'REQUEST',$3,'Suspicious request','The same request has been posted several times today.')`,
          [campus.campusId, reporter.id, openRequests[0].id],
        );
      }
    }

    // A request stuck in a dispute, waiting for a moderator.
    const disputedId = randomUUID();
    const requester = students[3];
    const helper = students[9];
    await tx.query(
      `INSERT INTO requests (id, campus_id, requester_id, title, description, category_slug,
                             reward_paise, product_cost_paise, status, selected_helper_id,
                             created_at, accepted_at, started_at, completed_at)
       VALUES ($1,$2,$3,'Deliver lunch to the library','Ordered lunch that never arrived.','quick-delivery',
               4000, 12000, 'DISPUTED', $4, $5, $5, $5, $5)`,
      [disputedId, campus.campusId, requester.id, helper.id, minutesAgo(600)],
    );
    await tx.query(
      `INSERT INTO disputes (campus_id, subject_type, subject_id, opened_by, against_id, reason, description)
       VALUES ($1,'REQUEST',$2,$3,$4,'Item never delivered',
               'I waited at the library for over an hour and nothing arrived. The chat went quiet.')`,
      [campus.campusId, disputedId, requester.id, helper.id],
    );
  });
  logger.info('Created a sample report and dispute for the admin panel');

  const summary = await db.query<{ table_name: string; count: string }>(`
    SELECT 'users' AS table_name, count(*)::text FROM users
    UNION ALL SELECT 'requests', count(*)::text FROM requests
    UNION ALL SELECT 'offers', count(*)::text FROM request_offers
    UNION ALL SELECT 'payments', count(*)::text FROM payments
    UNION ALL SELECT 'ratings', count(*)::text FROM ratings
    UNION ALL SELECT 'listings', count(*)::text FROM listings
    UNION ALL SELECT 'rental_items', count(*)::text FROM rental_items
    UNION ALL SELECT 'rentals', count(*)::text FROM rentals
  `);

  logger.info('Seed complete', Object.fromEntries(summary.rows.map((r) => [r.table_name, Number(r.count)])));

  const divider = '─'.repeat(66);
  console.log(`\n${divider}
  CampusBuddy demo data is ready.

  Sign in at http://localhost:5173 with any of these accounts:

    Student   aman.ug22.cs@${domain}      (helper with a strong record)
    Student   rahul.ug22.cs@${domain}     (requester)
    Student   ananya.ug21.cs@${domain}    (top-rated academic helper)
    Admin     admin@${domain}             (admin panel, http://localhost:5174)
    Moderator moderator@${domain}

  Password for every demo account:  ${env.SEED_PASSWORD}

  All names, phone numbers and UPI handles above are fictional.
${divider}\n`);

  await closeDatabase();
}

interface SeedRequestArgs {
  campusId: string;
  template: (typeof REQUESTS)[number];
  requester: CreatedUser;
  helper: CreatedUser;
  students: CreatedUser[];
  placeCoords: (label: string | undefined) => { lat: number; lng: number } | null;
}

/** Creates one request and drives it to the stage the template asks for. */
async function seedRequest(
  tx: Queryable,
  { campusId, template, requester, helper, students, placeCoords }: SeedRequestArgs,
): Promise<{ completed: boolean } | null> {
  const requestId = randomUUID();
  const reward = rupeesToPaise(template.rewardRupees);
  const productCost = rupeesToPaise(template.productCostRupees ?? 0);
  const pickup = placeCoords(template.pickup);
  const delivery = placeCoords(template.delivery);
  const origin = pickup ?? delivery;
  const createdAt = minutesAgo(randomInt(5, 300));

  const isExpired = template.outcome === 'EXPIRED';
  const deadline = template.deadlineMinutes
    ? isExpired
      ? minutesAgo(30)
      : minutesAhead(template.deadlineMinutes)
    : null;

  const statusByOutcome: Record<string, string> = {
    OPEN: 'OPEN',
    OFFERS: 'OFFERS_RECEIVED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    RATED: 'RATED',
    EXPIRED: 'EXPIRED',
  };
  const status = statusByOutcome[template.outcome];
  const hasHelper = ['IN_PROGRESS', 'COMPLETED', 'RATED'].includes(template.outcome);

  await tx.query(
    `INSERT INTO requests (id, campus_id, requester_id, title, description, category_slug, subcategory,
                           reward_paise, product_cost_paise, max_reward_paise, auto_escalate,
                           pickup_label, pickup_lat, pickup_lng, delivery_label, delivery_lat, delivery_lng,
                           exact_lat, exact_lng, approx_lat, approx_lng,
                           deadline_at, urgency, visibility, status, selected_helper_id,
                           created_at, accepted_at, started_at, completed_at, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'CAMPUS',$24,$25,$26,$27,$28,$29,$30)`,
    [
      requestId,
      campusId,
      requester.id,
      template.title,
      template.description,
      template.category,
      template.subcategory ?? null,
      reward,
      productCost,
      template.maxRewardRupees ? rupeesToPaise(template.maxRewardRupees) : null,
      template.autoEscalate ?? false,
      template.pickup ?? null,
      pickup?.lat ?? null,
      pickup?.lng ?? null,
      template.delivery ?? null,
      delivery?.lat ?? null,
      delivery?.lng ?? null,
      origin?.lat ?? null,
      origin?.lng ?? null,
      // Coarsened for the public feed, exactly as the API would store it.
      origin ? Math.round(origin.lat * 1000) / 1000 : null,
      origin ? Math.round(origin.lng * 1000) / 1000 : null,
      deadline,
      template.urgency ?? 'NORMAL',
      status,
      hasHelper ? helper.id : null,
      createdAt,
      hasHelper ? createdAt : null,
      hasHelper ? createdAt : null,
      ['COMPLETED', 'RATED'].includes(template.outcome) ? createdAt : null,
      template.outcome === 'RATED' ? createdAt : null,
    ],
  );

  await tx.query(
    `INSERT INTO request_status_history (request_id, from_status, to_status, action, actor_role, actor_id, created_at)
     VALUES ($1, NULL, 'OPEN', 'create', 'REQUESTER', $2, $3)`,
    [requestId, requester.id, createdAt],
  );

  // Offers, for anything that got as far as attracting interest.
  if (['OFFERS', 'IN_PROGRESS', 'COMPLETED', 'RATED'].includes(template.outcome)) {
    const bidders = new Set<string>();
    const count = template.outcome === 'OFFERS' ? randomInt(2, 4) : 1;
    for (let i = 0; i < count; i += 1) {
      const bidder = i === 0 && hasHelper ? helper : students[randomInt(0, students.length - 1)];
      if (bidder.id === requester.id || bidders.has(bidder.id)) continue;
      bidders.add(bidder.id);
      await tx.query(
        `INSERT INTO request_offers (campus_id, request_id, helper_id, offered_reward_paise,
                                     message, eta_minutes, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          campusId,
          requestId,
          bidder.id,
          // Some helpers accept the listed reward, others ask for a little more.
          i === 0 ? reward : reward + rupeesToPaise(pick([0, 5, 10, 20])),
          pick(['Can do this in 10 minutes.', 'I am heading that way anyway.', 'Happy to help!', null]),
          randomInt(5, 40),
          hasHelper && i === 0 ? 'ACCEPTED' : 'PENDING',
          new Date(createdAt.getTime() + 60_000 * (i + 1)),
        ],
      );
    }
  }

  // Payment and ratings for the finished ones.
  if (template.outcome === 'RATED') {
    const paymentId = randomUUID();
    await tx.query(
      `INSERT INTO payments (id, campus_id, request_id, payer_id, payee_id, amount_paise,
                             method, status, claimed_at, confirmed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'UPI_QR','PAYMENT_CONFIRMED',$7,$7,$7)`,
      [paymentId, campusId, requestId, requester.id, helper.id, reward + productCost, createdAt],
    );
    await tx.query(
      `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars,
                            punctuality, reliability, communication, quality, review, created_at)
       VALUES ($1,$2,$3,$4,'REQUESTER_TO_HELPER',5,5,5,5,5,$5,$6)`,
      [campusId, requestId, requester.id, helper.id, pick(REVIEWS.helper), createdAt],
    );
    await tx.query(
      `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars,
                            clear_instructions, payment_reliability, respectfulness, communication, review, created_at)
       VALUES ($1,$2,$3,$4,'HELPER_TO_REQUESTER',5,5,5,5,5,$5,$6)`,
      [campusId, requestId, helper.id, requester.id, pick(REVIEWS.requester), createdAt],
    );
  }

  // An open conversation for anything with a committed helper.
  if (hasHelper) {
    const conversationId = randomUUID();
    await tx.query(
      'INSERT INTO conversations (id, campus_id, request_id, subject, created_at) VALUES ($1,$2,$3,$4,$5)',
      [conversationId, campusId, requestId, template.title, createdAt],
    );
    for (const participant of [requester.id, helper.id]) {
      await tx.query(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1,$2)',
        [conversationId, participant],
      );
    }
    await tx.query(
      `INSERT INTO messages (campus_id, conversation_id, sender_id, body, created_at)
       VALUES ($1,$2,$3,$4,$5), ($1,$2,$6,$7,$8)`,
      [
        campusId,
        conversationId,
        requester.id,
        'Hi! Thanks for taking this up.',
        new Date(createdAt.getTime() + 120_000),
        helper.id,
        'On my way now, will update you shortly.',
        new Date(createdAt.getTime() + 240_000),
      ],
    );
  }

  return { completed: template.outcome === 'RATED' };
}

try {
  await main();
} catch (error) {
  logger.error('Seed failed', { message: (error as Error).message, stack: (error as Error).stack });
  await closeDatabase();
  process.exit(1);
}
