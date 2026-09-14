-- ===========================================================================
-- 006 — Student marketplace and peer-to-peer rentals
-- ===========================================================================

CREATE TABLE listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id      uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  seller_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          text NOT NULL CHECK (length(btrim(title)) >= 3),
  description    text NOT NULL DEFAULT '',
  category_slug  text NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
  listing_type   text NOT NULL CHECK (listing_type IN ('SELL','RENT','EXCHANGE','GIVEAWAY')),
  price_paise    bigint NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  condition      text NOT NULL CHECK (condition IN ('NEW','LIKE_NEW','GOOD','FAIR','POOR')),
  status         text NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('DRAFT','ACTIVE','RESERVED','SOLD','REMOVED')),
  pickup_zone    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- A giveaway is free by definition; everything else needs a price.
  CONSTRAINT listings_giveaway_is_free CHECK (listing_type <> 'GIVEAWAY' OR price_paise = 0)
);
CREATE TRIGGER listings_set_updated_at BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX listings_feed_idx ON listings (campus_id, status, created_at DESC);
CREATE INDEX listings_category_idx ON listings (campus_id, category_slug, status);
CREATE INDEX listings_seller_idx ON listings (seller_id, created_at DESC);
CREATE INDEX listings_search_idx ON listings
  USING gin (to_tsvector('english', title || ' ' || description));

CREATE TABLE listing_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  attachment_id  uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  sort_order     integer NOT NULL DEFAULT 0,
  UNIQUE (listing_id, attachment_id)
);

CREATE TABLE rental_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id      uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(btrim(name)) >= 3),
  description    text NOT NULL DEFAULT '',
  category_slug  text NOT NULL REFERENCES categories(slug) ON UPDATE CASCADE,
  condition      text NOT NULL CHECK (condition IN ('NEW','LIKE_NEW','GOOD','FAIR','POOR')),
  price_paise    bigint NOT NULL CHECK (price_paise >= 0),
  rental_unit    text NOT NULL CHECK (rental_unit IN ('HOUR','DAY','WEEK')),
  deposit_paise  bigint NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  status         text NOT NULL DEFAULT 'AVAILABLE'
                 CHECK (status IN ('AVAILABLE','RESERVED','RENTED','UNLISTED')),
  pickup_zone    text,
  rules          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER rental_items_set_updated_at BEFORE UPDATE ON rental_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX rental_items_feed_idx ON rental_items (campus_id, status, created_at DESC);
CREATE INDEX rental_items_owner_idx ON rental_items (owner_id, created_at DESC);
CREATE INDEX rental_items_search_idx ON rental_items
  USING gin (to_tsvector('english', name || ' ' || description));

CREATE TABLE rental_item_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL REFERENCES rental_items(id) ON DELETE CASCADE,
  attachment_id  uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  sort_order     integer NOT NULL DEFAULT 0,
  UNIQUE (item_id, attachment_id)
);

CREATE TABLE rentals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id                uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  item_id                  uuid NOT NULL REFERENCES rental_items(id) ON DELETE CASCADE,
  owner_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  renter_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
                             'REQUESTED','RESERVED','RENTED','RETURN_PENDING','RETURNED',
                             'COMPLETED','CANCELLED','DECLINED','DISPUTED')),
  start_at                 timestamptz NOT NULL,
  expected_return_at       timestamptz NOT NULL,
  actual_return_at         timestamptz,
  units                    integer NOT NULL CHECK (units > 0),
  rental_fee_paise         bigint NOT NULL CHECK (rental_fee_paise >= 0),
  deposit_paise            bigint NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  deposit_returned_paise   bigint CHECK (deposit_returned_paise IS NULL OR deposit_returned_paise >= 0),
  damage_note              text,
  message                  text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentals_no_self CHECK (owner_id <> renter_id),
  CONSTRAINT rentals_period_valid CHECK (expected_return_at > start_at),
  CONSTRAINT rentals_deposit_not_over_returned
    CHECK (deposit_returned_paise IS NULL OR deposit_returned_paise <= deposit_paise)
);
CREATE TRIGGER rentals_set_updated_at BEFORE UPDATE ON rentals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An item can only be committed to one renter at a time, so overlapping bookings
-- are impossible rather than merely unlikely (spec §67).
CREATE UNIQUE INDEX rentals_one_active_per_item
  ON rentals (item_id) WHERE status IN ('RESERVED','RENTED','RETURN_PENDING');

CREATE INDEX rentals_owner_idx ON rentals (owner_id, created_at DESC);
CREATE INDEX rentals_renter_idx ON rentals (renter_id, created_at DESC);
CREATE INDEX rentals_due_idx ON rentals (expected_return_at) WHERE status = 'RENTED';

CREATE TABLE rental_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id    uuid NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  from_status  text,
  to_status    text NOT NULL,
  action       text NOT NULL,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role   text NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_events_idx ON rental_events (rental_id, created_at);

-- Deferred foreign keys: these tables were created before `rentals` existed.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_rental_fk FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE;
ALTER TABLE payments
  ADD CONSTRAINT payments_rental_fk FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE;
ALTER TABLE ratings
  ADD CONSTRAINT ratings_rental_fk FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE CASCADE;
