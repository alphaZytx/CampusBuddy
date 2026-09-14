import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../core/context.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import { toNotification, type NotificationRow } from '../../core/serializers.js';

const listQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

const idParams = z.object({ id: z.string().uuid() });

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request) => {
    const user = requireAuth(request);
    const query = parseOrThrow(listQuery, request.query ?? {});

    return withUserTx(request.db, user, async (tx) => {
      const params: unknown[] = [user.id, query.limit];
      const filters: string[] = ['user_id = $1'];
      if (query.unreadOnly) filters.push('read_at IS NULL');
      if (query.before) {
        params.push(query.before);
        filters.push(`created_at < $${params.length}`);
      }

      const { rows } = await tx.query<NotificationRow>(
        `SELECT id, type, title, body, data, read_at, created_at
           FROM notifications WHERE ${filters.join(' AND ')}
          ORDER BY created_at DESC LIMIT $2`,
        params,
      );
      const unread = await tx.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [user.id],
      );

      return {
        notifications: rows.map(toNotification),
        unreadCount: Number(unread.rows[0]?.count ?? 0),
      };
    });
  });

  app.post('/:id/read', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = parseOrThrow(idParams, request.params);
    await withUserTx(request.db, user, async (tx) => {
      await tx.query(
        'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
        [id, user.id],
      );
    });
    return reply.code(204).send();
  });

  app.post('/read-all', async (request) => {
    const user = requireAuth(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rowCount } = await tx.query(
        'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
        [user.id],
      );
      return { marked: rowCount };
    });
  });
}
