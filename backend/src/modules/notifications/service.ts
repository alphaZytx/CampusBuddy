import { randomUUID } from 'node:crypto';
import type { DomainEvent } from '@campusbuddy/shared';
import type { Queryable } from '../../db/client.js';
import { logger } from '../../config/logger.js';
import { campusHour } from '../../core/campus-time.js';
import { publishToUser } from '../../realtime/hub.js';
import type { Outbox } from '../../core/outbox.js';

/**
 * Notification service (spec §71).
 *
 * One place creates notifications, so the rules — preferences, quiet hours, never
 * notifying yourself — live in a single file instead of being re-implemented in
 * every route. Each notification is persisted (so it survives being offline) and
 * simultaneously pushed over the realtime channel.
 */

export type PreferenceKey =
  | 'new_matching_requests'
  | 'offers'
  | 'chat'
  | 'payments'
  | 'ratings'
  | 'rentals'
  | 'reminders'
  | 'lost_found';

export interface NotificationInput {
  userId: string;
  campusId: string;
  type: DomainEvent;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  /** Which preference toggle governs this notification. */
  preference?: PreferenceKey;
  /** Bypass quiet hours for time-critical events such as a helper being selected. */
  important?: boolean;
  /** Actor who caused it, used to honour mute controls. */
  actorId?: string;
}

interface PreferenceRow {
  enabled: boolean | null;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
}

/** Savepoint names must be unique within a transaction. */
let savepointCounter = 0;

/** True when `hour` falls inside a quiet-hours window, including windows crossing midnight. */
export function isWithinQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

async function shouldNotify(
  tx: Queryable,
  userId: string,
  preference: PreferenceKey | undefined,
  important: boolean,
  actorId?: string,
): Promise<boolean> {
  if (actorId) {
    const muted = await tx.query<{ muted: boolean }>('SELECT app_user_muted($1, $2) AS muted', [userId, actorId]);
    if (muted.rows[0]?.muted) return false;
  }
  if (!preference) return true;

  // Read through a narrow SECURITY DEFINER function (migration 015). The recipient's
  // preferences are private, so RLS hides them from the student whose action caused
  // this notification; a plain SELECT would find nothing and assume "all on".
  const { rows } = await tx.query<PreferenceRow>(
    'SELECT enabled, quiet_hours_start, quiet_hours_end FROM app_notification_preference($1, $2)',
    [userId, preference],
  );
  const prefs = rows[0];
  // No preference row yet means defaults, which are all on.
  if (!prefs) return true;
  if (prefs.enabled === false) return false;
  if (important) return true;

  // Quiet hours are set on the student's clock, not the server's.
  return !isWithinQuietHours(campusHour(), prefs.quiet_hours_start, prefs.quiet_hours_end);
}

/**
 * Creates one notification. Returns the row id, or null when preferences suppressed
 * it.
 *
 * The whole insert runs inside a SAVEPOINT. A notification problem must not roll back
 * the business action that triggered it — but simply catching the error is not enough,
 * because a failed statement leaves the surrounding PostgreSQL transaction in an
 * aborted state, and the eventual COMMIT would then silently become a ROLLBACK.
 * Rolling back to the savepoint is what actually contains the failure.
 */
export async function notify(
  tx: Queryable,
  input: NotificationInput,
  outbox?: Outbox,
): Promise<string | null> {
  const savepoint = `notify_sp_${(savepointCounter += 1)}`;
  await tx.exec(`SAVEPOINT ${savepoint}`);

  try {
    if (!(await shouldNotify(tx, input.userId, input.preference, input.important ?? false, input.actorId))) {
      await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return null;
    }

    // No RETURNING clause: PostgreSQL applies the SELECT policy to returned rows,
    // and a notification belongs to the *recipient*, who is not the author. The id
    // and timestamp are therefore generated here instead.
    const notificationId = randomUUID();
    const createdAt = new Date();
    await tx.query(
      `INSERT INTO notifications (id, campus_id, user_id, type, title, body, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        notificationId,
        input.campusId,
        input.userId,
        input.type,
        input.title,
        input.body ?? '',
        JSON.stringify(input.data ?? {}),
        createdAt,
      ],
    );
    await tx.query(
      `INSERT INTO durable_outbox (topic, aggregate_id, payload)
       VALUES ('PUSH_NOTIFICATION', $1, $2)`,
      [
        notificationId,
        JSON.stringify({
          userId: input.userId,
          notificationId,
          title: input.title,
          body: input.body ?? '',
          data: input.data ?? {},
        }),
      ],
    );
    await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);

    const frame = {
      id: notificationId,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      data: input.data ?? {},
      readAt: null,
      createdAt: createdAt.toISOString(),
    };
    // Deferred until the surrounding transaction commits, so a rolled-back action
    // never reaches a student's screen.
    if (outbox) outbox.add(() => publishToUser(input.userId, input.type, frame));
    else publishToUser(input.userId, input.type, frame);

    return notificationId;
  } catch (error) {
    // Undo just the notification, leaving the caller's transaction usable.
    await tx.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
    logger.error('Failed to create notification', {
      userId: input.userId,
      type: input.type,
      message: (error as Error).message,
    });
    return null;
  }
}

/** Notify several students at once, skipping `exceptUserId` (usually the actor). */
export async function notifyMany(
  tx: Queryable,
  userIds: readonly string[],
  input: Omit<NotificationInput, 'userId'> & { exceptUserId?: string },
  outbox?: Outbox,
): Promise<void> {
  const targets = [...new Set(userIds)].filter((id) => id !== input.exceptUserId);
  for (const userId of targets) {
    await notify(tx, { ...input, userId }, outbox);
  }
}
