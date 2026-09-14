import { CATEGORIES } from '@campusbuddy/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { Database } from './client.js';

/**
 * Brings the single-campus tenant into existence and keeps it in step with the
 * environment file.
 *
 * CampusBuddy is deployed for one campus (spec §2, §126). The institution/campus
 * rows still exist as first-class records — every table is scoped by `campus_id` —
 * so the architecture stays extensible, but nothing here invites arbitrary colleges
 * to onboard themselves.
 */

export interface CampusContext {
  campusId: string;
  institutionId: string;
  name: string;
  institutionName: string;
}

/** Departments offered at NIT Patna. Editable afterwards from the admin panel. */
const DEFAULT_DEPARTMENTS: ReadonlyArray<[string, string]> = [
  ['CSE', 'Computer Science and Engineering'],
  ['ECE', 'Electronics and Communication Engineering'],
  ['EE', 'Electrical Engineering'],
  ['ME', 'Mechanical Engineering'],
  ['CE', 'Civil Engineering'],
  ['CHE', 'Chemical Science and Technology'],
  ['ARCH', 'Architecture and Planning'],
  ['PHY', 'Physics'],
  ['CHEM', 'Chemistry'],
  ['MATH', 'Mathematics'],
  ['HSS', 'Humanities and Social Sciences'],
];

/** Placeholder hostel blocks. Rename these to the real block names from the admin panel. */
const DEFAULT_HOSTELS: readonly string[] = [
  'Hostel A',
  'Hostel B',
  'Hostel C',
  'Hostel D',
  'Girls Hostel 1',
  'Girls Hostel 2',
];

export async function bootstrapCampus(db: Database): Promise<CampusContext> {
  return db.transaction(async (tx) => {
    // --- Institution -------------------------------------------------------
    const institution = await tx.query<{ id: string }>(
      `INSERT INTO institutions (name, short_name)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET short_name = EXCLUDED.short_name
       RETURNING id`,
      [env.INSTITUTION_NAME, env.INSTITUTION_SHORT_NAME],
    );
    const institutionId = institution.rows[0].id;

    // --- Campus ------------------------------------------------------------
    // The permitted email domains are re-applied from .env on every boot. So is the
    // geofence, until an administrator sets it from the admin panel: from then on
    // the panel's values win, so a restart never undoes a correction made on campus.
    const campus = await tx.query<{ id: string }>(
      `INSERT INTO campuses (institution_id, name, city, centre_lat, centre_lng,
                             geofence_radius_metres, email_domains)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (institution_id, name) DO UPDATE
         SET city = CASE WHEN campuses.geofence_set_by_admin_at IS NULL
                         THEN EXCLUDED.city ELSE campuses.city END,
             centre_lat = CASE WHEN campuses.geofence_set_by_admin_at IS NULL
                               THEN EXCLUDED.centre_lat ELSE campuses.centre_lat END,
             centre_lng = CASE WHEN campuses.geofence_set_by_admin_at IS NULL
                               THEN EXCLUDED.centre_lng ELSE campuses.centre_lng END,
             geofence_radius_metres = CASE WHEN campuses.geofence_set_by_admin_at IS NULL
                                           THEN EXCLUDED.geofence_radius_metres
                                           ELSE campuses.geofence_radius_metres END,
             email_domains = EXCLUDED.email_domains
       RETURNING id`,
      [
        institutionId,
        env.CAMPUS_NAME,
        env.CAMPUS_CITY,
        env.CAMPUS_CENTRE_LAT,
        env.CAMPUS_CENTRE_LNG,
        env.CAMPUS_GEOFENCE_RADIUS_METRES,
        env.allowedEmailDomains,
      ],
    );
    const campusId = campus.rows[0].id;

    // --- Categories --------------------------------------------------------
    for (const [index, category] of CATEGORIES.entries()) {
      await tx.query(
        `INSERT INTO categories (slug, name, icon, subcategories, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name,
               icon = EXCLUDED.icon,
               subcategories = EXCLUDED.subcategories,
               sort_order = EXCLUDED.sort_order`,
        [category.slug, category.name, category.icon, [...category.subcategories], index],
      );
    }

    // --- Departments and hostels ------------------------------------------
    // Inserted only when missing, so admin edits are never overwritten.
    for (const [code, name] of DEFAULT_DEPARTMENTS) {
      await tx.query(
        `INSERT INTO departments (campus_id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (campus_id, code) DO NOTHING`,
        [campusId, code, name],
      );
    }
    for (const name of DEFAULT_HOSTELS) {
      await tx.query(
        `INSERT INTO hostels (campus_id, name) VALUES ($1, $2)
         ON CONFLICT (campus_id, name) DO NOTHING`,
        [campusId, name],
      );
    }

    logger.info('Campus ready', {
      institution: env.INSTITUTION_SHORT_NAME,
      campus: env.CAMPUS_NAME,
      emailDomains: env.allowedEmailDomains,
    });

    return {
      campusId,
      institutionId,
      name: env.CAMPUS_NAME,
      institutionName: env.INSTITUTION_NAME,
    };
  });
}

let cached: CampusContext | null = null;

/** The active campus. Cached because it is read on nearly every request. */
export async function getCampus(db: Database): Promise<CampusContext> {
  if (cached) return cached;
  const { rows } = await db.query<{
    id: string;
    institution_id: string;
    name: string;
    institution_name: string;
  }>(
    `SELECT c.id, c.institution_id, c.name, i.name AS institution_name
       FROM campuses c JOIN institutions i ON i.id = c.institution_id
      WHERE c.name = $1 AND i.name = $2
      LIMIT 1`,
    [env.CAMPUS_NAME, env.INSTITUTION_NAME],
  );
  const row = rows[0];
  if (!row) throw new Error('Campus is not bootstrapped. Run `npm run db:migrate` first.');
  cached = {
    campusId: row.id,
    institutionId: row.institution_id,
    name: row.name,
    institutionName: row.institution_name,
  };
  return cached;
}

export function __clearCampusCacheForTests(): void {
  cached = null;
}
