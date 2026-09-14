-- ===========================================================================
-- 008 — Denormalised counters, reputation, badges
--
-- Reputation is recomputed in the database rather than the application so that
-- it stays correct no matter which code path changed the underlying counters.
-- The formula mirrors packages/shared/src/reputation.ts exactly; a test asserts
-- the two implementations agree.
--
-- These maintenance functions are SECURITY DEFINER. They update aggregates that
-- belong to *other* students -- rating a helper must update the helper's row --
-- which the RLS policy on `users` deliberately forbids for ordinary statements.
-- Running them as the owner is what lets the system keep its own bookkeeping
-- without opening a hole for users to edit each other's reputation directly.
-- `search_path` is pinned so a definer function can never be redirected.
-- ===========================================================================

CREATE OR REPLACE FUNCTION clamp01(value double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT greatest(0.0, least(1.0, value));
$$;

-- Ratings are shrunk toward a 3.5-star prior so one review cannot outrank a long
-- record, and a brand-new student is not locked out of the marketplace.
CREATE OR REPLACE FUNCTION bayesian_rating(
  average_rating double precision, rating_count integer,
  prior double precision DEFAULT 3.5, weight double precision DEFAULT 5
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN rating_count <= 0 THEN prior
              ELSE (prior * weight + average_rating * rating_count) / (weight + rating_count) END;
$$;

CREATE OR REPLACE FUNCTION refresh_user_reputation(target_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u                users%ROWTYPE;
  attempted        integer;
  completion_rate  double precision;
  dispute_rate     double precision;
  response_rate    double precision;
  adjusted_rating  double precision;
  experience       double precision;
  tenure           double precision;
  raw              double precision;
  new_badges       text[];
BEGIN
  SELECT * INTO u FROM users WHERE id = target_user;
  IF NOT FOUND THEN RETURN; END IF;

  -- Recompute the rating aggregate from the source of truth.
  SELECT COALESCE(round(avg(stars)::numeric, 2), 0), count(*)
    INTO u.average_rating, u.rating_count
    FROM ratings WHERE ratee_id = target_user;

  attempted := u.completed_tasks + u.cancelled_tasks;
  completion_rate := CASE WHEN attempted = 0 THEN 1.0 ELSE u.completed_tasks::double precision / attempted END;
  dispute_rate    := CASE WHEN u.completed_tasks = 0 THEN 0.0
                          ELSE u.disputed_tasks::double precision / u.completed_tasks END;
  response_rate   := CASE WHEN u.selections_received = 0 THEN 1.0
                          ELSE u.selections_responded::double precision / u.selections_received END;

  adjusted_rating := bayesian_rating(u.average_rating::double precision, u.rating_count);
  experience      := clamp01(u.completed_tasks::double precision / 50);
  tenure          := clamp01(EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400 / 90);

  raw := clamp01((adjusted_rating - 1) / 4) * 0.40
       + clamp01(completion_rate)          * 0.20
       + clamp01(response_rate)            * 0.10
       + experience                        * 0.15
       + tenure                            * 0.05
       + (1 - clamp01(dispute_rate))       * 0.10;

  -- Badges are additive and never revoked, so students keep what they earned.
  -- The `::text` casts matter: without them PostgreSQL cannot tell `array || element`
  -- from `array || array` and tries to parse the literal as an array.
  new_badges := u.badges;
  IF u.completed_tasks >= 1   AND NOT ('first-task'  = ANY(new_badges)) THEN new_badges := new_badges || 'first-task'::text;  END IF;
  IF u.completed_tasks >= 10  AND NOT ('ten-tasks'   = ANY(new_badges)) THEN new_badges := new_badges || 'ten-tasks'::text;   END IF;
  IF u.completed_tasks >= 50  AND NOT ('fifty-tasks' = ANY(new_badges)) THEN new_badges := new_badges || 'fifty-tasks'::text; END IF;
  IF u.completed_tasks >= 100 AND NOT ('century'     = ANY(new_badges)) THEN new_badges := new_badges || 'century'::text;     END IF;

  UPDATE users
     SET average_rating    = u.average_rating,
         rating_count      = u.rating_count,
         reliability_score = round(clamp01(raw) * 100),
         badges            = new_badges
   WHERE id = target_user;
END;
$$;

-- --- Offer counters --------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_request_offer_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target uuid := COALESCE(NEW.request_id, OLD.request_id);
BEGIN
  UPDATE requests
     SET offer_count = (SELECT count(*) FROM request_offers
                         WHERE request_id = target AND status = 'PENDING')
   WHERE id = target;
  RETURN NULL;
END;
$$;

CREATE TRIGGER request_offers_count_sync
AFTER INSERT OR UPDATE OF status OR DELETE ON request_offers
FOR EACH ROW EXECUTE FUNCTION sync_request_offer_count();

-- --- Rating aggregation ----------------------------------------------------

CREATE OR REPLACE FUNCTION on_rating_written() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM refresh_user_reputation(COALESCE(NEW.ratee_id, OLD.ratee_id));
  RETURN NULL;
END;
$$;

CREATE TRIGGER ratings_refresh_reputation
AFTER INSERT OR UPDATE OR DELETE ON ratings
FOR EACH ROW EXECUTE FUNCTION on_rating_written();

-- --- Lifecycle counters ----------------------------------------------------

CREATE OR REPLACE FUNCTION on_request_status_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NULL; END IF;

  -- A helper was chosen: they now owe a response.
  IF NEW.status = 'HELPER_SELECTED' AND NEW.selected_helper_id IS NOT NULL THEN
    UPDATE users SET selections_received = selections_received + 1
     WHERE id = NEW.selected_helper_id;
  END IF;

  -- The helper answered the selection, either way.
  IF OLD.status = 'HELPER_SELECTED' AND NEW.status IN ('ACCEPTED','OPEN')
     AND OLD.selected_helper_id IS NOT NULL THEN
    UPDATE users SET selections_responded = selections_responded + 1
     WHERE id = OLD.selected_helper_id;
  END IF;

  -- The requester confirmed the work: this is when a task counts as completed.
  IF NEW.status = 'PAYMENT_PENDING' AND OLD.status = 'COMPLETED'
     AND NEW.selected_helper_id IS NOT NULL THEN
    UPDATE users SET completed_tasks = completed_tasks + 1 WHERE id = NEW.selected_helper_id;
    PERFORM refresh_user_reputation(NEW.selected_helper_id);
  END IF;

  -- A helper who walked away from committed work.
  IF NEW.status = 'HELPER_WITHDREW' AND OLD.selected_helper_id IS NOT NULL THEN
    UPDATE users SET cancelled_tasks = cancelled_tasks + 1 WHERE id = OLD.selected_helper_id;
    PERFORM refresh_user_reputation(OLD.selected_helper_id);
  END IF;

  -- A requester who cancelled after someone had already committed.
  IF NEW.status = 'CANCELLED' AND OLD.status IN ('HELPER_SELECTED','ACCEPTED','IN_PROGRESS') THEN
    UPDATE users SET cancelled_tasks = cancelled_tasks + 1 WHERE id = NEW.requester_id;
    PERFORM refresh_user_reputation(NEW.requester_id);
  END IF;

  -- A dispute counts against both parties until it is resolved.
  IF NEW.status = 'DISPUTED' THEN
    UPDATE users SET disputed_tasks = disputed_tasks + 1 WHERE id = NEW.requester_id;
    PERFORM refresh_user_reputation(NEW.requester_id);
    IF NEW.selected_helper_id IS NOT NULL THEN
      UPDATE users SET disputed_tasks = disputed_tasks + 1 WHERE id = NEW.selected_helper_id;
      PERFORM refresh_user_reputation(NEW.selected_helper_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER requests_status_counters
AFTER UPDATE OF status ON requests
FOR EACH ROW EXECUTE FUNCTION on_request_status_change();

-- --- Earnings --------------------------------------------------------------

-- Earnings move only when the *payee* confirms the money arrived. A payer's claim
-- is never sufficient, because CampusBuddy cannot see a bank transfer (spec §35).
CREATE OR REPLACE FUNCTION on_payment_status_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NULL; END IF;

  IF NEW.status = 'PAYMENT_CONFIRMED' AND OLD.status <> 'PAYMENT_CONFIRMED' THEN
    UPDATE users SET total_earned_paise = total_earned_paise + NEW.amount_paise
     WHERE id = NEW.payee_id;
  END IF;

  IF OLD.status = 'PAYMENT_CONFIRMED' AND NEW.status = 'REFUNDED' THEN
    UPDATE users SET total_earned_paise = greatest(0, total_earned_paise - NEW.amount_paise)
     WHERE id = NEW.payee_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER payments_status_effects
AFTER UPDATE OF status ON payments
FOR EACH ROW EXECUTE FUNCTION on_payment_status_change();

-- --- Rental item availability ---------------------------------------------

CREATE OR REPLACE FUNCTION sync_rental_item_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  item uuid := COALESCE(NEW.item_id, OLD.item_id);
  live text;
BEGIN
  SELECT status INTO live FROM rentals
   WHERE item_id = item AND status IN ('RESERVED','RENTED','RETURN_PENDING')
   LIMIT 1;

  UPDATE rental_items
     SET status = CASE
                    WHEN status = 'UNLISTED' THEN 'UNLISTED'
                    WHEN live = 'RESERVED' THEN 'RESERVED'
                    WHEN live IN ('RENTED','RETURN_PENDING') THEN 'RENTED'
                    ELSE 'AVAILABLE'
                  END
   WHERE id = item;
  RETURN NULL;
END;
$$;

CREATE TRIGGER rentals_sync_item_status
AFTER INSERT OR UPDATE OF status OR DELETE ON rentals
FOR EACH ROW EXECUTE FUNCTION sync_rental_item_status();
