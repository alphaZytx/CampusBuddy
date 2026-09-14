import { useEffect, useRef } from 'react';
import type { DomainEvent, RealtimeEvent } from '@campusbuddy/shared';
import { getAccessToken, renewSession } from './api';
import { realtimeUrl, withServerUrls } from './server';

/**
 * Realtime connection (spec §29).
 *
 * One WebSocket for the whole app. It reconnects with exponential backoff, and
 * resubscribes to whatever channels are still wanted, so a dropped connection
 * recovers without the student noticing.
 */

type Handler = (event: RealtimeEvent<unknown>) => void;

/** Close code the server sends when it refuses the access token (backend/src/realtime/ws.ts). */
const UNAUTHORIZED_CLOSE_CODE = 4001;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private channels = new Set<string>();
  private retries = 0;
  private reconnectTimer: number | null = null;
  private intentionallyClosed = false;

  constructor() {
    // Coming back into signal is the best moment to reconnect; there is no reason to
    // sit out the rest of a backoff delay.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.intentionallyClosed || this.socket) return;
        this.retries = 0;
        this.scheduleReconnect(0);
      });
    }
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const token = getAccessToken();
    if (!token) return;

    this.intentionallyClosed = false;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = new WebSocket(realtimeUrl(token));
    this.socket = socket;

    socket.onopen = () => {
      this.retries = 0;
      // Restore any channel subscriptions made before the connection existed.
      for (const channel of this.channels) {
        socket.send(JSON.stringify({ action: 'subscribe', channel }));
      }
    };

    socket.onmessage = (message) => {
      try {
        const event = withServerUrls(JSON.parse(message.data as string) as RealtimeEvent<unknown>);
        for (const handler of this.handlers) handler(event);
      } catch {
        // Ignore frames we cannot parse.
      }
    };

    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.intentionallyClosed) return;

      if (event.code === UNAUTHORIZED_CLOSE_CODE) {
        // Usually the access token simply expired while the app sat idle. Renew it
        // first: reconnecting with the same token would only be refused again.
        void renewSession().then((outcome) => {
          // A rejected session signs the student out, and the app then disconnects.
          if (outcome !== 'rejected' && !this.intentionallyClosed) this.scheduleReconnect();
        });
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.channels.clear();
  }

  subscribe(channel: string): void {
    this.channels.add(channel);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ action: 'subscribe', channel }));
    }
  }

  unsubscribe(channel: string): void {
    this.channels.delete(channel);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ action: 'unsubscribe', channel }));
    }
  }

  addHandler(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private scheduleReconnect(delay?: number): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    // Backoff caps at 30s so a long outage does not hammer the server.
    const wait = delay ?? Math.min(30_000, 1000 * 2 ** this.retries);
    this.retries += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }
}

export const realtime = new RealtimeClient();

/**
 * Runs `onEvent` for realtime frames, optionally after joining `channel`.
 * The callback is held in a ref so a re-render never causes a resubscribe.
 */
export function useRealtime(
  onEvent: (event: RealtimeEvent<unknown>) => void,
  options: { channel?: string; events?: readonly DomainEvent[] } = {},
): void {
  const callback = useRef(onEvent);
  callback.current = onEvent;

  const { channel } = options;
  const eventsKey = options.events ? options.events.join(',') : '';

  useEffect(() => {
    const wanted = eventsKey ? new Set(eventsKey.split(',')) : null;
    const remove = realtime.addHandler((event) => {
      if (channel && event.channel !== channel) return;
      if (wanted && !wanted.has(event.event)) return;
      callback.current(event);
    });

    if (channel) realtime.subscribe(channel);
    return () => {
      remove();
      if (channel) realtime.unsubscribe(channel);
    };
  }, [channel, eventsKey]);
}
