import type { DomainEvent, RealtimeEvent } from '@campusbuddy/shared';
import { logger } from '../config/logger.js';
import { publishDistributed } from './distributed.js';

/**
 * In-process realtime hub.
 *
 * Clients open one WebSocket and are subscribed to channels. Every important
 * lifecycle change is published here so the apps update without polling (spec §29).
 *
 * Channels:
 *   user:<userId>                 private — offers, selections, payments, ratings
 *   campus:<campusId>             campus-wide — new open requests, reward changes
 *   request:<requestId>           the two participants of one request
 *   conversation:<conversationId> chat messages
 *
 * Subscriptions are authorised when they are created (see ws.ts); a socket can never
 * subscribe itself to a channel it was not cleared for.
 */

export interface Socket {
  send(data: string): void;
  close(): void;
  /** Protocol-level ping; browsers answer it automatically. */
  ping?(): void;
  /** Drops the connection without a closing handshake, for sockets that went silent. */
  terminate?(): void;
}

interface Connection {
  id: string;
  userId: string;
  socket: Socket;
  channels: Set<string>;
  isAlive: boolean;
}

const connections = new Map<string, Connection>();
const channelIndex = new Map<string, Set<string>>();

export function userChannel(userId: string): string {
  return `user:${userId}`;
}
export function campusChannel(campusId: string): string {
  return `campus:${campusId}`;
}
export function requestChannel(requestId: string): string {
  return `request:${requestId}`;
}
export function conversationChannel(conversationId: string): string {
  return `conversation:${conversationId}`;
}
export function rentalChannel(rentalId: string): string {
  return `rental:${rentalId}`;
}

export function addConnection(id: string, userId: string, socket: Socket): Connection {
  const connection: Connection = { id, userId, socket, channels: new Set(), isAlive: true };
  connections.set(id, connection);
  return connection;
}

export function removeConnection(id: string): void {
  const connection = connections.get(id);
  if (!connection) return;
  for (const channel of connection.channels) {
    const members = channelIndex.get(channel);
    members?.delete(id);
    if (members && members.size === 0) channelIndex.delete(channel);
  }
  connections.delete(id);
}

export function subscribe(connectionId: string, channel: string): void {
  const connection = connections.get(connectionId);
  if (!connection) return;
  connection.channels.add(channel);
  let members = channelIndex.get(channel);
  if (!members) {
    members = new Set();
    channelIndex.set(channel, members);
  }
  members.add(connectionId);
}

export function unsubscribe(connectionId: string, channel: string): void {
  const connection = connections.get(connectionId);
  connection?.channels.delete(channel);
  const members = channelIndex.get(channel);
  members?.delete(connectionId);
  if (members && members.size === 0) channelIndex.delete(channel);
}

export function getConnection(connectionId: string): Connection | undefined {
  return connections.get(connectionId);
}

export function listConnections(): Connection[] {
  return [...connections.values()];
}

/** Marks a connection as responsive; called whenever it answers a ping. */
export function markAlive(connectionId: string): void {
  const connection = connections.get(connectionId);
  if (connection) connection.isAlive = true;
}

/**
 * One heartbeat. A phone that loses signal never sends a closing frame, so a
 * connection that did not answer the previous ping is presumed dead and dropped —
 * otherwise such connections would pile up for as long as the server runs. Every
 * other connection is pinged again. Returns how many were dropped.
 */
export function sweepConnections(): number {
  let dropped = 0;
  for (const connection of [...connections.values()]) {
    // A socket that cannot be pinged cannot be judged; leave it to its close event.
    if (!connection.socket.ping) continue;

    if (!connection.isAlive) {
      try {
        if (connection.socket.terminate) connection.socket.terminate();
        else connection.socket.close();
      } catch {
        // Already gone.
      }
      removeConnection(connection.id);
      dropped += 1;
      continue;
    }

    connection.isAlive = false;
    try {
      connection.socket.ping();
    } catch {
      removeConnection(connection.id);
      dropped += 1;
    }
  }
  return dropped;
}

/** Closes every live connection a student has, e.g. when their account is suspended. */
export function disconnectUser(userId: string): void {
  for (const connection of [...connections.values()]) {
    if (connection.userId !== userId) continue;
    try {
      connection.socket.close();
    } catch {
      // Already gone.
    }
    removeConnection(connection.id);
  }
}

function deliver(connection: Connection, frame: string): void {
  try {
    connection.socket.send(frame);
  } catch (error) {
    logger.warn('Dropping realtime connection after send failure', {
      connectionId: connection.id,
      message: (error as Error).message,
    });
    removeConnection(connection.id);
  }
}

/** Publish an event to everyone subscribed to `channel`. */
export function publish<T>(
  channel: string,
  event: DomainEvent | 'CONNECTED' | 'PONG' | 'SUBSCRIBED',
  payload: T,
): void {
  const envelope: RealtimeEvent<T> = {
    event,
    channel,
    payload,
    at: new Date().toISOString(),
  };
  const frame = JSON.stringify(envelope);

  void publishDistributed(envelope).catch((error) =>
    logger.warn('Distributed realtime publish failed', { message: (error as Error).message }),
  );

  deliverEnvelope(frame, channel);
}

function deliverEnvelope(frame: string, channel: string): void {
  const members = channelIndex.get(channel);
  if (!members || members.size === 0) return;

  for (const connectionId of [...members]) {
    const connection = connections.get(connectionId);
    if (connection) deliver(connection, frame);
  }
}

/** Deliver a frame received from another API instance without publishing it again. */
export function acceptDistributed(event: RealtimeEvent<unknown>): void {
  deliverEnvelope(JSON.stringify(event), event.channel);
}

/** Publish to a user across every device they have open. */
export function publishToUser<T>(userId: string, event: DomainEvent, payload: T): void {
  publish(userChannel(userId), event, payload);
}

export function publishToUsers<T>(userIds: readonly string[], event: DomainEvent, payload: T): void {
  for (const userId of new Set(userIds)) publishToUser(userId, event, payload);
}

export function sendTo(connectionId: string, envelope: RealtimeEvent<unknown>): void {
  const connection = connections.get(connectionId);
  if (connection) deliver(connection, JSON.stringify(envelope));
}

export function closeAll(): void {
  for (const connection of connections.values()) {
    try {
      connection.socket.close();
    } catch {
      // Already gone.
    }
  }
  connections.clear();
  channelIndex.clear();
}

export function stats(): { connections: number; channels: number } {
  return { connections: connections.size, channels: channelIndex.size };
}
