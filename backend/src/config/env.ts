import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');

// Load the repo-root .env once, before anything reads process.env.
const envPath = path.join(REPO_ROOT, '.env');
if (existsSync(envPath)) loadDotenv({ path: envPath });

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const booleanish = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
  .pipe(z.boolean());

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  // The student app and admin panel in development, and the Android app, whose screens
  // are served from http://localhost inside the app itself.
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost'),
  // How many reverse proxies (nginx, Caddy, a load balancer) sit in front of the API.
  // 0 means none: the connecting address is the client, and X-Forwarded-For is
  // ignored, so a client cannot pick its own address to slip past rate limits.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./backend/.data/campusbuddy'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  SLOW_QUERY_MS: z.coerce.number().int().min(10).default(500),

  JWT_SECRET: z.string().default('dev-only-insecure-secret-change-me-before-deploying-campusbuddy'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).default(30),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  INSTITUTION_NAME: z.string().default('National Institute of Technology Patna'),
  INSTITUTION_SHORT_NAME: z.string().default('NIT Patna'),
  CAMPUS_NAME: z.string().default('Bihta Campus'),
  CAMPUS_CITY: z.string().default('Bihta, Patna, Bihar'),
  CAMPUS_CENTRE_LAT: z.coerce.number().min(-90).max(90).default(25.5854),
  CAMPUS_CENTRE_LNG: z.coerce.number().min(-180).max(180).default(84.8514),
  CAMPUS_GEOFENCE_RADIUS_METRES: z.coerce.number().int().min(50).max(50_000).default(1500),
  // Quiet hours and reminder times are read in the campus's own timezone, whatever
  // timezone the server itself runs in.
  CAMPUS_TIMEZONE: z
    .string()
    .refine(isTimeZone, 'CAMPUS_TIMEZONE must be an IANA timezone such as Asia/Kolkata')
    .default('Asia/Kolkata'),
  ALLOWED_EMAIL_DOMAINS: z.string().default('nitp.ac.in'),
  STUDENT_EMAIL_PATTERN: z.string().default('^[a-z0-9]+([._][a-z0-9]+)*@'),

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('CampusBuddy <no-reply@example.com>'),

  // The student app asks for a six-digit code, so the length is fixed, not tunable.
  OTP_LENGTH: z.coerce
    .number()
    .int()
    .min(6, 'OTP_LENGTH must be 6: the app asks for a 6-digit code')
    .max(6, 'OTP_LENGTH must be 6: the app asks for a 6-digit code')
    .default(6),
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
  OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),

  UPLOAD_DIR: z.string().default('./backend/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(5 * 1024 * 1024),
  USER_UPLOAD_QUOTA_BYTES: z.coerce.number().int().min(1024).default(200 * 1024 * 1024),
  CAMPUS_UPLOAD_QUOTA_BYTES: z.coerce.number().int().min(1024).default(20 * 1024 * 1024 * 1024),
  MALWARE_SCAN_URL: z.string().default(''),
  MALWARE_SCAN_TOKEN: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: booleanish.optional(),

  REDIS_URL: z.string().default(''),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().default(''),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  // Requests per signed-in student per window, across the whole API.
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(300),
  // Sign-in attempts per account per 5 minutes: the brute-force guard.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  // Sign-in attempts per network address per 5 minutes. Far looser than the
  // per-account limit, because a whole hostel can share one campus Wi-Fi address.
  AUTH_IP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  // Accounts created per network address per hour.
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),

  JOB_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  LOCATION_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  CHAT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
  SAFETY_RETENTION_DAYS: z.coerce.number().int().min(365).default(730),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(7).default(180),
  AUTO_ESCALATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(10),
  AUTO_ESCALATION_STEP_PERCENT: z.coerce.number().int().min(1).max(200).default(20),
  MAX_OPEN_REQUESTS_PER_USER: z.coerce.number().int().min(1).default(10),

  SEED_PASSWORD: z.string().default('CampusBuddy@2026'),
  DISABLE_JOBS: booleanish.optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}
const raw = parsed.data;

const resolvePath = (p: string): string => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: csv(raw.CORS_ORIGINS),
  allowedEmailDomains: csv(raw.ALLOWED_EMAIL_DOMAINS).map((d) => d.toLowerCase()),
  pgliteDir: resolvePath(raw.PGLITE_DIR),
  uploadDir: resolvePath(raw.UPLOAD_DIR),
  jobsEnabled: raw.DISABLE_JOBS !== true && raw.NODE_ENV !== 'test',
} as const;

/**
 * Fail fast on configuration that is safe in development but dangerous in production.
 * Called from the server entrypoint, not at import time, so tests can import freely.
 */
export function assertProductionSafety(): void {
  if (!env.isProduction) return;
  const problems: string[] = [];
  if (env.JWT_SECRET.startsWith('dev-only-')) {
    problems.push('JWT_SECRET is still the development default. Generate a real secret.');
  }
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is required in production; PGlite is for local development only.');
  }
  if (!env.S3_BUCKET) {
    problems.push('S3_BUCKET is required in production so uploads survive API restarts and scale-out.');
  }
  if (!env.MALWARE_SCAN_URL) {
    problems.push('MALWARE_SCAN_URL is required in production for uploaded-file scanning.');
  }
  if (!env.REDIS_URL) {
    problems.push('REDIS_URL is required in production for cross-instance realtime delivery.');
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    problems.push('FIREBASE_SERVICE_ACCOUNT_JSON is required in production for background push delivery.');
  }
  if (env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters.');
  }
  if (env.EMAIL_PROVIDER === 'console') {
    problems.push('EMAIL_PROVIDER=console cannot deliver verification codes in production.');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_HOST) {
    problems.push('EMAIL_PROVIDER=smtp requires SMTP_HOST.');
  }
  if (env.EMAIL_PROVIDER === 'smtp' && /@example\.(com|org|net)\b/i.test(env.SMTP_FROM)) {
    problems.push('SMTP_FROM still uses the example.com placeholder; mail from it will be rejected.');
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

export type Env = typeof env;
