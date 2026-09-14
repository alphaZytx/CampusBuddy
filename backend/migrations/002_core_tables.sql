-- ===========================================================================
-- 002 — Institutions, campuses, students, sessions, verification
-- ===========================================================================

CREATE TABLE institutions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  short_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE campuses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id          uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  city                    text NOT NULL DEFAULT '',
  centre_lat              double precision NOT NULL,
  centre_lng              double precision NOT NULL,
  geofence_radius_metres  integer NOT NULL DEFAULT 1500 CHECK (geofence_radius_metres BETWEEN 50 AND 50000),
  -- Email domains permitted to register against this campus.
  email_domains           text[] NOT NULL DEFAULT '{}',
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name),
  CHECK (centre_lat BETWEEN -90 AND 90),
  CHECK (centre_lng BETWEEN -180 AND 180)
);

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, code)
);

CREATE TABLE hostels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, name)
);

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id          uuid NOT NULL REFERENCES campuses(id) ON DELETE RESTRICT,
  department_id      uuid REFERENCES departments(id) ON DELETE SET NULL,
  hostel_id          uuid REFERENCES hostels(id) ON DELETE SET NULL,

  email              text NOT NULL,
  full_name          text NOT NULL CHECK (length(btrim(full_name)) >= 2),
  phone              text,
  avatar_url         text,
  bio                text,
  year_of_study      integer CHECK (year_of_study BETWEEN 1 AND 5),
  semester           integer CHECK (semester BETWEEN 1 AND 10),
  skills             text[] NOT NULL DEFAULT '{}',

  role               text NOT NULL DEFAULT 'STUDENT'
                     CHECK (role IN ('STUDENT','MODERATOR','CAMPUS_ADMIN','PLATFORM_ADMIN')),
  account_status     text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (account_status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  suspension_reason  text,

  is_verified          boolean NOT NULL DEFAULT false,
  verification_method  text CHECK (verification_method IN ('COLLEGE_EMAIL','CAMPUS_LOCATION','MANUAL_REVIEW')),
  verified_at          timestamptz,

  -- Payment details. Shown only to a counterparty at the payment stage (spec §49).
  upi_id             text,
  upi_qr_url         text,

  -- Denormalised reputation, maintained by triggers in migration 008.
  average_rating     numeric(3,2) NOT NULL DEFAULT 0 CHECK (average_rating BETWEEN 0 AND 5),
  rating_count       integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  completed_tasks    integer NOT NULL DEFAULT 0 CHECK (completed_tasks >= 0),
  cancelled_tasks    integer NOT NULL DEFAULT 0 CHECK (cancelled_tasks >= 0),
  disputed_tasks     integer NOT NULL DEFAULT 0 CHECK (disputed_tasks >= 0),
  selections_received  integer NOT NULL DEFAULT 0 CHECK (selections_received >= 0),
  selections_responded integer NOT NULL DEFAULT 0 CHECK (selections_responded >= 0),
  reliability_score  integer NOT NULL DEFAULT 60 CHECK (reliability_score BETWEEN 0 AND 100),
  total_earned_paise bigint NOT NULL DEFAULT 0 CHECK (total_earned_paise >= 0),
  badges             text[] NOT NULL DEFAULT '{}',

  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

-- Email is unique per campus and case-insensitive.
CREATE UNIQUE INDEX users_campus_email_key ON users (campus_id, lower(email));
CREATE INDEX users_campus_idx ON users (campus_id) WHERE deleted_at IS NULL;
CREATE INDEX users_role_idx ON users (campus_id, role);

-- Password hashes live in their own table which the `campusbuddy_app` role is never
-- granted any privilege on. Authentication runs in the trusted service context, so
-- even a flaw in an ordinary query path cannot read a credential.
CREATE TABLE user_credentials (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- scrypt, stored as `scrypt$N$r$p$salt$hash`. Never a plaintext password.
  password_hash  text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER campuses_set_updated_at BEFORE UPDATE ON campuses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- Availability & preferences -------------------------------------------

CREATE TABLE user_preferences (
  user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  availability          text NOT NULL DEFAULT 'AVAILABLE_NOW'
                        CHECK (availability IN ('AVAILABLE_NOW','BUSY','AVAILABLE_LATER')),
  available_until       timestamptz,
  preferred_categories  text[] NOT NULL DEFAULT '{}',
  min_reward_paise      bigint NOT NULL DEFAULT 0 CHECK (min_reward_paise >= 0),
  max_distance_metres   integer NOT NULL DEFAULT 2000 CHECK (max_distance_metres BETWEEN 50 AND 20000),
  -- Last known position, refreshed only when the student explicitly shares it.
  last_lat              double precision,
  last_lng              double precision,
  last_location_at      timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_preferences_set_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notification_preferences (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  new_matching_requests  boolean NOT NULL DEFAULT true,
  offers                 boolean NOT NULL DEFAULT true,
  chat                   boolean NOT NULL DEFAULT true,
  payments               boolean NOT NULL DEFAULT true,
  ratings                boolean NOT NULL DEFAULT true,
  rentals                boolean NOT NULL DEFAULT true,
  reminders              boolean NOT NULL DEFAULT true,
  min_reward_paise       bigint NOT NULL DEFAULT 0 CHECK (min_reward_paise >= 0),
  max_distance_metres    integer NOT NULL DEFAULT 2000,
  urgent_only            boolean NOT NULL DEFAULT false,
  quiet_hours_start      integer CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end        integer CHECK (quiet_hours_end BETWEEN 0 AND 23),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- --- Sessions --------------------------------------------------------------

-- Refresh tokens are stored only as SHA-256 hashes, so a database leak cannot be
-- replayed as a login. Rotation is enforced via `replaced_by`.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip_address   text,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- --- Verification ----------------------------------------------------------

CREATE TABLE verification_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id      uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  method         text NOT NULL CHECK (method IN ('COLLEGE_EMAIL','CAMPUS_LOCATION','MANUAL_REVIEW')),
  status         text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','VERIFIED','FAILED','EXPIRED')),
  -- OTPs are stored as salted SHA-256 hashes; the plaintext code never touches the DB.
  code_hash      text,
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  target         text,
  -- Distance from the campus centre at the moment of a location check, for auditing.
  observed_lat   double precision,
  observed_lng   double precision,
  distance_metres double precision,
  accuracy_metres double precision,
  failure_reason text,
  expires_at     timestamptz,
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_user_idx ON verification_records (user_id, created_at DESC);

-- Only one live email OTP per user at a time — resending supersedes the previous code.
CREATE UNIQUE INDEX verification_active_email_otp
  ON verification_records (user_id)
  WHERE method = 'COLLEGE_EMAIL' AND status = 'PENDING';

-- --- Uploaded files --------------------------------------------------------

CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  -- What the file is attached to, so access control can follow the parent record.
  purpose     text NOT NULL DEFAULT 'GENERAL'
              CHECK (purpose IN ('GENERAL','AVATAR','REQUEST','MESSAGE','LISTING','RENTAL_ITEM','PROOF','DISPUTE','UPI_QR')),
  is_public   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_owner_idx ON attachments (owner_id);

-- --- Favourites ------------------------------------------------------------

CREATE TABLE favourite_helpers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, helper_id),
  CHECK (user_id <> helper_id)
);

-- --- Audit log -------------------------------------------------------------

-- Append-only record of privileged actions (spec §52, §88).
CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role   text,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
