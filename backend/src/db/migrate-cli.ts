import { closeDatabase, getDatabase } from './client.js';
import { runMigrations } from './migrate.js';
import { logger } from '../config/logger.js';

const db = await getDatabase();
try {
  const { applied } = await runMigrations(db);
  logger.info(
    applied.length > 0
      ? `Applied ${applied.length} migration(s).`
      : 'Database schema already up to date.',
  );
} catch (error) {
  logger.error('Migration failed', { message: (error as Error).message });
  await closeDatabase();
  process.exit(1);
}
await closeDatabase();
