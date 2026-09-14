import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Signed file links.
 *
 * An `<img>` tag cannot send an Authorization header, so an image behind a bearer
 * token simply fails to load. Instead, the API hands entitled viewers a link that
 * carries its own proof: `/api/uploads/<id>?expires=<unix>&signature=<hmac>`. The
 * HMAC binds the file id to the expiry, so a link cannot be pointed at another file
 * or extended, and it is only ever minted for someone allowed to see the file.
 *
 * Expiry is rounded to the hour, so every link for the same file issued within an
 * hour is identical. That keeps `<img src>` stable across re-renders and lets the
 * browser cache the image, while still guaranteeing at least an hour of validity.
 */

const WINDOW_SECONDS = 3600;

// A key derived for this one purpose, so a file-link signature can never be
// confused with any other HMAC made from the same secret.
const signingKey = createHmac('sha256', env.JWT_SECRET)
  .update('campusbuddy:attachment-link:v1')
  .digest();

function computeSignature(attachmentId: string, expires: number): string {
  return createHmac('sha256', signingKey).update(`${attachmentId}:${expires}`).digest('base64url');
}

/** Unix seconds at which a link issued now stops working: 1–2 hours from now. */
export function attachmentLinkExpiry(now: number = Date.now()): number {
  return (Math.floor(now / 1000 / WINDOW_SECONDS) + 2) * WINDOW_SECONDS;
}

export function signAttachmentUrl(attachmentId: string, now: number = Date.now()): string {
  const expires = attachmentLinkExpiry(now);
  const signature = computeSignature(attachmentId, expires);
  return `/api/uploads/${attachmentId}?expires=${expires}&signature=${signature}`;
}

export function signedUrlOrNull(attachmentId: string | null | undefined): string | null {
  return attachmentId ? signAttachmentUrl(attachmentId) : null;
}

export function verifyAttachmentSignature(
  attachmentId: string,
  expires: number,
  signature: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now) return false;
  const expected = Buffer.from(computeSignature(attachmentId, expires), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  // Constant-time, so response timing cannot be used to guess a signature.
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
