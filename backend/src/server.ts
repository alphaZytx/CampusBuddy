import { assertProductionSafety, env } from './config/env.js';
import { logger } from './config/logger.js';
import { buildApp } from './app.js';
import { closeDatabase, getDatabase } from './db/client.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import { acceptDistributed, closeAll } from './realtime/hub.js';
import { startDistributedRealtime, stopDistributedRealtime } from './realtime/distributed.js';

assertProductionSafety();

const app = await buildApp();
const db = await getDatabase();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`CampusBuddy API listening on http://${env.HOST}:${env.PORT}`);
  logger.info(`Health check: http://${env.HOST}:${env.PORT}/api/health`);
} catch (error) {
  logger.error('Failed to start server', { message: (error as Error).message });
  process.exit(1);
}

if (env.jobsEnabled) startJobs(db);
await startDistributedRealtime(acceptDistributed);

/** Drain in-flight requests before exiting so nothing is cut off mid-transaction. */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);
  stopJobs();
  closeAll();
  await stopDistributedRealtime();
  try {
    await app.close();
    await closeDatabase();
  } catch (error) {
    logger.error('Error during shutdown', { message: (error as Error).message });
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});
