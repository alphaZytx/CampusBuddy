import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { Database } from '../db/client.js';

interface PushPayload {
  userId: string;
  notificationId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

let configured: boolean | null = null;

function ensureFirebase(): boolean {
  if (configured !== null) return configured;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return (configured = false);
  try {
    const raw = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    const serviceAccount = {
      projectId: raw.project_id,
      clientEmail: raw.client_email,
      privateKey: raw.private_key,
    };
    if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
    configured = true;
  } catch (error) {
    configured = false;
    logger.error('Firebase push configuration is invalid', { message: (error as Error).message });
  }
  return configured;
}

function deepLink(data: Record<string, unknown>): string {
  if (typeof data.conversationId === 'string') return `/chat/${data.conversationId}`;
  if (typeof data.requestId === 'string') return `/requests/${data.requestId}`;
  if (typeof data.rentalId === 'string') return `/rentals/${data.rentalId}`;
  if (typeof data.paymentId === 'string') return `/notifications`;
  return '/notifications';
}

/** Send one persisted notification to every active device for the recipient. */
export async function sendPush(db: Database, payload: PushPayload): Promise<number> {
  if (!ensureFirebase()) return 0;
  const { rows } = await db.query<{ token: string }>(
    'SELECT token FROM push_devices WHERE user_id = $1 AND enabled ORDER BY last_seen_at DESC LIMIT 20',
    [payload.userId],
  );
  if (rows.length === 0) return 0;

  const tokens = rows.map((row) => row.token);
  const result = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: {
      notificationId: payload.notificationId,
      path: deepLink(payload.data),
      ...Object.fromEntries(
        Object.entries(payload.data).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
      ),
    },
    android: {
      priority: 'high',
      notification: { channelId: 'campusbuddy_updates', sound: 'default' },
    },
  });

  const invalidTokens = result.responses.flatMap((response, index) => {
    const code = response.error?.code ?? '';
    return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')
      ? [tokens[index]]
      : [];
  });
  if (invalidTokens.length > 0) {
    await db.query('UPDATE push_devices SET enabled = false WHERE token = ANY($1::text[])', [invalidTokens]);
  }
  return result.successCount;
}
