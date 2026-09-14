-- ===========================================================================
-- 003 — Categories, requests, offers, lifecycle history
-- ===========================================================================

CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  icon          text NOT NULL DEFAULT '',
  subcategories text[] NOT NULL DEFAULT '{}',
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id           uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  requester_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title               text NOT NULL CHECK (length(btrim(title)) >= 4),
  description         text NOT NULL DEFAULT '',
  category_slug       text NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
  subcategory         text,

  -- All money is integer paise. See packages/shared/src/money.ts.
  reward_paise        bigint NOT NULL CHECK (reward_paise >= 100 AND reward_paise <= 500000),
  product_cost_paise  bigint NOT NULL DEFAULT 0 CHECK (product_cost_paise >= 0),
  total_budget_paise  bigint GENERATED ALWAYS AS (reward_paise + product_cost_paise) STORED,
  max_reward_paise    bigint CHECK (max_reward_paise IS NULL OR max_reward_paise >= 100),
  auto_escalate       boolean NOT NULL DEFAULT false,
  last_escalated_at   timestamptz,

  pickup_label        text,
  pickup_lat          double precision,
  pickup_lng          double precision,
  delivery_label      text,
  delivery_lat        double precision,
  delivery_lng        double precision,
  -- Precise position, visible only to the requester and the selected helper.
  exact_lat           double precision,
  exact_lng           double precision,
  -- Coarsened copy (~110 m grid) safe to show in the public feed.
  approx_lat          double precision,
  approx_lng          double precision,

  deadline_at         timestamptz,
  scheduled_for       timestamptz,
  urgency             text NOT NULL DEFAULT 'NORMAL' CHECK (urgency IN ('NORMAL','URGENT')),
  visibility          text NOT NULL DEFAULT 'CAMPUS'
                      CHECK (visibility IN ('CAMPUS','NEARBY','HOSTEL','DEPARTMENT','YEAR','FAVOURITES')),
  -- Frozen at creation so a later profile edit cannot retroactively change who may see a request.
  visibility_hostel_id     uuid REFERENCES hostels(id) ON DELETE SET NULL,
  visibility_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  visibility_year          integer,

  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                        'OPEN','OFFERS_RECEIVED','HELPER_SELECTED','ACCEPTED','IN_PROGRESS',
                        'COMPLETED','REJECTED','PAYMENT_PENDING','PAID','RATED',
                        'CANCELLED','EXPIRED','HELPER_WITHDREW','DISPUTED')),
  selected_helper_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  selected_offer_id   uuid,
  offer_count         integer NOT NULL DEFAULT 0 CHECK (offer_count >= 0),
  view_count          integer NOT NULL DEFAULT 0,

  completion_note     text,
  completion_proof_id uuid REFERENCES attachments(id) ON DELETE SET NULL,
  cancellation_reason text,
  rejection_reason    text,

  accepted_at         timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  confirmed_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- A requester can never be their own helper (spec §94).
  CONSTRAINT requests_no_self_help CHECK (selected_helper_id IS NULL OR selected_helper_id <> requester_id),
  -- Escalation can never exceed the ceiling the requester set.
  CONSTRAINT requests_reward_within_cap CHECK (max_reward_paise IS NULL OR reward_paise <= max_reward_paise),
  CONSTRAINT requests_schedule_before_deadline
    CHECK (scheduled_for IS NULL OR deadline_at IS NULL OR scheduled_for < deadline_at)
);

CREATE TRIGGER requests_set_updated_at BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX requests_feed_idx ON requests (campus_id, status, created_at DESC);
CREATE INDEX requests_category_idx ON requests (campus_id, category_slug, status);
CREATE INDEX requests_requester_idx ON requests (requester_id, created_at DESC);
CREATE INDEX requests_helper_idx ON requests (selected_helper_id, created_at DESC)
  WHERE selected_helper_id IS NOT NULL;
CREATE INDEX requests_deadline_idx ON requests (deadline_at)
  WHERE status IN ('OPEN','OFFERS_RECEIVED','HELPER_SELECTED');
CREATE INDEX requests_scheduled_idx ON requests (scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX requests_geo_idx ON requests (campus_id, approx_lat, approx_lng)
  WHERE approx_lat IS NOT NULL;
-- Full-text search over title + description for the discover screen.
CREATE INDEX requests_search_idx ON requests
  USING gin (to_tsvector('english', title || ' ' || description));

CREATE TABLE request_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id             uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  request_id            uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  helper_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offered_reward_paise  bigint NOT NULL CHECK (offered_reward_paise >= 100 AND offered_reward_paise <= 500000),
  message               text,
  eta_minutes           integer CHECK (eta_minutes BETWEEN 1 AND 1440),
  match_score           numeric(4,3),
  distance_metres       double precision,
  status                text NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','ACCEPTED','DECLINED','WITHDRAWN','EXPIRED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- One offer per helper per request: blocks duplicate bids at the database level.
  CONSTRAINT request_offers_unique_helper UNIQUE (request_id, helper_id)
);

CREATE TRIGGER request_offers_set_updated_at BEFORE UPDATE ON request_offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The hard guarantee that a request can never have two accepted helpers (spec §67).
CREATE UNIQUE INDEX request_offers_single_accepted
  ON request_offers (request_id) WHERE status = 'ACCEPTED';

CREATE INDEX request_offers_request_idx ON request_offers (request_id, status);
CREATE INDEX request_offers_helper_idx ON request_offers (helper_id, created_at DESC);

ALTER TABLE requests
  ADD CONSTRAINT requests_selected_offer_fk
  FOREIGN KEY (selected_offer_id) REFERENCES request_offers(id) ON DELETE SET NULL;

-- Immutable audit trail of every lifecycle move.
CREATE TABLE request_status_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  action       text NOT NULL,
  actor_role   text NOT NULL,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_status_history_idx ON request_status_history (request_id, created_at);

-- Complete reward history, so escalation can be replayed and audited (spec §22).
CREATE TABLE request_reward_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_paise  bigint NOT NULL,
  to_paise    bigint NOT NULL,
  reason      text NOT NULL DEFAULT 'MANUAL' CHECK (reason IN ('MANUAL','AUTO_ESCALATION')),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (to_paise > from_paise)
);
CREATE INDEX request_reward_history_idx ON request_reward_history (request_id, created_at);

-- Private invitations for FAVOURITES-scoped requests.
CREATE TABLE request_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  helper_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, helper_id)
);

CREATE TABLE saved_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
