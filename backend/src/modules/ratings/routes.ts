import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRatingSchema } from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import { toRating, type RatingRow } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { publish, requestChannel } from '../../realtime/hub.js';
import { maybeCompleteRating } from '../requests/service.js';

/**
 * Two-way ratings (spec §38).
 *
 * Rating is only possible after a payment has actually been confirmed, only by the
 * two participants, only about the other person, and only once. Three of those four
 * rules are enforced by database constraints rather than by this file alone.
 */

const requestParams = z.object({ id: z.string().uuid('Unknown request') });

const RATING_SELECT = `
  SELECT r.id, r.request_id, r.rental_id, r.ratee_id, r.direction, r.stars,
         r.punctuality, r.reliability, r.communication, r.quality,
         r.clear_instructions, r.payment_reliability, r.respectfulness,
         r.review, r.created_at, to_jsonb(p) AS rater
    FROM ratings r JOIN public_user_profiles p ON p.id = r.rater_id
`;

export async function ratingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/requests/:id/ratings', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(requestParams, request.params);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<RatingRow>(
        `${RATING_SELECT} WHERE r.request_id = $1 ORDER BY r.created_at ASC`,
        [id],
      );
      return { ratings: rows.map(toRating) };
    });
  });

  app.post('/requests/:id/ratings', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(requestParams, request.params);
    const body = parseOrThrow(createRatingSchema, request.body);

    const rating = await withUserTx(request.db, user, async (tx, outbox) => {
      const { rows } = await tx.query<{
        campus_id: string;
        status: string;
        requester_id: string;
        selected_helper_id: string | null;
        title: string;
      }>(
        `SELECT campus_id, status, requester_id, selected_helper_id, title
           FROM requests WHERE id = $1`,
        [id],
      );
      const target = rows[0];
      if (!target) throw ApiError.notFound('That request is not available.');

      // Ratings unlock only once money has actually changed hands (spec §29).
      if (!['PAID', 'RATED'].includes(target.status)) {
        throw ApiError.conflict(
          'You can rate each other once the payment has been confirmed.',
          'RATING_NOT_AVAILABLE',
        );
      }

      const isRequester = target.requester_id === user.id;
      const isHelper = target.selected_helper_id === user.id;
      if (!isRequester && !isHelper) {
        throw ApiError.forbidden('Only the two students involved can rate this task.');
      }

      const rateeId = isRequester ? target.selected_helper_id : target.requester_id;
      if (!rateeId) throw ApiError.conflict('There is no one to rate on this request.', 'NO_COUNTERPARTY');

      const direction = isRequester ? 'REQUESTER_TO_HELPER' : 'HELPER_TO_REQUESTER';

      // The unique index on (request_id, rater_id) is what actually prevents
      // duplicates; this check simply produces a friendlier message first.
      const existing = await tx.query('SELECT 1 FROM ratings WHERE request_id = $1 AND rater_id = $2', [
        id,
        user.id,
      ]);
      if (existing.rows.length > 0) {
        throw ApiError.conflict('You have already rated this task.', 'ALREADY_RATED');
      }

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO ratings (campus_id, request_id, rater_id, ratee_id, direction, stars,
                              punctuality, reliability, communication, quality,
                              clear_instructions, payment_reliability, respectfulness, review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          target.campus_id,
          id,
          user.id,
          rateeId,
          direction,
          body.stars,
          // Helper dimensions only apply when rating a helper, and vice versa.
          isRequester ? (body.punctuality ?? null) : null,
          isRequester ? (body.reliability ?? null) : null,
          body.communication ?? null,
          isRequester ? (body.quality ?? null) : null,
          isRequester ? null : (body.clearInstructions ?? null),
          isRequester ? null : (body.paymentReliability ?? null),
          isRequester ? null : (body.respectfulness ?? null),
          body.review ?? null,
        ],
      );

      await notify(
        tx,
        {
          userId: rateeId,
          campusId: target.campus_id,
          type: 'RATING_CREATED',
          title: 'You received a rating',
          body: `${user.fullName} rated you ${body.stars}★ for "${target.title}".`,
          data: { requestId: id },
          preference: 'ratings',
        },
        outbox,
      );

      // When both sides have rated, the request reaches its final state.
      const completed = await maybeCompleteRating(tx, id);
      outbox.add(() =>
        publish(requestChannel(id), 'RATING_CREATED', { requestId: id, bothRated: completed }),
      );

      const { rows: created } = await tx.query<RatingRow>(`${RATING_SELECT} WHERE r.id = $1`, [
        inserted.rows[0].id,
      ]);
      return toRating(created[0]);
    });

    return reply.code(201).send({ rating });
  });

  app.get('/users/:id/ratings', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(z.object({ id: z.string().uuid() }), request.params);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<RatingRow>(
        `${RATING_SELECT} WHERE r.ratee_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [id],
      );
      return { ratings: rows.map(toRating) };
    });
  });
}
