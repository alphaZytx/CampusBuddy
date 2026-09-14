import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { RealtimeEvent } from '@campusbuddy/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const CHANNEL = 'campusbuddy:realtime';
const instanceId = randomUUID();
let publisher: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;

export async function startDistributedRealtime(
  receive: (event: RealtimeEvent<unknown>) => void,
): Promise<void> {
  if (!env.REDIS_URL || publisher) return;
  const pub = createClient({ url: env.REDIS_URL });
  const sub = pub.duplicate();
  pub.on('error', (error) => logger.warn('Redis publisher error', { message: error.message }));
  sub.on('error', (error) => logger.warn('Redis subscriber error', { message: error.message }));
  await Promise.all([pub.connect(), sub.connect()]);
  await sub.subscribe(CHANNEL, (raw) => {
    try {
      const message = JSON.parse(raw) as { origin: string; event: RealtimeEvent<unknown> };
      if (message.origin !== instanceId) receive(message.event);
    } catch (error) {
      logger.warn('Ignored malformed distributed realtime event', { message: (error as Error).message });
    }
  });
  publisher = pub as RedisClientType;
  subscriber = sub as RedisClientType;
  logger.info('Distributed realtime connected');
}

export async function publishDistributed(event: RealtimeEvent<unknown>): Promise<void> {
  if (!publisher) return;
  await publisher.publish(CHANNEL, JSON.stringify({ origin: instanceId, event }));
}

/** Presence is a short Redis lease per socket, never process-local truth. */
export async function markDistributedPresence(userId: string, connectionId: string): Promise<void> {
  if (!publisher) return;
  await publisher.set(`campusbuddy:presence:${userId}:${connectionId}`, instanceId, { expiration: { type: 'EX', value: 90 } });
}

export async function clearDistributedPresence(userId: string, connectionId: string): Promise<void> {
  if (!publisher) return;
  await publisher.del(`campusbuddy:presence:${userId}:${connectionId}`);
}

export async function stopDistributedRealtime(): Promise<void> {
  const clients = [subscriber, publisher].filter((client): client is RedisClientType => client !== null);
  subscriber = null;
  publisher = null;
  await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
}
