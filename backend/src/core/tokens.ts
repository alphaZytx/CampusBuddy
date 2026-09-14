import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { UserRole } from '@campusbuddy/shared';
import { env } from '../config/env.js';

/**
 * Session tokens.
 *
 * Access tokens are short-lived signed JWTs carrying the identity that RLS trusts.
 * Refresh tokens are opaque random strings; only their SHA-256 hash is stored, and
 * each use rotates the token, so a stolen refresh token is detectable and single-use.
 */

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'campusbuddy';
const AUDIENCE = 'campusbuddy-app';

export interface AccessTokenClaims {
  sub: string;
  campusId: string;
  role: UserRole;
  verified: boolean;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({
    campusId: claims.campusId,
    role: claims.role,
    verified: claims.verified,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MINUTES}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.campusId !== 'string') return null;
    return {
      sub: payload.sub,
      campusId: payload.campusId,
      role: payload.role as UserRole,
      verified: payload.verified === true,
    };
  } catch {
    // Expired, tampered, wrong audience — all indistinguishable to the caller by design.
    return null;
  }
}

/** A refresh token is 48 bytes of entropy; the plaintext is returned exactly once. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function accessTokenTtlSeconds(): number {
  return env.ACCESS_TOKEN_TTL_MINUTES * 60;
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
