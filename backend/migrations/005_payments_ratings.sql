-- ===========================================================================
-- 005 — Payments, transaction events, two-way ratings
-- ===========================================================================

-- CampusBuddy does not move money. It records the state of a UPI transfer that
-- happens in an external app, and treats the *payee's* confirmation as the only
-- evidence that money actually arrived (spec §35).
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id      uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  request_id     uuid REFERENCES requests(id) ON DELETE CASCADE,
  rental_id      uuid,
  payer_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payee_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_paise   bigint NOT NULL CHECK (amount_paise > 0),
  method         text NOT NULL DEFAULT 'UPI_QR' CHECK (method IN ('UPI_QR','UPI_ID','CASH','SIMULATED')),
  status         text NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN (
                   'PAYMENT_PENDING','PAYMENT_INITIATED','PAYMENT_CLAIMED',
                   'PAYMENT_CONFIRMED','PAYMENT_DISPUTED','REFUNDED')),
  reference_note text,
  -- Set when the payer says they sent the money. An unverified claim, by design.
  claimed_at     timestamptz,
  -- Set only when the payee confirms receipt. This is the authoritative signal.
  confirmed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_distinct_parties CHECK (payer_id <> payee_id),
  CONSTRAINT payments_one_subject CHECK (
    (request_id IS NOT NULL AND rental_id IS NULL) OR
    (request_id IS NULL AND rental_id IS NOT NULL)
  )
);
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- At most one payment per request, so a reward cannot be double-recorded.
CREATE UNIQUE INDEX payments_request_key ON payments (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX payments_rental_key ON payments (rental_id) WHERE rental_id IS NOT NULL;
CREATE INDEX payments_payee_idx ON payments (payee_id, status);
CREATE INDEX payments_payer_idx ON payments (payer_id, status);

-- Append-only ledger of every payment state change.
CREATE TABLE transaction_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  action       text NOT NULL,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role   text NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_events_payment_idx ON transaction_events (payment_id, created_at);

CREATE TABLE ratings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id            uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  request_id           uuid REFERENCES requests(id) ON DELETE CASCADE,
  rental_id            uuid,
  rater_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ratee_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction            text NOT NULL CHECK (direction IN ('REQUESTER_TO_HELPER','HELPER_TO_REQUESTER')),
  stars                integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  -- Helper dimensions
  punctuality          integer CHECK (punctuality BETWEEN 1 AND 5),
  reliability          integer CHECK (reliability BETWEEN 1 AND 5),
  communication        integer CHECK (communication BETWEEN 1 AND 5),
  quality              integer CHECK (quality BETWEEN 1 AND 5),
  -- Requester dimensions
  clear_instructions   integer CHECK (clear_instructions BETWEEN 1 AND 5),
  payment_reliability  integer CHECK (payment_reliability BETWEEN 1 AND 5),
  respectfulness       integer CHECK (respectfulness BETWEEN 1 AND 5),
  review               text CHECK (review IS NULL OR length(review) <= 1000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Self-rating is impossible at the database level (spec §30).
  CONSTRAINT ratings_no_self CHECK (rater_id <> ratee_id),
  CONSTRAINT ratings_one_subject CHECK (
    (request_id IS NOT NULL AND rental_id IS NULL) OR
    (request_id IS NULL AND rental_id IS NOT NULL)
  )
);

-- One rating per person per transaction — duplicates are impossible, not merely discouraged.
CREATE UNIQUE INDEX ratings_request_unique ON ratings (request_id, rater_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX ratings_rental_unique ON ratings (rental_id, rater_id) WHERE rental_id IS NOT NULL;
CREATE INDEX ratings_ratee_idx ON ratings (ratee_id, created_at DESC);
