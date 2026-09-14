/**
 * Geospatial helpers.
 *
 * The MVP uses a circular geofence (centre + radius) as described in the spec.
 * Haversine is accurate to well under a metre at campus scale, which is far more
 * precision than consumer GPS provides, so PostGIS is not required here.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METRES = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two coordinates, in metres. */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` lies inside the circular geofence. */
export function isInsideGeofence(point: LatLng, centre: LatLng, radiusMetres: number): boolean {
  return haversineMetres(point, centre) <= radiusMetres;
}

/** Valid latitude/longitude check — rejects the common (0,0) "null island" GPS failure too. */
export function isValidCoordinate(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    !(point.lat === 0 && point.lng === 0)
  );
}

/**
 * Round a coordinate to a coarse grid so it can be shown publicly without
 * revealing a student's exact position. ~3 decimal places ≈ 110 m of ambiguity.
 */
export function fuzzCoordinate(point: LatLng, decimals = 3): LatLng {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(point.lat * factor) / factor,
    lng: Math.round(point.lng * factor) / factor,
  };
}

/** Human-friendly distance label used on request cards: "350 m", "1.2 km". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
