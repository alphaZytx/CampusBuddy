import { env } from '../config/env.js';

/**
 * Campus-local time.
 *
 * Servers usually run in UTC, but students live on Indian Standard Time. Anything a
 * student reads as a clock time — quiet hours, "due back at 5:30 pm" — is worked out
 * in the campus's own timezone, so it stays right wherever the API is hosted.
 */

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: env.CAMPUS_TIMEZONE,
});

const clockFormatter = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: env.CAMPUS_TIMEZONE,
});

/** The hour of the day (0–23) on campus. */
export function campusHour(date: Date = new Date()): number {
  return Number(hourFormatter.format(date)) % 24;
}

/** A clock time as a student on campus would read it, e.g. "5:30 pm". */
export function formatCampusTime(date: Date): string {
  return clockFormatter.format(date);
}
