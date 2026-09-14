import type { ApiErrorBody } from '@campusbuddy/shared';

/**
 * API client.
 *
 * Handles the two things every call needs: attaching the access token, and quietly
 * refreshing it when it expires. Concurrent 401s share a single refresh, so a screen
 * that fires several requests at once does not trigger a refresh storm — which would
 * look like token reuse to the server and log the user out.
 *
 * Only a definite refusal from the server ends a session. A dropped connection while a
 * token is being refreshed keeps the stored session.
 */

const BASE = '/api';

const STORAGE_KEY = 'campusbuddy.admin.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages, when the server rejected a form. */
  get fieldErrors(): Record<string, string> {
    const details = this.details as { fields?: Record<string, string> } | undefined;
    return details?.fields ?? {};
  }
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    // Private browsing or blocked storage: the app still works, just not across reloads.
    return null;
  }
}

export function saveSession(session: StoredSession | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: storage is a convenience, not a requirement.
  }
}

export function getAccessToken(): string | null {
  return readSession()?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return readSession()?.refreshToken ?? null;
}

/** Called when the session is beyond saving, so the app can send the user to sign in. */
let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

/** How a refresh attempt ended. */
type RefreshOutcome = 'refreshed' | 'rejected' | 'offline';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    const session = readSession();
    if (!session?.refreshToken) return 'rejected';
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (response.ok) {
        const data = (await response.json()) as StoredSession;
        saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return 'refreshed';
      }
      // Another tab may have rotated the token a moment earlier; use its session.
      const latest = readSession();
      if (latest && latest.refreshToken !== session.refreshToken) return 'refreshed';
      // Only a definite refusal ends the session; a server hiccup does not.
      if (response.status === 401 || response.status === 403) {
        saveSession(null);
        return 'rejected';
      }
      return 'offline';
    } catch {
      return 'offline';
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see the result.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

const offline = (): ApiError =>
  new ApiError(0, 'NETWORK_ERROR', 'You appear to be offline. Check your connection.');

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the automatic retry-after-refresh (used by the auth calls themselves). */
  noRetry?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const idempotencyKey =
    options.method && options.method !== 'GET' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : null;
  const send = async (): Promise<Response> => {
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    try {
      return await fetch(`${BASE}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw offline();
    }
  };

  let response = await send();

  // One transparent retry after refreshing an expired access token.
  if (response.status === 401 && !options.noRetry) {
    const outcome = await refreshAccessToken();
    if (outcome === 'refreshed') {
      response = await send();
    } else if (outcome === 'rejected') {
      saveSession(null);
      onSessionLost?.();
    } else {
      throw offline();
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Something went wrong. Please try again.',
      body?.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Ends this browser's session on the server only, using its refresh token, so staff
 * stay signed in elsewhere. Needs no valid access token.
 */
export async function endSession(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return;
  await request('/auth/logout', { method: 'POST', body: { refreshToken }, noRetry: true });
}

/** Builds a query string, dropping empty values so the URL stays readable. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
