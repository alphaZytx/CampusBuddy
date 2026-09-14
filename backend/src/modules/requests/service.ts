import { randomUUID } from 'node:crypto';
import type { CreateRequestInput, HelpRequest, RequestStatus } from '@campusbuddy/shared';
import {
  assertRequestTransition,
  formatINR,
  fuzzCoordinate,
  OFFERABLE_REQUEST_STATUSES,
  type Actor,
} from '@campusbuddy/shared';
import { env } from '../../config/env.js';
import type { Queryable } from '../../db/client.js';
import { ApiError } from '../../core/errors.js';
import type { AuthenticatedUser } from '../../core/context.js';
import type { Outbox } from '../../core/outbox.js';
import { campusChannel, publish } from '../../realtime/hub.js';
import { notify } from '../notifications/service.js';
import { REQUEST_SELECT } from './sql.js';
import { toHelpRequest, type RequestRow } from './serializer.js';

/**
 * Request lifecycle.
 *
 * Every status change in the application funnels through `applyTransition`, which
 * consults the shared state machine before writing. That is what makes it impossible
 * for a client to invent a status, skip a step, or act on someone else's behalf
 * (spec §26, §95).
 */

export interface ViewerContext {
  user: AuthenticatedUser;
  lat: number | null;
  lng: number | null;
}

const isStaffRole = (user: AuthenticatedUser): boolean =>
  user.role === 'MODERATOR' || user.role === 'CAMPUS_ADMIN' || user.role === 'PLATFORM_ADMIN';

/** Loads one request through the RLS-bound projection, or 404s. */
export async function loadRequest(
  tx: Queryable,
  requestId: string,
  viewer: ViewerContext,
): Promise<HelpRequest> {
  const { rows } = await tx.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $4::uuid`, [
    viewer.user.id,
    viewer.lat,
    viewer.lng,
    requestId,
  ]);
  const row = rows[0];
  // RLS makes "not visible to you" and "does not exist" the same thing, on purpose:
  // a 404 leaks nothing about requests the viewer may not see.
  if (!row) throw ApiError.notFound('That request is not available.');
  return toHelpRequest(row, viewer.user.id, { isStaff: isStaffRole(viewer.user) });
}

interface LockedRequest {
  id: string;
  campus_id: string;
  status: RequestStatus;
  requester_id: string;
  selected_helper_id: string | null;
  selected_offer_id: string | null;
  reward_paise: number;
  product_cost_paise: number;
  max_reward_paise: number | null;
  deadline_at: Date | null;
  title: string;
}

/**
 * Reads a request `FOR UPDATE`, so concurrent lifecycle changes serialise instead of
 * racing (spec §25, §27). Always call this inside the same transaction as the write.
 */
export async function lockRequest(tx: Queryable, requestId: string): Promise<LockedRequest> {
  const { rows } = await tx.query<LockedRequest>(
    `SELECT id, campus_id, status, requester_id, selected_helper_id, selected_offer_id,
            reward_paise, product_cost_paise, max_reward_paise, deadline_at, title
       FROM requests WHERE id = $1 FOR UPDATE`,
    [requestId],
  );
  const row = rows[0];
  if (!row) throw ApiError.notFound('That request is not available.');
  return row;
}

/** Determines the caller's role on a request. Never taken from the client. */
export function actorOn(request: LockedRequest, user: AuthenticatedUser): Actor {
  if (request.requester_id === user.id) return 'REQUESTER';
  if (request.selected_helper_id === user.id) return 'HELPER';
  if (isStaffRole(user)) return 'ADMIN';
  throw ApiError.forbidden('You are not part of this request.');
}

export interface TransitionOptions {
  note?: string | null;
  /** Extra columns to write in the same UPDATE as the status change. */
  patch?: Record<string, unknown>;
}

/**
 * The single writer for `requests.status`.
 *
 * Validates the move against the state machine, applies it atomically, and appends
 * to the immutable history. A caller cannot bypass it, because nothing else in the
 * codebase updates the status column.
 */
export async function applyTransition(
  tx: Queryable,
  request: LockedRequest,
  to: RequestStatus,
  action: string,
  actor: Actor,
  actorId: string | null,
  options: TransitionOptions = {},
): Promise<void> {
  const transition = assertRequestTransition(request.status, to, actor);
  if (transition.action !== action) {
    throw ApiError.badRequest(
      `"${action}" is not the right action for that change; expected "${transition.action}".`,
    );
  }

  // The history row is written first, while the actor is still a party to the
  // request. Some transitions end that involvement — a helper withdrawing clears
  // selected_helper_id — and the history policy only accepts rows from a party.
  await tx.query(
    `INSERT INTO request_status_history (request_id, from_status, to_status, action, actor_role, actor_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [request.id, request.status, to, action, actor, actorId, options.note ?? null],
  );

  const patch = { ...(options.patch ?? {}) };
  const columns = Object.keys(patch);
  const assignments = columns.map((column, index) => `${column} = $${index + 3}`);
  const values = columns.map((column) => patch[column]);

  await tx.query(
    `UPDATE requests SET status = $2${assignments.length > 0 ? `, ${assignments.join(', ')}` : ''}
      WHERE id = $1`,
    [request.id, to, ...values],
  );
}

/** Creates a request. The campus and requester are derived from the session. */
export async function createRequest(
  tx: Queryable,
  user: AuthenticatedUser,
  input: CreateRequestInput,
  profile: { hostelId: string | null; departmentId: string | null; yearOfStudy: number | null },
): Promise<string> {
  // Anti-spam ceiling on simultaneously open requests (spec §63).
  const { rows: openRows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM requests
      WHERE requester_id = $1 AND status IN ('OPEN','OFFERS_RECEIVED','HELPER_SELECTED')`,
    [user.id],
  );
  if (Number(openRows[0]?.count ?? 0) >= env.MAX_OPEN_REQUESTS_PER_USER) {
    throw ApiError.conflict(
      `You already have ${env.MAX_OPEN_REQUESTS_PER_USER} open requests. Close one before posting another.`,
      'TOO_MANY_OPEN_REQUESTS',
    );
  }

  if (input.deadlineAt && new Date(input.deadlineAt).getTime() <= Date.now()) {
    throw ApiError.badRequest('The deadline must be in the future.');
  }
  // A "scheduled" time that has already passed simply means "now".
  const scheduledFor =
    input.scheduledFor && new Date(input.scheduledFor).getTime() > Date.now()
      ? input.scheduledFor
      : null;

  // Restricted visibility is pinned to the requester's *current* groups, so editing a
  // profile later cannot retroactively widen who could see an old request.
  const visibilityHostelId = input.visibility === 'HOSTEL' ? profile.hostelId : null;
  const visibilityDepartmentId = input.visibility === 'DEPARTMENT' ? profile.departmentId : null;
  const visibilityYear = input.visibility === 'YEAR' ? profile.yearOfStudy : null;

  if (input.visibility === 'HOSTEL' && !visibilityHostelId) {
    throw ApiError.badRequest('Add your hostel to your profile before posting to it.');
  }
  if (input.visibility === 'DEPARTMENT' && !visibilityDepartmentId) {
    throw ApiError.badRequest('Add your department to your profile before posting to it.');
  }
  if (input.visibility === 'YEAR' && visibilityYear === null) {
    throw ApiError.badRequest('Add your year of study to your profile before posting to it.');
  }

  const invitedHelperIds = [...new Set(input.invitedHelperIds)];
  if (input.visibility === 'FAVOURITES') {
    if (invitedHelperIds.length === 0) {
      throw ApiError.badRequest('Choose at least one trusted helper to invite.');
    }
    // Invitations notify people, so they may only go to verified, active students
    // on this campus (RLS confines the lookup to the campus), and never to yourself.
    const { rows: eligible } = await tx.query<{ id: string }>(
      `SELECT id FROM users
        WHERE id = ANY($1::uuid[]) AND id <> $2
          AND is_verified AND account_status = 'ACTIVE'
          AND NOT app_users_blocked($2, id)`,
      [invitedHelperIds, user.id],
    );
    if (eligible.length !== invitedHelperIds.length) {
      throw ApiError.badRequest('You can only invite verified students on this campus, other than yourself.');
    }
  }

  // The public feed only ever sees a coarsened position.
  const exactLat = input.lat ?? input.pickupLocation?.lat ?? null;
  const exactLng = input.lng ?? input.pickupLocation?.lng ?? null;
  const approx =
    exactLat !== null && exactLng !== null
      ? fuzzCoordinate({ lat: exactLat, lng: exactLng })
      : { lat: null, lng: null };

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO requests (
       campus_id, requester_id, title, description, category_slug, subcategory,
       reward_paise, product_cost_paise, max_reward_paise, auto_escalate,
       pickup_label, pickup_lat, pickup_lng, delivery_label, delivery_lat, delivery_lng,
       exact_lat, exact_lng, approx_lat, approx_lng,
       deadline_at, scheduled_for, urgency, visibility,
       visibility_hostel_id, visibility_department_id, visibility_year, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20,
       $21, $22, $23, $24,
       $25, $26, $27, $28
     ) RETURNING id`,
    [
      user.campusId,
      user.id,
      input.title,
      input.description,
      input.categorySlug,
      input.subcategory ?? null,
      input.rewardPaise,
      input.productCostPaise,
      input.maxRewardPaise ?? null,
      input.autoEscalate,
      input.pickupLocation?.label ?? null,
      input.pickupLocation?.lat ?? null,
      input.pickupLocation?.lng ?? null,
      input.deliveryLocation?.label ?? null,
      input.deliveryLocation?.lat ?? null,
      input.deliveryLocation?.lng ?? null,
      exactLat,
      exactLng,
      approx.lat,
      approx.lng,
      input.deadlineAt ?? null,
      scheduledFor,
      input.urgency,
      input.visibility,
      visibilityHostelId,
      visibilityDepartmentId,
      visibilityYear,
      'OPEN',
    ],
  );
  const requestId = rows[0].id;

  await tx.query(
    `INSERT INTO request_status_history (request_id, from_status, to_status, action, actor_role, actor_id)
     VALUES ($1, NULL, 'OPEN', 'create', 'REQUESTER', $2)`,
    [requestId, user.id],
  );

  for (const [index, attachmentId] of input.attachmentIds.entries()) {
    await tx.query(
      `INSERT INTO request_attachments (request_id, attachment_id, sort_order)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [requestId, attachmentId, index],
    );
  }

  if (input.visibility === 'FAVOURITES') {
    for (const helperId of invitedHelperIds) {
      await tx.query(
        `INSERT INTO request_invitations (request_id, helper_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [requestId, helperId],
      );
    }
  }

  return requestId;
}

/**
 * Tells the right helpers about a request that has just gone live, and refreshes the
 * campus feed. Called when a request is posted, and by the scheduler when a scheduled
 * request's time arrives.
 *
 * Who hears about it is decided in the database by `app_matching_helpers`, which
 * honours each helper's own settings — availability, categories, minimum reward,
 * distance, urgent-only — and the request's visibility, so this never becomes a
 * broadcast (spec §20, §32). A private request goes only to the students invited.
 */
export async function announceRequest(
  tx: Queryable,
  outbox: Outbox,
  requestId: string,
): Promise<number> {
  const { rows } = await tx.query<{
    campus_id: string;
    requester_id: string;
    title: string;
    reward_paise: number | string;
    category_slug: string;
    urgency: string;
    visibility: string;
  }>(
    `SELECT campus_id, requester_id, title, reward_paise, category_slug, urgency, visibility
       FROM requests WHERE id = $1`,
    [requestId],
  );
  const request = rows[0];
  if (!request) return 0;

  const helpers =
    request.visibility === 'FAVOURITES'
      ? await tx.query<{ id: string }>(
          'SELECT helper_id AS id FROM request_invitations WHERE request_id = $1',
          [requestId],
        )
      : await tx.query<{ id: string }>(
          'SELECT helper AS id FROM app_matching_helpers($1, 40) AS helper',
          [requestId],
        );

  const rewardPaise = Number(request.reward_paise);
  const urgent = request.urgency === 'URGENT';
  for (const helper of helpers.rows) {
    await notify(
      tx,
      {
        userId: helper.id,
        campusId: request.campus_id,
        type: 'REQUEST_CREATED',
        title: urgent ? 'Urgent request nearby' : 'New request you can help with',
        body: `${request.title} — ${formatINR(rewardPaise)} reward`,
        data: { requestId, categorySlug: request.category_slug },
        preference: 'new_matching_requests',
        important: urgent,
        actorId: request.requester_id,
      },
      outbox,
    );
  }

  // The campus feed refreshes without anyone pulling to refresh.
  outbox.add(() =>
    publish(campusChannel(request.campus_id), 'REQUEST_CREATED', {
      requestId,
      categorySlug: request.category_slug,
      rewardPaise,
      urgency: request.urgency,
    }),
  );
  return helpers.rows.length;
}

/**
 * Raises the reward on an open request (spec §22).
 *
 * Only ever upward, never past the requester's own ceiling, and never once a helper
 * is committed — otherwise the terms of an accepted task could change underneath them.
 */
export async function increaseReward(
  tx: Queryable,
  request: LockedRequest,
  newRewardPaise: number,
  actorId: string | null,
  reason: 'MANUAL' | 'AUTO_ESCALATION',
): Promise<number> {
  if (!OFFERABLE_REQUEST_STATUSES.includes(request.status)) {
    throw ApiError.conflict(
      'The reward can only be changed while the request is still open for offers.',
      'REWARD_LOCKED',
    );
  }
  if (newRewardPaise <= request.reward_paise) {
    throw ApiError.badRequest('The new reward must be higher than the current one.');
  }
  if (request.max_reward_paise !== null && newRewardPaise > request.max_reward_paise) {
    throw ApiError.badRequest('That is above the maximum reward you set for this request.');
  }

  await tx.query(
    `UPDATE requests SET reward_paise = $2, last_escalated_at = now() WHERE id = $1`,
    [request.id, newRewardPaise],
  );
  await tx.query(
    `INSERT INTO request_reward_history (request_id, from_paise, to_paise, reason, actor_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [request.id, request.reward_paise, newRewardPaise, reason, actorId],
  );
  return newRewardPaise;
}

/** Marks every still-pending offer as declined; used when a helper is chosen or the request closes. */
export async function closeOutstandingOffers(
  tx: Queryable,
  requestId: string,
  exceptOfferId: string | null,
  status: 'DECLINED' | 'EXPIRED' = 'DECLINED',
): Promise<string[]> {
  const { rows } = await tx.query<{ helper_id: string }>(
    `UPDATE request_offers SET status = $3
      WHERE request_id = $1 AND status = 'PENDING' AND ($2::uuid IS NULL OR id <> $2::uuid)
      RETURNING helper_id`,
    [requestId, exceptOfferId, status],
  );
  return rows.map((row) => row.helper_id);
}

/** Opens (or finds) the private conversation for a request. */
export async function ensureConversation(
  tx: Queryable,
  requestId: string,
  campusId: string,
  participantIds: readonly string[],
  subject: string,
): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM conversations WHERE request_id = $1',
    [requestId],
  );
  if (existing.rows[0]) {
    // A request can change helper (the first one withdrew). The thread then belongs
    // to the requester and the new helper: the previous helper is taken out, so they
    // cannot read what the other two say from here on.
    const conversationId = existing.rows[0].id;
    const members = [...new Set(participantIds)];
    await tx.query(
      `DELETE FROM conversation_participants
        WHERE conversation_id = $1 AND user_id <> ALL ($2::uuid[])`,
      [conversationId, members],
    );
    for (const userId of members) {
      await tx.query(
        `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [conversationId, userId],
      );
    }
    return conversationId;
  }

  // The id is generated here rather than with RETURNING: the SELECT policy on
  // `conversations` is membership-based, and at the moment of insert the
  // conversation has no participants yet, so RETURNING would be refused.
  const conversationId = randomUUID();
  await tx.query(
    `INSERT INTO conversations (id, campus_id, request_id, subject) VALUES ($1, $2, $3, $4)`,
    [conversationId, campusId, requestId, subject],
  );

  for (const userId of new Set(participantIds)) {
    await tx.query(
      `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [conversationId, userId],
    );
  }
  return conversationId;
}

/** Creates the payment record once the requester confirms the work was done. */
export async function ensurePaymentForRequest(
  tx: Queryable,
  request: LockedRequest,
): Promise<string | null> {
  if (!request.selected_helper_id) return null;

  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM payments WHERE request_id = $1',
    [request.id],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  // The amount is derived from the stored request, never from the client: the helper
  // is owed their reward plus whatever they spent on the requester's behalf.
  const amount = Number(request.reward_paise) + Number(request.product_cost_paise);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO payments (campus_id, request_id, payer_id, payee_id, amount_paise, method, status, reference_note)
     VALUES ($1, $2, $3, $4, $5, 'UPI_QR', 'PAYMENT_PENDING', $6)
     RETURNING id`,
    [
      request.campus_id,
      request.id,
      request.requester_id,
      request.selected_helper_id,
      amount,
      request.title.slice(0, 80),
    ],
  );
  const paymentId = rows[0].id;

  await tx.query(
    `INSERT INTO transaction_events (payment_id, from_status, to_status, action, actor_id, actor_role, note)
     VALUES ($1, NULL, 'PAYMENT_PENDING', 'created', NULL, 'SYSTEM', 'Requester confirmed completion')`,
    [paymentId],
  );
  return paymentId;
}

/** Moves a request to RATED once both participants have rated. */
export async function maybeCompleteRating(tx: Queryable, requestId: string): Promise<boolean> {
  const { rows } = await tx.query<{ count: string; status: RequestStatus }>(
    `SELECT (SELECT count(*)::text FROM ratings WHERE request_id = $1) AS count,
            (SELECT status FROM requests WHERE id = $1) AS status`,
    [requestId],
  );
  const row = rows[0];
  if (!row || Number(row.count) < 2 || row.status !== 'PAID') return false;

  const request = await lockRequest(tx, requestId);
  await applyTransition(tx, request, 'RATED', 'both_rated', 'SYSTEM', null, {
    note: 'Both participants submitted a rating',
  });
  return true;
}
