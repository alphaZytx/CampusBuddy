import os from 'node:os';
import path from 'node:path';

/**
 * Test environment.
 *
 * Every suite runs against a fresh in-memory PostgreSQL (PGlite), so tests never
 * touch the development database and never depend on each other's leftovers.
 * Uploaded files go to a temporary directory for the same reason.
 */
process.env.NODE_ENV = 'test';
process.env.PGLITE_DIR = 'memory://';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `campusbuddy-test-uploads-${process.pid}`);
process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-for-hs256-signing';
process.env.EMAIL_PROVIDER = 'console';
process.env.ALLOWED_EMAIL_DOMAINS = 'nitp.ac.in';
process.env.CAMPUS_CENTRE_LAT = '25.5854';
process.env.CAMPUS_CENTRE_LNG = '84.8514';
process.env.CAMPUS_GEOFENCE_RADIUS_METRES = '1500';
process.env.DISABLE_JOBS = 'true';
// Suites legitimately create dozens of accounts from one "address". The limiter
// itself is covered by a dedicated test rather than by throttling every suite.
process.env.REGISTER_RATE_LIMIT_MAX = '500';
process.env.AUTH_RATE_LIMIT_MAX = '500';
process.env.AUTH_IP_RATE_LIMIT_MAX = '500';
// Suites fire hundreds of requests per student within seconds. The per-student
// request budget has its own unit test.
process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
