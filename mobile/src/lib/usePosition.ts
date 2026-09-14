import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * The student's current position, requested once per session and only if the
 * browser has already been granted permission.
 *
 * CampusBuddy never tracks continuously (spec §64) — this asks for a single fix
 * so distances and nearby ranking work, and does nothing at all if permission
 * has not been given.
 */

export interface Position {
  lat: number;
  lng: number;
}

let cached: Position | null = null;
let attempted = false;

export function usePosition(): Position | null {
  const [position, setPosition] = useState<Position | null>(cached);

  useEffect(() => {
    if (cached || attempted || !('geolocation' in navigator)) return;
    attempted = true;

    const read = (): void => {
      navigator.geolocation.getCurrentPosition(
        (result) => {
          const next = { lat: result.coords.latitude, lng: result.coords.longitude };
          cached = next;
          setPosition(next);
          // Shared with the server so matching and notifications can use distance.
          void api.post('/users/me/location', next).catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
      );
    };

    // Only read when permission is already granted, so opening the app never
    // triggers an unexplained permission prompt.
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          if (status.state === 'granted') read();
        })
        .catch(() => undefined);
    }
  }, []);

  return position;
}

/** Explicitly asks for location, for the places where the student opted in. */
export async function requestPosition(): Promise<Position | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((resolve) => {
    // The browser's own timeout only starts once permission is granted, so a
    // permission prompt left unanswered would otherwise hold the caller forever.
    const giveUp = window.setTimeout(() => resolve(null), 15_000);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        window.clearTimeout(giveUp);
        cached = { lat: result.coords.latitude, lng: result.coords.longitude };
        resolve(cached);
      },
      () => {
        window.clearTimeout(giveUp);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  });
}
