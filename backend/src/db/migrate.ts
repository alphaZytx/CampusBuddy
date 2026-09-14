import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../config/logger.js';
import type { Database } from './client.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

interface AppliedMigration {
  name: string;
  checksum: string;
}

/**
 * Applies every `.sql` file in `backend/migrations` in filename order, exactly once.
 *
 * Each migration runs inside its own transaction, so a failure leaves the database
 * untouched rather than half-migrated. Checksums are recorded and re-verified on every
 * boot: editing a migration that has already been applied is a hard error, because it
 * would silently produce different schemas on different machines.
 */
export async function runMigrations(db: Database): Promise<{ applied: string[] }> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  const existing = await db.query<AppliedMigration>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const appliedByName = new Map(existing.rows.map((row) => [row.name, row.checksum]));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = appliedByName.get(file);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration "${file}" has changed since it was applied.\n` +
            'Applied migrations are immutable — add a new migration instead, or run ' +
            '`npm run db:reset` to rebuild the development database from scratch.',
        );
      }
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
    });
    applied.push(file);
    logger.info('Applied migration', { migration: file });
  }

  if (applied.length === 0) logger.debug('Database schema is up to date');
  return { applied };
}
