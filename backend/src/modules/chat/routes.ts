import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../../db/client.js';
import { z } from 'zod';
import { sendMessageSchema } from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { enforceRateLimit, RATE_LIMITS } from '../../core/rate-limit.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import { toMessage, toPublicUserFromJson, type MessageRow } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { conversationChannel, publish } from '../../realtime/hub.js';

/**
 * Request- and rental-scoped chat (spec §30).
 *
 * Authorisation is a membership lookup in `conversation_participants`, enforced by
 * RLS on both `conversations` and `messages` — so a student who is merely curious
 * about a request cannot read the conversation attached to it.
 */

const conversationParams = z.object({ id: z.string().uuid('Unknown conversation') });
const listQuery = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.body, m.shared_lat, m.shared_lng, m.created_at,
         to_jsonb(p) AS sender,
         CASE WHEN a.id IS NOT NULL THEN jsonb_build_object(
           'id', a.id, 'file_name', a.file_name,
           'mime_type', a.mime_type, 'size_bytes', a.size_bytes) END AS attachment
    FROM messages m
    JOIN public_user_profiles p ON p.id = m.sender_id
    LEFT JOIN attachments a     ON a.id = m.attachment_id
`;

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /** Every conversation the student belongs to, most recently active first. */
  app.get('/conversations', async (request) => {
    const user = requireVerified(request);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        request_id: string | null;
        rental_id: string | null;
        subject: string;
        updated_at: Date;
        unread_count: string;
        participants: unknown;
        last_message: unknown;
      }>(
        `SELECT c.id, c.request_id, c.rental_id, c.subject, c.updated_at,
                (SELECT count(*)::text FROM messages m
                  WHERE m.conversation_id = c.id
                    AND m.sender_id <> $1
                    AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
                ) AS unread_count,
                (SELECT coalesce(jsonb_agg(to_jsonb(pp)), '[]'::jsonb)
                   FROM conversation_participants op
                   JOIN public_user_profiles pp ON pp.id = op.user_id
                  WHERE op.conversation_id = c.id AND op.user_id <> $1
                ) AS participants,
                (SELECT to_jsonb(lm) || jsonb_build_object('sender', to_jsonb(lp))
                   FROM messages lm JOIN public_user_profiles lp ON lp.id = lm.sender_id
                  WHERE lm.conversation_id = c.id
                  ORDER BY lm.created_at DESC LIMIT 1
                ) AS last_message
           FROM conversations c
           JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
          ORDER BY c.updated_at DESC
          LIMIT 100`,
        [user.id],
      );

      return {
        conversations: rows.map((row) => {
          const lastMessage = row.last_message
            ? toMessage(row.last_message as unknown as MessageRow)
            : null;
          const participants = Array.isArray(row.participants)
            ? (row.participants as unknown[])
                .map(toPublicUserFromJson)
                .filter((value): value is NonNullable<typeof value> => value !== null)
            : [];
          return {
            id: row.id,
            requestId: row.request_id,
            rentalId: row.rental_id,
            subject: row.subject,
            participants,
            lastMessage,
            unreadCount: Number(row.unread_count),
            updatedAt: new Date(row.updated_at).toISOString(),
          };
        }),
      };
    });
  });

  /** Find the conversation for a request — used by the "Chat" button. */
  app.get('/requests/:id/conversation', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(z.object({ id: z.string().uuid() }), request.params);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM conversations WHERE request_id = $1',
        [id],
      );
      if (!rows[0]) {
        throw ApiError.notFound('Chat opens once a helper has been selected for this request.');
      }
      return { conversationId: rows[0].id };
    });
  });

  app.get('/conversations/:id/messages', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(conversationParams, request.params);
    const query = parseOrThrow(listQuery, request.query ?? {});

    return withUserTx(request.db, user, async (tx) => {
      await assertParticipant(tx, id, user.id);

      const params: unknown[] = [id, query.limit];
      let filter = '';
      if (query.before) {
        params.push(query.before);
        filter = 'AND m.created_at < $3';
      }

      const { rows } = await tx.query<MessageRow>(
        `${MESSAGE_SELECT} WHERE m.conversation_id = $1 ${filter}
          ORDER BY m.created_at DESC LIMIT $2`,
        params,
      );

      // Reading the thread marks it read, which is what drives the unread badge.
      await tx.query(
        'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
        [id, user.id],
      );

      return { messages: rows.reverse().map(toMessage) };
    });
  });

  app.post('/conversations/:id/messages', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(conversationParams, request.params);
    const body = parseOrThrow(sendMessageSchema, request.body);
    await enforceRateLimit(request.db, RATE_LIMITS.sendMessage, user.id, 'You are sending messages too quickly.');

    const message = await withUserTx(request.db, user, async (tx, outbox) => {
      const conversation = await assertParticipant(tx, id, user.id);
      for (const participantId of conversation.participantIds) {
        if (participantId === user.id) continue;
        const blocked = await tx.query<{ blocked: boolean }>(
          'SELECT app_users_blocked($1, $2) AS blocked',
          [user.id, participantId],
        );
        if (blocked.rows[0]?.blocked) {
          throw ApiError.forbidden('Messages are unavailable because one of you has blocked the other.');
        }
      }

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO messages (campus_id, conversation_id, sender_id, body, attachment_id, shared_lat, shared_lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          user.campusId,
          id,
          user.id,
          body.body ?? null,
          body.attachmentId ?? null,
          body.sharedLat ?? null,
          body.sharedLng ?? null,
        ],
      );
      const messageId = inserted.rows[0].id;

      // Bumping the conversation is what keeps the list ordered by recent activity.
      await tx.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [id]);
      await tx.query(
        'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
        [id, user.id],
      );

      const { rows } = await tx.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
      const created = toMessage(rows[0]);

      const preview = body.body
        ? body.body.slice(0, 120)
        : body.attachmentId
          ? 'Sent an image'
          : 'Shared their location';

      for (const participantId of conversation.participantIds) {
        if (participantId === user.id) continue;
        await notify(
          tx,
          {
            userId: participantId,
            campusId: user.campusId,
            type: 'MESSAGE_CREATED',
            title: user.fullName,
            body: preview,
            data: { conversationId: id, requestId: conversation.requestId, messageId },
            preference: 'chat',
            actorId: user.id,
          },
          outbox,
        );
      }

      outbox.add(() => publish(conversationChannel(id), 'MESSAGE_CREATED', created));
      return created;
    });

    return reply.code(201).send({ message });
  });

  app.post('/conversations/:id/read', async (request, reply) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(conversationParams, request.params);

    await withUserTx(request.db, user, async (tx) => {
      await assertParticipant(tx, id, user.id);
      await tx.query(
        'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
        [id, user.id],
      );
    });
    return reply.code(204).send();
  });
}

/** Confirms membership and returns the other participants. */
async function assertParticipant(
  tx: Queryable,
  conversationId: string,
  userId: string,
): Promise<{ participantIds: string[]; requestId: string | null }> {
  const { rows } = await tx.query<{ user_id: string; request_id: string | null }>(
    `SELECT cp.user_id, c.request_id
       FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.conversation_id = $1`,
    [conversationId],
  );
  if (rows.length === 0 || !rows.some((row) => row.user_id === userId)) {
    // RLS already hides other people's conversations; this makes the refusal explicit.
    throw ApiError.notFound('That conversation is not available.');
  }
  return {
    participantIds: rows.map((row) => row.user_id),
    requestId: rows[0].request_id,
  };
}
