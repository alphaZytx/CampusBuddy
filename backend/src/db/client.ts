import type { UserRole } from '@campusbuddy/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Database access layer.
 *
 * CampusBuddy targets real PostgreSQL. Two drivers are supported behind one interface:
 *
 *  - **PGlite** (default) — PostgreSQL 18 compiled to WebAssembly, running in-process.
 *    No Docker, no server, no setup. The SQL, constraints, transactions and Row Level
 *    Security are all genuine PostgreSQL.
 *  - **node-postgres** — used when DATABASE_URL is set, for real deployments.
 *
 * Because both speak the same SQL, nothing above this file knows which one is active.
 */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

/**
 * The identity a transaction runs as. These values are pushed into PostgreSQL session
 * settings and read back by the RLS policies — they are the *only* thing the policies
 * trust, and they are always derived from a verified session token, never from a body.
 */
export interface RlsContext {
  userId: string;
  campusId: string;
  role: UserRole;
}

/** The database role that RLS policies apply to. Created by the first migration. */
export const APP_ROLE = 'campusbuddy_app';

export interface Database {
  /** Run a statement as the owner, bypassing RLS. For migrations, jobs and system writes. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  /** Transaction as the owner (RLS bypassed). Use for trusted server-side logic. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Transaction executed as `campusbuddy_app` with the caller's identity in session
   * settings, so every PostgreSQL RLS policy applies. This is the path used for
   * ordinary user-initiated reads and writes.
   */
  asUser<T>(context: RlsContext, fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: 'pglite' | 'postgres';
}

/** Escape a value for a `SET LOCAL ROLE` style statement that cannot take parameters. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function applyRlsContext(tx: Queryable, context: RlsContext): Promise<void> {
  if (!SAFE_IDENTIFIER.test(APP_ROLE)) throw new Error('Unsafe application role name');
  await tx.exec(`SET LOCAL ROLE ${APP_ROLE}`);
  // `true` makes each setting local to the transaction, so it cannot leak between
  // requests that share a pooled connection.
  await tx.query(
    `SELECT set_config('app.user_id', $1, true),
            set_config('app.campus_id', $2, true),
            set_config('app.role', $3, true)`,
    [context.userId, context.campusId, context.role],
  );
}

// ---------------------------------------------------------------------------
// PGlite driver
// ---------------------------------------------------------------------------

async function createPgliteDatabase(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdir } = await import('node:fs/promises');

  // An in-memory database is used for tests so each run starts clean and fast.
  const usingMemory = env.isTest || env.PGLITE_DIR === 'memory://';
  if (!usingMemory) await mkdir(env.pgliteDir, { recursive: true });

  const pg = await PGlite.create(usingMemory ? undefined : env.pgliteDir);
  logger.info('Database ready', {
    driver: 'pglite',
    location: usingMemory ? 'in-memory' : env.pgliteDir,
  });

  const wrap = (target: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
  }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await target.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.affectedRows ?? result.rows.length };
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  });

  const root = wrap(pg as never);

  return {
    driver: 'pglite',
    query: root.query,
    exec: root.exec,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      // PGlite serialises transactions internally, so no interleaving is possible.
      const result = await pg.transaction(async (tx) => fn(wrap(tx as never)));
      return result as T;
    },
    async asUser<T>(context: RlsContext, fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const result = await pg.transaction(async (rawTx) => {
        const tx = wrap(rawTx as never);
        await applyRlsContext(tx, context);
        return fn(tx);
      });
      return result as T;
    },
    async close() {
      await pg.close();
    },
  };
}

// ---------------------------------------------------------------------------
// node-postgres driver
// ---------------------------------------------------------------------------

async function createPostgresDatabase(connectionString: string): Promise<Database> {
  const pgModule = await import('pg');
  const Pool = pgModule.default?.Pool ?? pgModule.Pool;
  const pool = new Pool({
    connectionString,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
    application_name: 'campusbuddy-api',
  });

  // Fail fast on a bad connection string rather than at the first request.
  const probe = await pool.connect();
  probe.release();
  logger.info('Database ready', { driver: 'postgres' });

  const wrapClient = (client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const startedAt = Date.now();
      const result = await client.query(sql, params);
      const durationMs = Date.now() - startedAt;
      if (durationMs >= env.SLOW_QUERY_MS) {
        logger.warn('Slow database query', { durationMs, statement: sql.replace(/\s+/g, ' ').trim().slice(0, 180) });
      }
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });

  async function runTransaction<T>(
    fn: (tx: Queryable) => Promise<T>,
    context?: RlsContext,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = wrapClient(client);
      if (context) await applyRlsContext(tx, context);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is already broken; the pool will discard it.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    driver: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    transaction: (fn) => runTransaction(fn),
    asUser: (context, fn) => runTransaction(fn, context),
    async close() {
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------

let instance: Database | null = null;
let pending: Promise<Database> | null = null;

export async function getDatabase(): Promise<Database> {
  if (instance) return instance;
  if (!pending) {
    pending = (env.DATABASE_URL
      ? createPostgresDatabase(env.DATABASE_URL)
      : createPgliteDatabase()
    ).then((db) => {
      instance = db;
      return db;
    });
  }
  return pending;
}

export async function closeDatabase(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
    pending = null;
  }
}

/** Test-only hook so each suite can start from a pristine in-memory database. */
export function __resetDatabaseHandleForTests(): void {
  instance = null;
  pending = null;
}

export { quoteLiteral };
