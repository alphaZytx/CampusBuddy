import { formatINR } from '@campusbuddy/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { Database } from '../db/client.js';
import { formatCampusTime } from '../core/campus-time.js';
import { withServiceTx } from '../core/outbox.js';
import { pruneRateLimitEvents } from '../core/rate-limit.js';
import { notify } from '../modules/notifications/service.js';
import {
  announceRequest,
  applyTransition,
  closeOutstandingOffers,
  lockRequest,
} from '../modules/requests/service.js';
import { campusChannel, publish, requestChannel } from '../realtime/hub.js';
import { processDurableOutbox } from './durable.js';
import { deleteAttachment } from '../modules/uploads/storage.js';

/**
 * Background jobs.
 *
 * Time-driven parts of the domain — expiry, automatic reward escalation, scheduled
 * requests and return reminders — run here rather than being triggered by whichever
 * user happens to open the app next. Everything runs in the service context, and
 * status changes still go through the same state machine as user actions.
 */

let timer: NodeJS.Timeout | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
let running = false;

/** Requests whose deadline has passed and which never found a helper. */
export async function expireRequests(db: Database): Promise<number> {
  const { rows } = await db.query<{ id: string; requester_id: string; title: string; campus_id: string }>(
    `SELECT id, requester_id, title, campus_id FROM requests
      WHERE deadline_at IS NOT NULL AND deadline_at <= now()
        AND status IN ('OPEN','OFFERS_RECEIVED','HELPER_SELECTED')
      LIMIT 200`,
  );

  let expired = 0;
  for (const row of rows) {
    try {
      await withServiceTx(db, async (tx, outbox) => {
        const locked = await lockRequest(tx, row.id);
        // Re-check under the lock: a helper may have been selected in the meantime.
        if (!['OPEN', 'OFFERS_RECEIVED', 'HELPER_SELECTED'].includes(locked.status)) return;

        await applyTransition(tx, locked, 'EXPIRED', 'expire', 'SYSTEM', null, {
          note: 'Deadline passed',
        });
        await closeOutstandingOffers(tx, row.id, null, 'EXPIRED');

        await notify(
          tx,
          {
            userId: row.requester_id,
            campusId: row.campus_id,
            type: 'REQUEST_EXPIRED',
            title: 'Request expired',
            body: `"${row.title}" passed its deadline without a helper.`,
            data: { requestId: row.id },
            preference: 'reminders',
          },
          outbox,
        );
        outbox.add(() => publish(requestChannel(row.id), 'REQUEST_EXPIRED', { requestId: row.id }));
        expired += 1;
      });
    } catch (error) {
      logger.error('Failed to expire request', { requestId: row.id, message: (error as Error).message });
    }
  }
  return expired;
}

/**
 * Automatic reward escalation (spec §22).
 *
 * Only for requests the requester explicitly opted into, only up to the ceiling they
 * set, and only while the request is still open — so the terms can never change
 * under a helper who has already committed. A scheduled request is left alone until
 * it has gone live: raising the reward of a request nobody can see yet would only
 * spend the requester's money.
 */
export async function escalateRewards(db: Database): Promise<number> {
  const { rows } = await db.query<{
    id: string;
    campus_id: string;
    title: string;
    reward_paise: number;
    max_reward_paise: number;
  }>(
    `SELECT id, campus_id, title, reward_paise, max_reward_paise FROM requests
      WHERE auto_escalate = true
        AND status IN ('OPEN','OFFERS_RECEIVED')
        AND scheduled_for IS NULL
        AND max_reward_paise IS NOT NULL
        AND reward_paise < max_reward_paise
        AND COALESCE(last_escalated_at, created_at) <= now() - ($1 || ' minutes')::interval
      LIMIT 100`,
    [String(env.AUTO_ESCALATION_INTERVAL_MINUTES)],
  );

  let escalated = 0;
  for (const row of rows) {
    try {
      await withServiceTx(db, async (tx, outbox) => {
        const locked = await lockRequest(tx, row.id);
        if (!['OPEN', 'OFFERS_RECEIVED'].includes(locked.status)) return;
        if (locked.max_reward_paise === null || locked.reward_paise >= locked.max_reward_paise) return;

        const step = Math.max(
          100,
          Math.round((locked.reward_paise * env.AUTO_ESCALATION_STEP_PERCENT) / 100),
        );
        // Never overshoot the ceiling the requester chose.
        const next = Math.min(locked.reward_paise + step, locked.max_reward_paise);
        if (next <= locked.reward_paise) return;

        await tx.query(
          'UPDATE requests SET reward_paise = $2, last_escalated_at = now() WHERE id = $1',
          [row.id, next],
        );
        await tx.query(
          `INSERT INTO request_reward_history (request_id, from_paise, to_paise, reason)
           VALUES ($1, $2, $3, 'AUTO_ESCALATION')`,
          [row.id, locked.reward_paise, next],
        );

        const { rows: interested } = await tx.query<{ helper_id: string }>(
          `SELECT helper_id FROM request_offers WHERE request_id = $1 AND status = 'PENDING'`,
          [row.id],
        );
        for (const helper of interested) {
          await notify(
            tx,
            {
              userId: helper.helper_id,
              campusId: row.campus_id,
              type: 'REWARD_CHANGED',
              title: 'Reward increased automatically',
              body: `"${row.title}" now pays ${formatINR(next)}.`,
              data: { requestId: row.id, rewardPaise: next },
              preference: 'offers',
            },
            outbox,
          );
        }

        outbox.add(() => {
          publish(requestChannel(row.id), 'REWARD_CHANGED', {
            requestId: row.id,
            fromPaise: locked.reward_paise,
            toPaise: next,
          });
          publish(campusChannel(row.campus_id), 'REWARD_CHANGED', { requestId: row.id, toPaise: next });
        });
        escalated += 1;
      });
    } catch (error) {
      logger.error('Failed to escalate reward', { requestId: row.id, message: (error as Error).message });
    }
  }
  return escalated;
}

/** Scheduled requests become visible and notify helpers when their time arrives (spec §50). */
export async function activateScheduledRequests(db: Database): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM requests
      WHERE scheduled_for IS NOT NULL AND scheduled_for <= now()
        AND status IN ('OPEN','OFFERS_RECEIVED')
      LIMIT 100`,
  );

  let activated = 0;
  for (const row of rows) {
    try {
      await withServiceTx(db, async (tx, outbox) => {
        // Clearing scheduled_for is what makes this idempotent — a request is only
        // ever announced once. Restarting the escalation clock means automatic reward
        // increases count from the moment helpers could first see the request.
        const { rowCount } = await tx.query(
          `UPDATE requests SET scheduled_for = NULL, last_escalated_at = now()
            WHERE id = $1 AND scheduled_for IS NOT NULL AND scheduled_for <= now()`,
          [row.id],
        );
        if (rowCount === 0) return;

        await announceRequest(tx, outbox, row.id);
        activated += 1;
      });
    } catch (error) {
      logger.error('Failed to activate scheduled request', {
        requestId: row.id,
        message: (error as Error).message,
      });
    }
  }
  return activated;
}

/** Reminds renters a couple of hours before an item is due back (spec §32). */
export async function sendRentalReminders(db: Database): Promise<number> {
  const { rows } = await db.query<{
    id: string;
    campus_id: string;
    renter_id: string;
    item_name: string;
    expected_return_at: Date;
  }>(
    `SELECT r.id, r.campus_id, r.renter_id, i.name AS item_name, r.expected_return_at
       FROM rentals r JOIN rental_items i ON i.id = r.item_id
      WHERE r.status = 'RENTED'
        AND r.expected_return_at BETWEEN now() AND now() + interval '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.user_id = r.renter_id
             AND n.type = 'RENTAL_RETURNED'
             AND n.data->>'rentalId' = r.id::text
             AND n.created_at > now() - interval '6 hours'
        )
      LIMIT 100`,
  );

  let sent = 0;
  for (const row of rows) {
    try {
      await withServiceTx(db, async (tx, outbox) => {
        await notify(
          tx,
          {
            userId: row.renter_id,
            campusId: row.campus_id,
            type: 'RENTAL_RETURNED',
            title: 'Return due soon',
            // In campus time: a UTC server would otherwise tell a student a time
            // five and a half hours out.
            body: `The ${row.item_name} is due back at ${formatCampusTime(new Date(row.expected_return_at))}.`,
            data: { rentalId: row.id },
            preference: 'reminders',
          },
          outbox,
        );
        sent += 1;
      });
    } catch (error) {
      logger.error('Failed to send a return reminder', {
        rentalId: row.id,
        message: (error as Error).message,
      });
    }
  }
  return sent;
}

/** Availability windows lapse on their own so nobody is marked available forever. */
export async function lapseAvailability(db: Database): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE user_preferences
        SET availability = 'BUSY', available_until = NULL
      WHERE available_until IS NOT NULL AND available_until <= now()
        AND availability <> 'BUSY'`,
  );
  return rowCount;
}

/** Remind both sides before a payment window closes, then flag it as expired. */
export async function processPaymentDeadlines(db: Database): Promise<number> {
  const { rows } = await db.query<{
    id: string; campus_id: string; payer_id: string; payee_id: string; amount_paise: string;
    expires_at: Date; reminder_sent_at: Date | null; expiry_notified_at: Date | null;
  }>(
    `SELECT id, campus_id, payer_id, payee_id, amount_paise, expires_at,
            reminder_sent_at, expiry_notified_at
       FROM payments
      WHERE status IN ('PAYMENT_PENDING','PAYMENT_INITIATED','PAYMENT_CLAIMED')
        AND (reminder_sent_at IS NULL OR expiry_notified_at IS NULL)
      ORDER BY expires_at LIMIT 200`,
  );
  let handled = 0;
  for (const row of rows) {
    const expired = new Date(row.expires_at).getTime() <= Date.now();
    const dueSoon = new Date(row.expires_at).getTime() <= Date.now() + 24 * 60 * 60_000;
    if ((!expired && !dueSoon) || (expired ? row.expiry_notified_at : row.reminder_sent_at)) continue;
    await withServiceTx(db, async (tx, outbox) => {
      const title = expired ? 'Payment window expired' : 'Payment due soon';
      const body = expired
        ? `The ${formatINR(Number(row.amount_paise))} payment window expired. Open a dispute if money is still unresolved.`
        : `${formatINR(Number(row.amount_paise))} is still awaiting confirmation and is due within 24 hours.`;
      for (const userId of [row.payer_id, row.payee_id]) {
        await notify(tx, {
          userId,
          campusId: row.campus_id,
          type: 'PAYMENT_UPDATED',
          title,
          body,
          data: { paymentId: row.id },
          preference: 'reminders',
          important: expired,
        }, outbox);
      }
      await tx.query(
        `UPDATE payments SET ${expired ? 'expiry_notified_at' : 'reminder_sent_at'} = now() WHERE id = $1`,
        [row.id],
      );
      handled += 1;
    });
  }
  return handled;
}

/** Create reviewable risk signals without automatically punishing a student. */
export async function detectAbuseSignals(db: Database): Promise<number> {
  const { rows } = await db.query<{ user_id: string; campus_id: string; signal_type: string; score: number; count: string }>(
    `SELECT requester_id AS user_id, campus_id, 'REPEATED_CANCELLATIONS' AS signal_type,
            least(100, count(*)::integer * 10) AS score, count(*)::text AS count
       FROM requests
      WHERE status = 'CANCELLED' AND updated_at > now() - interval '7 days'
      GROUP BY requester_id, campus_id HAVING count(*) >= 3
     UNION ALL
     SELECT reporter_id, campus_id, 'REPORT_BURST', least(100, count(*)::integer * 15), count(*)::text
       FROM reports
      WHERE reporter_id IS NOT NULL AND created_at > now() - interval '24 hours'
      GROUP BY reporter_id, campus_id HAVING count(*) >= 4
     UNION ALL
     SELECT requester_id, campus_id, 'RAPID_REQUEST_POSTING', least(100, count(*)::integer * 12), count(*)::text
       FROM requests WHERE created_at > now() - interval '1 hour'
      GROUP BY requester_id, campus_id HAVING count(*) >= 5
     UNION ALL
     SELECT o.helper_id, r.campus_id, 'OFFER_SPAM', least(100, count(*)::integer * 6), count(*)::text
       FROM request_offers o JOIN requests r ON r.id = o.request_id
      WHERE o.created_at > now() - interval '1 hour'
      GROUP BY o.helper_id, r.campus_id HAVING count(*) >= 10`,
  );
  let created = 0;
  for (const row of rows) {
    const result = await db.query(
      `INSERT INTO abuse_signals (campus_id, user_id, signal_type, score, details)
       SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (
         SELECT 1 FROM abuse_signals WHERE user_id = $2 AND signal_type = $3
           AND detected_at > now() - interval '24 hours')`,
      [row.campus_id, row.user_id, row.signal_type, row.score, JSON.stringify({ count: Number(row.count), window: '24h' })],
    );
    created += result.rowCount;
  }
  await db.query(`UPDATE reports SET status = 'ESCALATED', escalated_at = now()
    WHERE status IN ('OPEN','UNDER_REVIEW') AND sla_due_at <= now()`);
  await db.query(`UPDATE disputes SET escalated_at = now()
    WHERE status IN ('OPEN','UNDER_REVIEW') AND sla_due_at <= now() AND escalated_at IS NULL`);
  return created;
}

/** Apply the published retention schedule and remove unreferenced media objects. */
export async function pruneRetainedData(db: Database): Promise<number> {
  let removed = 0;
  const statements: Array<[string, unknown[]]> = [
    [`UPDATE user_preferences SET last_lat = NULL, last_lng = NULL, last_location_at = NULL
       WHERE last_location_at < now() - ($1 || ' days')::interval`, [String(env.LOCATION_RETENTION_DAYS)]],
    [`DELETE FROM notifications WHERE created_at < now() - ($1 || ' days')::interval`, [String(env.NOTIFICATION_RETENTION_DAYS)]],
    [`DELETE FROM messages m WHERE m.created_at < now() - ($1 || ' days')::interval
       AND EXISTS (SELECT 1 FROM conversations c
         LEFT JOIN requests r ON r.id = c.request_id
         LEFT JOIN rentals rt ON rt.id = c.rental_id
        WHERE c.id = m.conversation_id
          AND (r.status IN ('CANCELLED','EXPIRED','PAID','RATED') OR rt.status IN ('COMPLETED','CANCELLED')))`,
      [String(env.CHAT_RETENTION_DAYS)]],
    [`DELETE FROM reports WHERE status IN ('RESOLVED','DISMISSED')
       AND updated_at < now() - ($1 || ' days')::interval`, [String(env.SAFETY_RETENTION_DAYS)]],
    [`DELETE FROM disputes WHERE status NOT IN ('OPEN','UNDER_REVIEW')
       AND updated_at < now() - ($1 || ' days')::interval`, [String(env.SAFETY_RETENTION_DAYS)]],
    [`DELETE FROM lost_found_posts WHERE status IN ('RETURNED','CLOSED','EXPIRED')
       AND updated_at < now() - interval '365 days'`, []],
    [`DELETE FROM idempotency_keys WHERE expires_at < now()`, []],
    [`DELETE FROM durable_outbox WHERE processed_at < now() - interval '30 days'`, []],
  ];
  for (const [sql, params] of statements) {
    const result = await db.query(sql, params);
    removed += result.rowCount;
  }

  const orphaned = await db.query<{ id: string }>(
    `SELECT a.id FROM attachments a
      WHERE a.created_at < now() - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_attachment_id = a.id OR u.upi_qr_attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM request_attachments x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM requests x WHERE x.completion_proof_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM listing_images x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM rental_item_images x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM lost_found_images x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM dispute_evidence x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM report_evidence x WHERE x.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.receipt_attachment_id = a.id)
      LIMIT 500`,
  );
  for (const attachment of orphaned.rows) {
    await deleteAttachment(db, attachment.id);
    removed += 1;
  }
  return removed;
}

/** One pass of every periodic job. Exported so tests can run it deterministically. */
export async function runJobsOnce(db: Database): Promise<Record<string, number>> {
  const [expired, escalated, activated, reminders, lapsed, payments, abuse, lostFoundExpired, delivered] = await Promise.all([
    expireRequests(db),
    escalateRewards(db),
    activateScheduledRequests(db),
    sendRentalReminders(db),
    lapseAvailability(db),
    processPaymentDeadlines(db),
    detectAbuseSignals(db),
    expireLostFoundPosts(db),
    processDurableOutbox(db),
  ]);
  return { expired, escalated, activated, reminders, lapsed, payments, abuse, lostFoundExpired, delivered };
}

/** Close stale Lost & Found posts and remind their authors. */
export async function expireLostFoundPosts(db: Database): Promise<number> {
  return withServiceTx(db, async (tx, outbox) => {
    const { rows } = await tx.query<{id:string;author_id:string;campus_id:string;title:string}>(
      `UPDATE lost_found_posts SET status='EXPIRED'
        WHERE status IN ('OPEN','MATCHED') AND expires_at<=now()
        RETURNING id,author_id,campus_id,title`,
    );
    for (const row of rows) await notify(tx, {
      userId: row.author_id, campusId: row.campus_id, type: 'LOST_FOUND_EXPIRED',
      title: 'Lost & Found post expired', body: `“${row.title}” expired after 60 days. You can reopen it.`,
      data: { lostFoundId: row.id, path: `/lost-found/${row.id}` }, preference: 'lost_found',
    }, outbox);
    return rows.length;
  });
}

export function startJobs(db: Database): void {
  if (timer) return;

  const tick = async (): Promise<void> => {
    // Skip rather than pile up if a previous pass is still going.
    if (running) return;
    running = true;
    try {
      const result = await runJobsOnce(db);
      const total = Object.values(result).reduce((sum, value) => sum + value, 0);
      if (total > 0) logger.info('Background jobs completed work', result);
    } catch (error) {
      logger.error('Background job pass failed', { message: (error as Error).message });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void tick(), env.JOB_INTERVAL_SECONDS * 1000);
  timer.unref?.();
  logger.info(`Background jobs running every ${env.JOB_INTERVAL_SECONDS}s`);

  // Hourly housekeeping of operational and privacy-limited data.
  cleanupTimer = setInterval(
    () => void Promise.all([pruneRateLimitEvents(db), pruneRetainedData(db)]).catch((error: Error) =>
      logger.error('Housekeeping failed', { message: error.message }),
    ),
    60 * 60 * 1000,
  );
  cleanupTimer.unref?.();
}

export function stopJobs(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
