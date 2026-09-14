import { logger } from '../config/logger.js';
import type { Database, Queryable } from '../db/client.js';
import type { AuthenticatedUser } from './context.js';
import { asUser } from './context.js';

/**
 * Deferred side effects.
 *
 * Realtime frames and push notifications must only go out once the transaction that
 * caused them has actually committed. Handlers register their pushes here instead of
 * firing inline, so a rolled-back request never tells a student that something
 * happened when it did not.
 */
export class Outbox {
  private readonly effects: Array<() => void> = [];

  add(effect: () => void): void {
    this.effects.push(effect);
  }

  /** Runs every queued effect. One failing effect never stops the others. */
  flush(): void {
    for (const effect of this.effects) {
      try {
        effect();
      } catch (error) {
        logger.warn('Deferred side effect failed', { message: (error as Error).message });
      }
    }
    this.effects.length = 0;
  }

  discard(): void {
    this.effects.length = 0;
  }
}

/**
 * Runs `fn` in an RLS-bound transaction with an outbox, flushing the outbox only if
 * the transaction commits.
 */
export async function withUserTx<T>(
  db: Database,
  user: AuthenticatedUser,
  fn: (tx: Queryable, outbox: Outbox) => Promise<T>,
): Promise<T> {
  const outbox = new Outbox();
  try {
    const result = await asUser(db, user, (tx) => fn(tx, outbox));
    outbox.flush();
    return result;
  } catch (error) {
    outbox.discard();
    throw error;
  }
}

/** The same pattern for trusted server-side work that bypasses RLS. */
export async function withServiceTx<T>(
  db: Database,
  fn: (tx: Queryable, outbox: Outbox) => Promise<T>,
): Promise<T> {
  const outbox = new Outbox();
  try {
    const result = await db.transaction((tx) => fn(tx, outbox));
    outbox.flush();
    return result;
  } catch (error) {
    outbox.discard();
    throw error;
  }
}
