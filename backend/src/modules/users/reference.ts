import type { FastifyInstance } from 'fastify';
import { CATEGORIES } from '@campusbuddy/shared';
import { getCampus } from '../../db/bootstrap.js';

/**
 * Public reference data.
 *
 * Available without a session so the registration form can populate its department
 * and hostel pickers, and so the landing screen can name the campus.
 */
export async function referenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/campus', async (request) => {
    const campus = await getCampus(request.db);
    const { rows } = await request.db.query<{
      id: string;
      name: string;
      city: string;
      centre_lat: number;
      centre_lng: number;
      geofence_radius_metres: number;
      email_domains: string[];
      institution_name: string;
      institution_short_name: string;
    }>(
      `SELECT c.id, c.name, c.city, c.centre_lat, c.centre_lng, c.geofence_radius_metres,
              c.email_domains, i.name AS institution_name, i.short_name AS institution_short_name
         FROM campuses c JOIN institutions i ON i.id = c.institution_id
        WHERE c.id = $1`,
      [campus.campusId],
    );
    const row = rows[0];

    const departments = await request.db.query(
      'SELECT id, code, name FROM departments WHERE campus_id = $1 ORDER BY code',
      [campus.campusId],
    );
    const hostels = await request.db.query(
      'SELECT id, name FROM hostels WHERE campus_id = $1 ORDER BY name',
      [campus.campusId],
    );

    return {
      campus: {
        id: row.id,
        name: row.name,
        city: row.city,
        institutionName: row.institution_name,
        institutionShortName: row.institution_short_name,
        centreLat: row.centre_lat,
        centreLng: row.centre_lng,
        geofenceRadiusMetres: row.geofence_radius_metres,
        emailDomains: row.email_domains,
      },
      departments: departments.rows,
      hostels: hostels.rows,
    };
  });

  app.get('/categories', async () => ({ categories: CATEGORIES }));
}
