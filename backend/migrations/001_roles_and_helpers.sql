-- ===========================================================================
-- 001 — Application role and shared helper functions
--
-- CampusBuddy enforces campus isolation with PostgreSQL Row Level Security.
-- All user-initiated statements run as `campusbuddy_app`, a role with no
-- BYPASSRLS privilege, carrying the caller's identity in transaction-local
-- session settings. The policies in migration 009 read those settings.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusbuddy_app') THEN
    CREATE ROLE campusbuddy_app NOLOGIN;
  END IF;
END
$$;

-- The identity of the current transaction, as set by Database.asUser().
-- Returns NULL when running as the owner (service context).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_campus_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.campus_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'STUDENT');
$$;

-- True for trusted server-side work (jobs, seeding, migrations).
--
-- Determined from the *actual* database role rather than a session variable: user
-- traffic runs after `SET LOCAL ROLE campusbuddy_app`, everything else runs as the
-- table owner. Deriving it from `current_user` means a forgotten or forged session
-- setting can never promote a request into the trusted context.
CREATE OR REPLACE FUNCTION app_is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user <> 'campusbuddy_app';
$$;

CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_current_role() IN ('MODERATOR', 'CAMPUS_ADMIN', 'PLATFORM_ADMIN');
$$;

-- Keeps `updated_at` honest without the application having to remember.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Great-circle distance in metres. Used for nearby-request queries and geofencing.
-- Haversine is accurate to well under a metre at campus scale, so PostGIS is not
-- required; the formula lives in SQL so filtering happens in the database.
CREATE OR REPLACE FUNCTION haversine_metres(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(
    least(1.0, sqrt(
        sin(radians(lat2 - lat1) / 2) ^ 2
      + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
    ))
  );
$$;
