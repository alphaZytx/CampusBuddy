import { env } from './env.js';

/**
 * Minimal structured logger.
 *
 * Deliberately never logs passwords, tokens, OTP hashes, or exact user coordinates
 * (spec §111). Values are redacted by key name before serialisation.
 */

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'access_token',
  'refresh_token',
  'authorization',
  'code',
  'codehash',
  'code_hash',
  'otp',
  'secret',
  'jwt_secret',
  'upiid',
  'upi_id',
  'exactlat',
  'exactlng',
  'exact_lat',
  'exact_lng',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: number = env.isTest ? LEVEL_ORDER.error : env.isProduction ? LEVEL_ORDER.info : LEVEL_ORDER.debug;

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < minLevel) return;
  const time = new Date().toISOString();
  if (env.isProduction) {
    const line = JSON.stringify({ time, level, message, ...(context ? { context: redact(context) } : {}) });
    (level === 'error' ? console.error : console.log)(line);
    return;
  }
  const colours: Record<Level, string> = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
  };
  const tag = `${colours[level]}${level.toUpperCase().padEnd(5)}\x1b[0m`;
  const suffix = context ? ` ${JSON.stringify(redact(context))}` : '';
  (level === 'error' ? console.error : console.log)(
    `\x1b[90m${time.slice(11, 19)}\x1b[0m ${tag} ${message}${suffix}`,
  );
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
