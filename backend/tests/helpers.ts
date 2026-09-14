import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { closeDatabase, getDatabase, __resetDatabaseHandleForTests } from '../src/db/client.js';
import { __clearCampusCacheForTests } from '../src/db/bootstrap.js';
import { multipartBody } from './fixtures.js';

/**
 * Shared test utilities.
 *
 * Requests go through `app.inject`, Fastify's in-process dispatcher, so the full
 * middleware stack — auth resolution, validation, error mapping and RLS — runs
 * exactly as it does over HTTP, without binding a port.
 */

export interface TestUser {
  id: string;
  email: string;
  fullName: string;
  accessToken: string;
  refreshToken: string;
}

export async function createTestApp(): Promise<FastifyInstance> {
  __resetDatabaseHandleForTests();
  __clearCampusCacheForTests();
  return buildApp();
}

export async function destroyTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
  await closeDatabase();
  __resetDatabaseHandleForTests();
  __clearCampusCacheForTests();
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export async function api<T = Record<string, unknown>>(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const response = await app.inject({
    method,
    url,
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    ...(options.body !== undefined ? { payload: options.body as object } : {}),
  });
  let body: T;
  try {
    body = response.body ? (JSON.parse(response.body) as T) : ({} as T);
  } catch {
    body = {} as T;
  }
  return { status: response.statusCode, body };
}

let counter = 0;

/** Registers a student and, unless told otherwise, verifies them by email OTP. */
export async function registerStudent(
  app: FastifyInstance,
  overrides: { fullName?: string; email?: string; password?: string; verify?: boolean } = {},
): Promise<TestUser> {
  counter += 1;
  const fullName = overrides.fullName ?? `Test Student ${counter}`;
  const email = overrides.email ?? `student.ug22.cs${counter}@nitp.ac.in`;
  const password = overrides.password ?? 'CampusBuddy@2026';

  const registered = await api<{
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  }>(app, 'POST', '/api/auth/register', { body: { fullName, email, password } });

  if (registered.status !== 201) {
    throw new Error(`Registration failed: ${JSON.stringify(registered.body)}`);
  }

  let accessToken = registered.body.accessToken;
  let refreshToken = registered.body.refreshToken;

  if (overrides.verify !== false) {
    const otp = await api<{ devCode: string }>(app, 'POST', '/api/verification/email/request', {
      token: accessToken,
      body: {},
    });
    if (!otp.body.devCode) throw new Error('Expected a development OTP to be returned');

    await api(app, 'POST', '/api/verification/email/verify', {
      token: accessToken,
      body: { code: otp.body.devCode },
    });

    // The access token embeds the verified flag, so take a fresh pair after
    // verifying. Refreshing rotates the refresh token, so keep the new one —
    // returning the spent one would look like token reuse.
    const refreshed = await api<{ accessToken: string; refreshToken: string }>(
      app, 'POST', '/api/auth/refresh', { body: { refreshToken } },
    );
    accessToken = refreshed.body.accessToken;
    refreshToken = refreshed.body.refreshToken;
  }

  return { id: registered.body.user.id, email, fullName, accessToken, refreshToken };
}

/** Promotes a student to an admin role directly, bypassing the API on purpose. */
export async function promoteToAdmin(userId: string, role = 'CAMPUS_ADMIN'): Promise<void> {
  const db = await getDatabase();
  await db.query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);
}

export function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Sends one file as multipart/form-data, the way the student app uploads images. */
export async function uploadFile<T = Record<string, unknown>>(
  app: FastifyInstance,
  method: 'POST' | 'PUT',
  url: string,
  token: string,
  file: Buffer,
  fileName: string,
  contentType: string,
): Promise<ApiResponse<T>> {
  const { payload, headers } = multipartBody(file, fileName, contentType);
  const response = await app.inject({
    method,
    url,
    payload,
    headers: { ...headers, authorization: `Bearer ${token}` },
  });
  let body: T;
  try {
    body = response.body ? (JSON.parse(response.body) as T) : ({} as T);
  } catch {
    body = {} as T;
  }
  return { status: response.statusCode, body };
}
