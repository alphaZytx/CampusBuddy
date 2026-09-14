import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { RealtimeEvent } from '@campusbuddy/shared';
import { logger } from '../config/logger.js';
import { clearDistributedPresence, markDistributedPresence } from './distributed.js';
import type { Database } from '../db/client.js';
import { resolveAuth } from '../core/context.js';
import {
  addConnection,
  campusChannel,
  markAlive,
  removeConnection,
  sendTo,
  subscribe,
  sweepConnections,
  unsubscribe,
  userChannel,
} from './hub.js';

/**
 * WebSocket endpoint.
 *
 * A client connects once with its access token and is automatically subscribed to
 * its private channel and its campus channel. It may then ask to join a request,
 * rental or conversation channel — and every such request is authorised against the
 * database before it is honoured, so a client cannot listen in on a transaction it
 * is not part of by guessing an id.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

/** Close code the client treats as "token rejected": refresh it, then reconnect. */
export const UNAUTHORIZED_CLOSE_CODE = 4001;

interface ClientMessage {
  action?: string;
  channel?: string;
}

/** Channels a client may ask for, and how to check it is entitled to each. */
const SUBSCRIBABLE = {
  request: async (db: Database, id: string, userId: string) => {
    const { rows } = await db.query(
      'SELECT 1 FROM requests WHERE id = $1 AND (requester_id = $2 OR selected_helper_id = $2)',
      [id, userId],
    );
    return rows.length > 0;
  },
  conversation: async (db: Database, id: string, userId: string) => {
    const { rows } = await db.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
      [id, userId],
    );
    return rows.length > 0;
  },
  rental: async (db: Database, id: string, userId: string) => {
    const { rows } = await db.query(
      'SELECT 1 FROM rentals WHERE id = $1 AND (owner_id = $2 OR renter_id = $2)',
      [id, userId],
    );
    return rows.length > 0;
  },
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerWebsocket(app: FastifyInstance, db: Database): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/ws', { websocket: true }, async (socket, request) => {
    // Browsers cannot set headers on a WebSocket handshake, so the token arrives as a
    // query parameter. It is verified exactly as a bearer token would be.
    const token =
      (request.query as { token?: string } | undefined)?.token ??
      (typeof request.headers.authorization === 'string'
        ? request.headers.authorization.replace(/^Bearer\s+/i, '')
        : null);

    const auth = await resolveAuth(db, token ?? null);
    if (!auth || auth.accountStatus !== 'ACTIVE') {
      socket.close(UNAUTHORIZED_CLOSE_CODE, 'Unauthorized');
      return;
    }
    // The client may have gone away while the token was being checked.
    if (socket.readyState !== socket.OPEN) return;

    const connectionId = randomUUID();
    addConnection(connectionId, auth.id, {
      send: (data) => socket.send(data),
      close: () => socket.close(),
      ping: () => socket.ping(),
      terminate: () => socket.terminate(),
    });
    void markDistributedPresence(auth.id, connectionId).catch(() => undefined);

    // Private channel and campus channel are implied by who you are.
    subscribe(connectionId, userChannel(auth.id));
    subscribe(connectionId, campusChannel(auth.campusId));

    const connected: RealtimeEvent<{ userId: string }> = {
      event: 'CONNECTED',
      channel: userChannel(auth.id),
      payload: { userId: auth.id },
      at: new Date().toISOString(),
    };
    sendTo(connectionId, connected);

    async function handleMessage(raw: Buffer): Promise<void> {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString('utf8')) as ClientMessage;
      } catch {
        return; // Ignore malformed frames rather than dropping the connection.
      }

      if (message.action === 'ping') {
        sendTo(connectionId, {
          event: 'PONG',
          channel: 'system',
          payload: {},
          at: new Date().toISOString(),
        });
        return;
      }

      if (message.action === 'unsubscribe' && typeof message.channel === 'string') {
        unsubscribe(connectionId, message.channel);
        return;
      }

      if (message.action !== 'subscribe' || typeof message.channel !== 'string') return;

      const [kind, id] = message.channel.split(':');
      const check = SUBSCRIBABLE[kind as keyof typeof SUBSCRIBABLE];
      if (!check || !id || !UUID_PATTERN.test(id)) return;

      // Authorisation happens here, not on the client.
      const allowed = await check(db, id, auth!.id);
      if (!allowed) return;

      subscribe(connectionId, message.channel);
      sendTo(connectionId, {
        event: 'SUBSCRIBED',
        channel: message.channel,
        payload: {},
        at: new Date().toISOString(),
      });
    }

    socket.on('message', (raw: Buffer) => {
      handleMessage(raw).catch((error: Error) =>
        logger.warn('Could not handle a realtime message', { connectionId, message: error.message }),
      );
    });
    socket.on('pong', () => {
      markAlive(connectionId);
      void markDistributedPresence(auth.id, connectionId).catch(() => undefined);
    });
    socket.on('close', () => {
      removeConnection(connectionId);
      void clearDistributedPresence(auth.id, connectionId).catch(() => undefined);
    });
    socket.on('error', () => {
      removeConnection(connectionId);
      void clearDistributedPresence(auth.id, connectionId).catch(() => undefined);
    });
  });

  // Connections that stop answering pings are reaped rather than accumulating.
  const heartbeat = setInterval(() => {
    const dropped = sweepConnections();
    if (dropped > 0) logger.debug('Dropped unresponsive realtime connections', { dropped });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
  });

  logger.debug('WebSocket endpoint ready at /ws');
}
