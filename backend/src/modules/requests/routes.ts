import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  cancelRequestSchema,
  completeTaskSchema,
  createOfferSchema,
  createRequestSchema,
  formatINR,
  increaseRewardSchema,
  rejectCompletionSchema,
  requestFeedQuerySchema,
  selectHelperSchema,
  updateRequestSchema,
} from '@campusbuddy/shared';
import { requireAuth, requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { enforceRateLimit, RATE_LIMITS } from '../../core/rate-limit.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx, type Outbox } from '../../core/outbox.js';
import { toOffer, type OfferRow } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { campusChannel, publish, requestChannel } from '../../realtime/hub.js';
import { listRequests } from './feed.js';
import {
  actorOn,
  announceRequest,
  applyTransition,
  closeOutstandingOffers,
  createRequest,
  ensureConversation,
  ensurePaymentForRequest,
  increaseReward,
  loadRequest,
  lockRequest,
  type ViewerContext,
} from './service.js';

const idParams = z.object({ id: z.string().uuid('Unknown request') });
const offerParams = z.object({
  id: z.string().uuid('Unknown request'),
  offerId: z.string().uuid('Unknown offer'),
});
const viewerPositionSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** The viewer's optional shared position, used for distances and nearby ranking. */
function viewerContextFrom(request: FastifyRequest, requireVerifiedUser = true): ViewerContext {
  const user = requireVerifiedUser ? requireVerified(request) : requireAuth(request);
  const position = viewerPositionSchema.safeParse(request.query ?? {});
  return {
    user,
    lat: position.success ? (position.data.lat ?? null) : null,
    lng: position.success ? (position.data.lng ?? null) : null,
  };
}

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------- discovery
  app.get('/', async (request) => {
    const viewer = viewerContextFrom(request);
    const query = parseOrThrow(requestFeedQuerySchema, request.query ?? {});
    return withUserTx(request.db, viewer.user, (tx) => listRequests(tx, viewer, query));
  });

  app.get('/:id', async (request) => {
    const viewer = viewerContextFrom(request);
    const { id } = parseOrThrow(idParams, request.params);
    return withUserTx(request.db, viewer.user, async (tx) => ({
      request: await loadRequest(tx, id, viewer),
    }));
  });

  app.get('/:id/history', async (request) => {
    const viewer = viewerContextFrom(request);
    const { id } = parseOrThrow(idParams, request.params);
    return withUserTx(request.db, viewer.user, async (tx) => {
      const { rows } = await tx.query(
        `SELECT h.id, h.from_status, h.to_status, h.action, h.actor_role, h.actor_id, h.note, h.created_at
           FROM request_status_history h WHERE h.request_id = $1 ORDER BY h.created_at ASC`,
        [id],
      );
      const rewards = await tx.query(
        `SELECT id, from_paise, to_paise, reason, created_at
           FROM request_reward_history WHERE request_id = $1 ORDER BY created_at ASC`,
        [id],
      );
      return { statusHistory: rows, rewardHistory: rewards.rows };
    });
  });

  // ----------------------------------------------------------------- creating
  app.post('/', async (request, reply) => {
    const user = requireVerified(request);
    const body = parseOrThrow(createRequestSchema, request.body);
    await enforceRateLimit(
      request.db,
      RATE_LIMITS.createRequest,
      user.id,
      'You have posted a lot of requests recently. Please wait a while.',
    );

    const created = await withUserTx(request.db, user, async (tx, outbox) => {
      const { rows } = await tx.query<{
        hostel_id: string | null;
        department_id: string | null;
        year_of_study: number | null;
      }>('SELECT hostel_id, department_id, year_of_study FROM users WHERE id = $1', [user.id]);
      const profile = rows[0] ?? { hostel_id: null, department_id: null, year_of_study: null };

      const requestId = await createRequest(tx, user, body, {
        hostelId: profile.hostel_id,
        departmentId: profile.department_id,
        yearOfStudy: profile.year_of_study,
      });

      const created = await loadRequest(tx, requestId, { user, lat: null, lng: null });

      // A scheduled request stays quiet until its time comes, when the scheduler
      // announces it. Anything else goes out to matching (or invited) helpers now.
      if (!created.scheduledFor) await announceRequest(tx, outbox, requestId);

      return created;
    });

    return reply.code(201).send({ request: created });
  });

  app.patch('/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(updateRequestSchema, request.body);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const locked = await lockRequest(tx, id);
      if (locked.requester_id !== user.id) {
        throw ApiError.forbidden('Only the student who posted this request can edit it.');
      }
      if (!['OPEN', 'OFFERS_RECEIVED'].includes(locked.status)) {
        throw ApiError.conflict(
          'This request can no longer be edited because a helper is already involved.',
          'REQUEST_LOCKED',
        );
      }

      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch.title = body.title;
      if (body.description !== undefined) patch.description = body.description;
      if (body.subcategory !== undefined) patch.subcategory = body.subcategory;
      if (body.urgency !== undefined) patch.urgency = body.urgency;
      if (body.deadlineAt !== undefined) {
        if (body.deadlineAt && new Date(body.deadlineAt).getTime() <= Date.now()) {
          throw ApiError.badRequest('The deadline must be in the future.');
        }
        patch.deadline_at = body.deadlineAt;
      }
      if (body.pickupLocation !== undefined) {
        patch.pickup_label = body.pickupLocation?.label ?? null;
        patch.pickup_lat = body.pickupLocation?.lat ?? null;
        patch.pickup_lng = body.pickupLocation?.lng ?? null;
      }
      if (body.deliveryLocation !== undefined) {
        patch.delivery_label = body.deliveryLocation?.label ?? null;
        patch.delivery_lat = body.deliveryLocation?.lat ?? null;
        patch.delivery_lng = body.deliveryLocation?.lng ?? null;
      }

      const columns = Object.keys(patch);
      if (columns.length > 0) {
        const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
        await tx.query(`UPDATE requests SET ${assignments.join(', ')} WHERE id = $1`, [
          id,
          ...columns.map((column) => patch[column]),
        ]);
      }

      const updated = await loadRequest(tx, id, { user, lat: null, lng: null });
      outbox.add(() => publish(requestChannel(id), 'REQUEST_UPDATED', { requestId: id }));
      return { request: updated };
    });
  });

  // ------------------------------------------------------------------ rewards
  app.post('/:id/reward', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(increaseRewardSchema, request.body);

    return withUserTx(request.db, user, async (tx, outbox) => {
      // Checked before locking: `SELECT ... FOR UPDATE` is filtered by the update
      // policy, so a non-owner would otherwise get a bare 404 instead of a reason.
      const { rows: ownerRows } = await tx.query<{ requester_id: string }>(
        'SELECT requester_id FROM requests WHERE id = $1',
        [id],
      );
      if (!ownerRows[0]) throw ApiError.notFound('That request is not available.');
      if (ownerRows[0].requester_id !== user.id) {
        throw ApiError.forbidden('Only the student who posted this request can change the reward.');
      }

      const locked = await lockRequest(tx, id);
      const previous = locked.reward_paise;
      await increaseReward(tx, locked, body.rewardPaise, user.id, 'MANUAL');

      // Everyone who already offered is told the terms improved (spec §22).
      const { rows: interested } = await tx.query<{ helper_id: string }>(
        `SELECT helper_id FROM request_offers WHERE request_id = $1 AND status = 'PENDING'`,
        [id],
      );
      for (const row of interested) {
        await notify(
          tx,
          {
            userId: row.helper_id,
            campusId: user.campusId,
            type: 'REWARD_CHANGED',
            title: 'Reward increased',
            body: `"${locked.title}" now pays ${formatINR(body.rewardPaise)} (was ${formatINR(previous)}).`,
            data: { requestId: id, rewardPaise: body.rewardPaise },
            preference: 'offers',
          },
          outbox,
        );
      }

      outbox.add(() => {
        publish(requestChannel(id), 'REWARD_CHANGED', {
          requestId: id,
          fromPaise: previous,
          toPaise: body.rewardPaise,
        });
        publish(campusChannel(user.campusId), 'REWARD_CHANGED', {
          requestId: id,
          toPaise: body.rewardPaise,
        });
      });

      return { request: await loadRequest(tx, id, { user, lat: null, lng: null }) };
    });
  });

  // ------------------------------------------------------------------- offers
  app.get('/:id/offers', async (request) => {
    const viewer = viewerContextFrom(request);
    const { id } = parseOrThrow(idParams, request.params);

    return withUserTx(request.db, viewer.user, async (tx) => {
      const { rows } = await tx.query<OfferRow>(
        `SELECT o.id, o.request_id, o.offered_reward_paise, o.message, o.status,
                o.eta_minutes, o.distance_metres, o.match_score, o.created_at,
                to_jsonb(p) AS helper
           FROM request_offers o
           JOIN public_user_profiles p ON p.id = o.helper_id
          WHERE o.request_id = $1
          ORDER BY o.match_score DESC NULLS LAST, o.offered_reward_paise ASC, o.created_at ASC`,
        [id],
      );
      return { offers: rows.map(toOffer) };
    });
  });

  /** A helper accepts the listed reward, or proposes a different one (spec §25). */
  app.post('/:id/offers', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(createOfferSchema, request.body);
    await enforceRateLimit(request.db, RATE_LIMITS.createOffer, user.id);

    const offer = await withUserTx(request.db, user, async (tx, outbox) => {
      // A helper is not a participant yet, so the request is read through RLS
      // rather than locked with FOR UPDATE — which the update policy would refuse.
      const { rows: targetRows } = await tx.query<{
        requester_id: string;
        status: string;
        reward_paise: number;
        deadline_at: Date | null;
        scheduled_for: Date | null;
        title: string;
        campus_id: string;
      }>(
        `SELECT requester_id, status, reward_paise, deadline_at, scheduled_for, title, campus_id
           FROM requests WHERE id = $1`,
        [id],
      );
      const target = targetRows[0];
      if (!target) throw ApiError.notFound('That request is not available.');

      if (target.requester_id === user.id) {
        throw ApiError.badRequest('You cannot offer to help with your own request.');
      }
      const blocked = await tx.query<{ blocked: boolean }>(
        'SELECT app_users_blocked($1, $2) AS blocked',
        [user.id, target.requester_id],
      );
      if (blocked.rows[0]?.blocked) {
        throw ApiError.forbidden('You cannot interact with this student because one of you has blocked the other.');
      }
      if (!['OPEN', 'OFFERS_RECEIVED'].includes(target.status)) {
        throw ApiError.conflict('This request is no longer taking offers.', 'OFFERS_CLOSED');
      }
      if (target.deadline_at && new Date(target.deadline_at).getTime() <= Date.now()) {
        throw ApiError.gone('This request has passed its deadline.', 'REQUEST_EXPIRED');
      }
      if (target.scheduled_for && new Date(target.scheduled_for).getTime() > Date.now()) {
        throw ApiError.conflict('This request is scheduled and is not taking offers yet.', 'REQUEST_SCHEDULED');
      }

      const offeredReward = body.offeredRewardPaise ?? target.reward_paise;

      // INSERT ... SELECT re-checks the status inside the same statement, so an
      // offer cannot land on a request that closed a moment ago. A helper may also
      // renew an offer they withdrew, or one that was passed over before the request
      // reopened (the chosen helper backed out); the ON CONFLICT branch handles both.
      // An offer that is still ACCEPTED is never touched.
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO request_offers
           (campus_id, request_id, helper_id, offered_reward_paise, message, eta_minutes, status)
         SELECT $1, r.id, $3, $4, $5, $6, 'PENDING'
           FROM requests r
          WHERE r.id = $2 AND r.status IN ('OPEN','OFFERS_RECEIVED')
         ON CONFLICT (request_id, helper_id) DO UPDATE
           SET offered_reward_paise = EXCLUDED.offered_reward_paise,
               message = EXCLUDED.message,
               eta_minutes = EXCLUDED.eta_minutes,
               status = 'PENDING'
           WHERE request_offers.status IN ('WITHDRAWN','PENDING','DECLINED','EXPIRED')
         RETURNING id`,
        [user.campusId, id, user.id, offeredReward, body.message ?? null, body.etaMinutes ?? null],
      );
      if (!rows[0]) {
        throw ApiError.conflict(
          'That request is no longer taking offers, or your earlier offer has already been decided.',
          'OFFER_ALREADY_DECIDED',
        );
      }
      const offerId = rows[0].id;

      // The first offer flips OPEN -> OFFERS_RECEIVED. That is a system transition
      // on someone else's request, so it goes through the dedicated database
      // function which can perform only that one move (migration 013).
      await tx.query('SELECT app_mark_offers_received($1)', [id]);
      const locked = { requester_id: target.requester_id, title: target.title };

      await notify(
        tx,
        {
          userId: locked.requester_id,
          campusId: user.campusId,
          type: 'OFFER_CREATED',
          title: 'New offer received',
          body: `${user.fullName} offered to help with "${locked.title}" for ${formatINR(offeredReward)}.`,
          data: { requestId: id, offerId },
          preference: 'offers',
          important: true,
          actorId: user.id,
        },
        outbox,
      );

      const { rows: offerRows } = await tx.query<OfferRow>(
        `SELECT o.id, o.request_id, o.offered_reward_paise, o.message, o.status,
                o.eta_minutes, o.distance_metres, o.match_score, o.created_at,
                to_jsonb(p) AS helper
           FROM request_offers o JOIN public_user_profiles p ON p.id = o.helper_id
          WHERE o.id = $1`,
        [offerId],
      );

      outbox.add(() =>
        publish(requestChannel(id), 'OFFER_CREATED', { requestId: id, offerId }),
      );
      return toOffer(offerRows[0]);
    });

    return reply.code(201).send({ offer });
  });

  app.post('/:id/offers/:offerId/withdraw', async (request) => {
    const user = requireVerified(request);
    const { id, offerId } = parseOrThrow(offerParams, request.params);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const { rows } = await tx.query<{ helper_id: string; status: string }>(
        'SELECT helper_id, status FROM request_offers WHERE id = $1 AND request_id = $2 FOR UPDATE',
        [offerId, id],
      );
      const offer = rows[0];
      if (!offer) throw ApiError.notFound('That offer no longer exists.');
      if (offer.helper_id !== user.id) throw ApiError.forbidden('That is not your offer.');
      if (offer.status !== 'PENDING') {
        throw ApiError.conflict('That offer has already been decided.', 'OFFER_ALREADY_DECIDED');
      }

      await tx.query(`UPDATE request_offers SET status = 'WITHDRAWN' WHERE id = $1`, [offerId]);

      // With nothing pending left, the request returns to plain OPEN. The function
      // re-checks that for itself, so there is no read-then-write race here.
      await tx.query('SELECT app_reopen_if_no_offers($1)', [id]);

      outbox.add(() => publish(requestChannel(id), 'OFFER_WITHDRAWN', { requestId: id, offerId }));
      return { ok: true };
    });
  });

  /**
   * The requester picks one helper.
   *
   * Locking the request first is what makes two simultaneous selections impossible;
   * the partial unique index on accepted offers is the database's own backstop.
   */
  app.post('/:id/select-helper', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(selectHelperSchema, request.body);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const locked = await lockRequest(tx, id);
      if (locked.requester_id !== user.id) {
        throw ApiError.forbidden('Only the student who posted this request can select a helper.');
      }

      const { rows } = await tx.query<{
        id: string;
        helper_id: string;
        offered_reward_paise: number;
        status: string;
      }>(
        'SELECT id, helper_id, offered_reward_paise, status FROM request_offers WHERE id = $1 AND request_id = $2 FOR UPDATE',
        [body.offerId, id],
      );
      const offer = rows[0];
      if (!offer) throw ApiError.notFound('That offer no longer exists.');
      if (offer.status !== 'PENDING') {
        throw ApiError.conflict('That offer is no longer available.', 'OFFER_UNAVAILABLE');
      }

      await tx.query(`UPDATE request_offers SET status = 'ACCEPTED' WHERE id = $1`, [offer.id]);
      const declinedHelpers = await closeOutstandingOffers(tx, id, offer.id, 'DECLINED');

      // The agreed price is the offer's amount, not whatever the client sends.
      await applyTransition(tx, locked, 'HELPER_SELECTED', 'select_helper', 'REQUESTER', user.id, {
        patch: {
          selected_helper_id: offer.helper_id,
          selected_offer_id: offer.id,
          reward_paise: offer.offered_reward_paise,
        },
      });

      // The reward history table records increases only (it has a CHECK constraint
      // to that effect), and accepting a cheaper offer is perfectly legitimate — so
      // the row is written conditionally rather than attempted and swallowed. A
      // failed statement would abort the whole transaction, not just this insert.
      if (offer.offered_reward_paise > locked.reward_paise) {
        await tx.query(
          `INSERT INTO request_reward_history (request_id, from_paise, to_paise, reason, actor_id)
           VALUES ($1, $2, $3, 'MANUAL', $4)`,
          [id, locked.reward_paise, offer.offered_reward_paise, user.id],
        );
      }

      const conversationId = await ensureConversation(
        tx,
        id,
        locked.campus_id,
        [user.id, offer.helper_id],
        locked.title,
      );

      await notify(
        tx,
        {
          userId: offer.helper_id,
          campusId: user.campusId,
          type: 'HELPER_SELECTED',
          title: 'You were selected',
          body: `${user.fullName} chose you for "${locked.title}". Accept to start.`,
          data: { requestId: id, conversationId },
          preference: 'offers',
          important: true,
        },
        outbox,
      );
      for (const helperId of declinedHelpers) {
        await notify(
          tx,
          {
            userId: helperId,
            campusId: user.campusId,
            type: 'OFFER_DECLINED',
            title: 'Offer not selected',
            body: `Another helper was chosen for "${locked.title}".`,
            data: { requestId: id },
            preference: 'offers',
          },
          outbox,
        );
      }

      outbox.add(() =>
        publish(requestChannel(id), 'HELPER_SELECTED', { requestId: id, helperId: offer.helper_id }),
      );

      return { request: await loadRequest(tx, id, { user, lat: null, lng: null }) };
    });
  });

  // -------------------------------------------------------------- lifecycle
  registerTransition(app, 'accept', 'ACCEPTED', 'helper_accept', {
    patch: () => ({ accepted_at: new Date() }),
    notify: (locked, actor) => ({
      to: locked.requester_id,
      type: 'OFFER_ACCEPTED',
      title: 'Helper accepted',
      body: `${actor.fullName} accepted "${locked.title}" and will start shortly.`,
      preference: 'offers' as const,
      important: true,
    }),
  });

  registerTransition(app, 'decline-selection', 'OPEN', 'helper_decline_selection', {
    patch: () => ({ selected_helper_id: null, selected_offer_id: null }),
    before: async (tx, locked) => {
      await tx.query(
        `UPDATE request_offers SET status = 'WITHDRAWN' WHERE request_id = $1 AND status = 'ACCEPTED'`,
        [locked.id],
      );
    },
    notify: (locked, actor) => ({
      to: locked.requester_id,
      type: 'HELPER_WITHDREW',
      title: 'Helper declined',
      body: `${actor.fullName} could not take "${locked.title}". Your request is open again.`,
      preference: 'offers' as const,
      important: true,
    }),
  });

  registerTransition(app, 'start', 'IN_PROGRESS', 'start_task', {
    patch: () => ({ started_at: new Date() }),
    notify: (locked, actor) => ({
      to: locked.requester_id,
      type: 'TASK_STARTED',
      title: 'Task started',
      body: `${actor.fullName} has started "${locked.title}".`,
      preference: 'offers' as const,
    }),
  });

  registerTransition(app, 'withdraw', 'HELPER_WITHDREW', 'helper_withdraw', {
    // The helper's accepted offer is retired with them. Left ACCEPTED, it would block
    // every later selection (one accepted offer per request), and the request could
    // never find another helper.
    patch: () => ({ selected_helper_id: null, selected_offer_id: null }),
    before: async (tx, locked) => {
      await tx.query(
        `UPDATE request_offers SET status = 'WITHDRAWN' WHERE request_id = $1 AND status = 'ACCEPTED'`,
        [locked.id],
      );
    },
    notify: (locked, actor) => ({
      to: locked.requester_id,
      type: 'HELPER_WITHDREW',
      title: 'Helper withdrew',
      body: `${actor.fullName} withdrew from "${locked.title}".`,
      preference: 'offers' as const,
      important: true,
    }),
  });

  registerTransition(app, 'reopen', 'OPEN', 'reopen', {
    patch: () => ({ selected_helper_id: null, selected_offer_id: null }),
  });

  registerTransition(app, 'resume', 'IN_PROGRESS', 'resume_task', {
    notify: (locked) => ({
      to: locked.requester_id,
      type: 'TASK_STARTED',
      title: 'Helper is retrying',
      body: `Your helper is having another go at "${locked.title}".`,
      preference: 'offers' as const,
    }),
  });

  /** Helper marks the work done; the requester still has to confirm. */
  app.post('/:id/complete', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(completeTaskSchema, request.body ?? {});

    return withUserTx(request.db, user, async (tx, outbox) => {
      const locked = await lockRequest(tx, id);
      const actor = actorOn(locked, user);

      await applyTransition(tx, locked, 'COMPLETED', 'mark_completed', actor, user.id, {
        note: body.note ?? null,
        patch: {
          completed_at: new Date(),
          completion_note: body.note ?? null,
          completion_proof_id: body.proofAttachmentId ?? null,
        },
      });

      await notify(
        tx,
        {
          userId: locked.requester_id,
          campusId: user.campusId,
          type: 'TASK_COMPLETED',
          title: 'Task marked complete',
          body: `${user.fullName} finished "${locked.title}". Confirm to release payment.`,
          data: { requestId: id },
          preference: 'offers',
          important: true,
        },
        outbox,
      );
      outbox.add(() => publish(requestChannel(id), 'TASK_COMPLETED', { requestId: id }));

      return { request: await loadRequest(tx, id, { user, lat: null, lng: null }) };
    });
  });

  /** The requester confirms the work — the moment a payment becomes due. */
  app.post('/:id/confirm', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const locked = await lockRequest(tx, id);
      const actor = actorOn(locked, user);
      if (actor !== 'REQUESTER') {
        throw ApiError.forbidden('Only the requester can confirm the task is done.');
      }

      await applyTransition(tx, locked, 'PAYMENT_PENDING', 'confirm_completion', actor, user.id, {
        patch: { confirmed_at: new Date() },
      });
      const paymentId = await ensurePaymentForRequest(tx, locked);

      if (locked.selected_helper_id) {
        await notify(
          tx,
          {
            userId: locked.selected_helper_id,
            campusId: user.campusId,
            type: 'COMPLETION_CONFIRMED',
            title: 'Completion confirmed',
            body: `${user.fullName} confirmed "${locked.title}". Payment is on its way.`,
            data: { requestId: id, paymentId },
            preference: 'payments',
            important: true,
          },
          outbox,
        );
      }
      outbox.add(() =>
        publish(requestChannel(id), 'COMPLETION_CONFIRMED', { requestId: id, paymentId }),
      );

      return { request: await loadRequest(tx, id, { user, lat: null, lng: null }) };
    });
  });

  /** The requester says the work was not done. Never silently marks anything paid. */
  app.post('/:id/reject', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(rejectCompletionSchema, request.body);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const locked = await lockRequest(tx, id);
      const actor = actorOn(locked, user);
      if (actor !== 'REQUESTER') {
        throw ApiError.forbidden('Only the requester can reject a completion.');
      }

      await applyTransition(tx, locked, 'REJECTED', 'reject_completion', actor, user.id, {
        note: body.reason,
        patch: { rejection_reason: body.reason },
      });

      if (locked.selected_helper_id) {
        await notify(
          tx,
          {
            userId: locked.selected_helper_id,
            campusId: user.campusId,
            type: 'COMPLETION_REJECTED',
            title: 'Completion disputed',
            body: `${user.fullName} says "${locked.title}" is not finished: ${body.reason}`,
            data: { requestId: id },
            preference: 'offers',
            important: true,
          },
          outbox,
        );
      }
      outbox.add(() => publish(requestChannel(id), 'COMPLETION_REJECTED', { requestId: id }));

      return { request: await loadRequest(tx, id, { user, lat: null, lng: null }) };
    });
  });

  app.post('/:id/cancel', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(cancelRequestSchema, request.body);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const locked = await lockRequest(tx, id);
      const actor = actorOn(locked, user);

      await applyTransition(tx, locked, 'CANCELLED', 'cancel', actor, user.id, {
        note: body.reason,
        patch: { cancelled_at: new Date(), cancellation_reason: body.reason },
      });

      const affected = await closeOutstandingOffers(tx, id, null, 'EXPIRED');
      const recipients = [...affected, locked.selected_helper_id].filter(
        (value): value is string => Boolean(value) && value !== user.id,
      );
      for (const helperId of recipients) {
        await notify(
          tx,
          {
            userId: helperId,
            campusId: user.campusId,
            type: 'REQUEST_CANCELLED',
            title: 'Request cancelled',
            body: `"${locked.title}" was cancelled: ${body.reason}`,
            data: { requestId: id },
            preference: 'offers',
            important: true,
          },
          outbox,
        );
      }
      outbox.add(() => publish(requestChannel(id), 'REQUEST_CANCELLED', { requestId: id }));

      return { request: await loadRequest(tx, id, { user, lat: null, lng: null }) };
    });
  });

  /** Re-post an earlier request, pre-filled for review rather than blindly copied (spec §49). */
  app.post('/:id/repeat', async (request) => {
    const viewer = viewerContextFrom(request);
    const { id } = parseOrThrow(idParams, request.params);

    return withUserTx(request.db, viewer.user, async (tx) => {
      const original = await loadRequest(tx, id, viewer);
      if (original.requester.id !== viewer.user.id) {
        throw ApiError.forbidden('You can only repeat your own requests.');
      }
      // A draft, not a published request: the student reviews it before it goes live.
      return {
        draft: {
          title: original.title,
          description: original.description,
          categorySlug: original.categorySlug,
          subcategory: original.subcategory,
          rewardPaise: original.rewardPaise,
          productCostPaise: original.productCostPaise,
          pickupLocation: original.pickupLocation,
          deliveryLocation: original.deliveryLocation,
          urgency: original.urgency,
          visibility: original.visibility,
        },
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Shared plumbing for the simple one-step lifecycle endpoints.
// ---------------------------------------------------------------------------

interface TransitionConfig {
  patch?: () => Record<string, unknown>;
  before?: (tx: Parameters<typeof applyTransition>[0], locked: Awaited<ReturnType<typeof lockRequest>>) => Promise<void>;
  notify?: (
    locked: Awaited<ReturnType<typeof lockRequest>>,
    actor: { id: string; fullName: string; campusId: string },
  ) => {
    to: string | null;
    type: Parameters<typeof notify>[1]['type'];
    title: string;
    body: string;
    preference?: Parameters<typeof notify>[1]['preference'];
    important?: boolean;
  };
}

function registerTransition(
  app: FastifyInstance,
  path: string,
  to: Parameters<typeof applyTransition>[2],
  action: string,
  config: TransitionConfig = {},
): void {
  app.post(`/:id/${path}`, async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);

    return withUserTx(request.db, user, async (tx, outbox: Outbox) => {
      const locked = await lockRequest(tx, id);
      const actor = actorOn(locked, user);

      if (config.before) await config.before(tx, locked);
      await applyTransition(tx, locked, to, action, actor, user.id, {
        patch: config.patch?.(),
      });

      if (config.notify) {
        const message = config.notify(locked, user);
        if (message.to && message.to !== user.id) {
          await notify(
            tx,
            {
              userId: message.to,
              campusId: user.campusId,
              type: message.type,
              title: message.title,
              body: message.body,
              data: { requestId: id },
              preference: message.preference,
              important: message.important,
            },
            outbox,
          );
        }
      }

      outbox.add(() => publish(requestChannel(id), 'REQUEST_UPDATED', { requestId: id, status: to }));
      // A helper who has just withdrawn or declined may no longer be able to see a
      // restricted request. That must not undo what they did, so the refreshed
      // request is returned only while it is still visible to them.
      return { request: await loadRequestIfVisible(tx, id, { user, lat: null, lng: null }) };
    });
  });
}

async function loadRequestIfVisible(
  tx: Parameters<typeof applyTransition>[0],
  requestId: string,
  viewer: ViewerContext,
): Promise<Awaited<ReturnType<typeof loadRequest>> | null> {
  try {
    return await loadRequest(tx, requestId, viewer);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
}
