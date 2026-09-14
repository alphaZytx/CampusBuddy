import { Capacitor } from '@capacitor/core';

/**
 * Where the CampusBuddy server is.
 *
 * In a browser the app is served by the same host as the API, so every address is
 * relative. Inside the Android app the screens are packaged with the app itself, so
 * the server's address has to be known: it is asked for on first launch, stored on
 * the device, and can be changed later without installing a new app.
 */

const STORAGE_KEY = 'campusbuddy.server';

/** A pre-filled suggestion, baked in when the APK is built (VITE_DEFAULT_SERVER). */
export const SUGGESTED_SERVER: string = import.meta.env.VITE_DEFAULT_SERVER ?? '';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** The server's origin, e.g. "https://campusbuddy.example.edu"; '' when same-origin. */
export function serverOrigin(): string {
  if (!isNativeApp()) return '';
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** False only in the Android app before a server address has been entered. */
export function hasServer(): boolean {
  return !isNativeApp() || serverOrigin() !== '';
}

export function saveServerOrigin(origin: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, origin);
  } catch {
    // Storage blocked: the address is simply asked for again next time.
  }
}

/**
 * Turns what a student typed into an origin: adds a missing scheme and drops any path,
 * so "192.168.1.20:4000", "http://192.168.1.20:4000/" and ".../api" all work.
 */
export function normaliseServer(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function apiBase(): string {
  return `${serverOrigin()}/api`;
}

export function realtimeUrl(token: string): string {
  const url = new URL('/ws', serverOrigin() || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * File links from the server are relative (`/api/uploads/…`). Inside the Android app
 * they must point at the server, or an <img> would look for the file in the app.
 */
export function withServerUrls<T>(value: T): T {
  const origin = serverOrigin();
  return origin ? (rewrite(value, origin) as T) : value;
}

function rewrite(value: unknown, origin: string): unknown {
  if (typeof value === 'string') {
    return value.startsWith('/api/uploads/') ? `${origin}${value}` : value;
  }
  if (Array.isArray(value)) return value.map((item) => rewrite(item, origin));
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = rewrite(item, origin);
    return copy;
  }
  return value;
}
