import type { Database } from '../db/client.js';
import { logger } from '../config/logger.js';
import { sendPush } from '../core/push.js';

interface OutboxRow {
  id: number;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Claim and deliver durable side effects. SKIP LOCKED allows several workers safely. */
export async function processDurableOutbox(db: Database, limit = 50): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const { rows } = await tx.query<OutboxRow>(
      `SELECT id, topic, payload, attempts, max_attempts FROM durable_outbox
        WHERE processed_at IS NULL AND failed_at IS NULL AND available_at <= now()
          AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const row of rows) {
      await tx.query('UPDATE durable_outbox SET locked_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
    }
    return rows;
  });

  let processed = 0;
  for (const row of claimed) {
    try {
      if (row.topic === 'PUSH_NOTIFICATION') {
        await sendPush(db, row.payload as unknown as Parameters<typeof sendPush>[1]);
      }
      await db.query('UPDATE durable_outbox SET processed_at = now(), locked_at = NULL WHERE id = $1', [row.id]);
      processed += 1;
    } catch (error) {
      const nextAttempt = row.attempts + 1;
      const exhausted = nextAttempt >= row.max_attempts;
      const delaySeconds = Math.min(3600, 2 ** Math.min(nextAttempt, 10));
      await db.query(
        `UPDATE durable_outbox SET locked_at = NULL, last_error = $2,
          available_at = now() + ($3 || ' seconds')::interval,
          failed_at = CASE WHEN $4 THEN now() ELSE NULL END WHERE id = $1`,
        [row.id, (error as Error).message.slice(0, 1000), String(delaySeconds), exhausted],
      );
      logger.warn('Durable outbox delivery failed', { id: row.id, topic: row.topic, message: (error as Error).message });
    }
  }
  return processed;
}
