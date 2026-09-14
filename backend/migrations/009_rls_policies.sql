-- ===========================================================================
-- 009 — Row Level Security
--
-- This is the campus isolation boundary. Every ordinary read and write runs as
-- `campusbuddy_app`, a role with no BYPASSRLS privilege, so these policies are
-- enforced by PostgreSQL itself. Frontend filtering is treated as cosmetic
-- (spec §12, §69): even a fully compromised client cannot read another campus's
-- data, insert a row it does not own, or spoof a helper.
--
-- Tables with RLS enabled and no policy for a command deny that command outright.
-- Note that `user_credentials` receives no grants at all and is unreachable here.
-- ===========================================================================

-- --- SECURITY DEFINER helpers ---------------------------------------------
-- These run as the function owner, bypassing RLS, so that a policy can consult a
-- second table without recursing back into that table's own policy.

CREATE OR REPLACE FUNCTION app_current_hostel_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT hostel_id FROM users WHERE id = app_current_user_id();
$$;

CREATE OR REPLACE FUNCTION app_current_department_id() RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT department_id FROM users WHERE id = app_current_user_id();
$$;

CREATE OR REPLACE FUNCTION app_current_year() RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT year_of_study FROM users WHERE id = app_current_user_id();
$$;

CREATE OR REPLACE FUNCTION app_is_invited_to_request(target_request uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM request_invitations
     WHERE request_id = target_request AND helper_id = app_current_user_id()
  );
$$;

CREATE OR REPLACE FUNCTION app_is_conversation_participant(target_conversation uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
     WHERE conversation_id = target_conversation AND user_id = app_current_user_id()
  );
$$;

CREATE OR REPLACE FUNCTION app_is_request_participant(target_request uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM requests
     WHERE id = target_request
       AND (requester_id = app_current_user_id() OR selected_helper_id = app_current_user_id())
  );
$$;

CREATE OR REPLACE FUNCTION app_is_rental_participant(target_rental uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM rentals
     WHERE id = target_rental
       AND (owner_id = app_current_user_id() OR renter_id = app_current_user_id())
  );
$$;

CREATE OR REPLACE FUNCTION app_is_dispute_participant(target_dispute uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM disputes
     WHERE id = target_dispute
       AND (opened_by = app_current_user_id() OR against_id = app_current_user_id())
  );
$$;

-- --- Immutability guards ---------------------------------------------------
-- An UPDATE policy can gate which rows are writable but cannot easily pin
-- individual columns. These triggers make ownership fields permanently immutable,
-- closing the "update my own row, but change who owns it" class of attack.

CREATE OR REPLACE FUNCTION guard_request_immutables() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.campus_id <> OLD.campus_id THEN
    RAISE EXCEPTION 'A request cannot be moved to a different campus';
  END IF;
  IF NEW.requester_id <> OLD.requester_id THEN
    RAISE EXCEPTION 'A request cannot change its requester';
  END IF;
  -- `total_budget_paise` needs no guard here: it is GENERATED ALWAYS AS ... STORED,
  -- so PostgreSQL itself rejects any attempt to assign it. (It must not be checked
  -- in a BEFORE trigger either, where generated columns are not yet computed.)
  RETURN NEW;
END;
$$;
CREATE TRIGGER requests_guard_immutables BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION guard_request_immutables();

CREATE OR REPLACE FUNCTION guard_payment_immutables() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payer_id <> OLD.payer_id OR NEW.payee_id <> OLD.payee_id THEN
    RAISE EXCEPTION 'A payment cannot change who is paying or being paid';
  END IF;
  IF NEW.amount_paise <> OLD.amount_paise THEN
    RAISE EXCEPTION 'A payment amount is fixed once the payment exists';
  END IF;
  IF NEW.campus_id <> OLD.campus_id THEN
    RAISE EXCEPTION 'A payment cannot be moved to a different campus';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_guard_immutables BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_immutables();

-- Ratings are a permanent record: they may be written once and never edited.
CREATE OR REPLACE FUNCTION guard_rating_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ratings cannot be modified once submitted';
END;
$$;
CREATE TRIGGER ratings_guard_immutable BEFORE UPDATE ON ratings
  FOR EACH ROW EXECUTE FUNCTION guard_rating_immutable();

CREATE OR REPLACE FUNCTION guard_user_immutables() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.campus_id <> OLD.campus_id THEN
    RAISE EXCEPTION 'A student cannot be moved to a different campus';
  END IF;
  -- Privilege escalation is impossible outside the trusted service context:
  -- role and verification changes are rejected for anyone running as campusbuddy_app.
  IF NOT app_is_service() THEN
    IF NEW.role <> OLD.role THEN
      RAISE EXCEPTION 'Roles can only be changed by an administrator';
    END IF;
    IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
       OR NEW.verification_method IS DISTINCT FROM OLD.verification_method THEN
      RAISE EXCEPTION 'Verification status is set by the verification service only';
    END IF;
    IF NEW.account_status <> OLD.account_status THEN
      RAISE EXCEPTION 'Account status can only be changed by an administrator';
    END IF;
    IF NEW.total_earned_paise <> OLD.total_earned_paise
       OR NEW.completed_tasks <> OLD.completed_tasks
       OR NEW.average_rating <> OLD.average_rating
       OR NEW.rating_count <> OLD.rating_count
       OR NEW.reliability_score <> OLD.reliability_score THEN
      RAISE EXCEPTION 'Reputation and earnings are maintained by the server';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_guard_immutables BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_user_immutables();

-- --- Grants ----------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO campusbuddy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO campusbuddy_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO campusbuddy_app;

-- Credentials are unreachable from the application role, full stop.
REVOKE ALL ON user_credentials FROM campusbuddy_app;
-- Session rows are managed exclusively by the auth service in service context.
REVOKE ALL ON sessions FROM campusbuddy_app;
REVOKE ALL ON rate_limit_events FROM campusbuddy_app;
REVOKE ALL ON schema_migrations FROM campusbuddy_app;

-- --- Reference data: readable campus-wide ---------------------------------

ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY institutions_read ON institutions FOR SELECT USING (true);

ALTER TABLE campuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY campuses_read ON campuses FOR SELECT USING (id = app_current_campus_id());

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY departments_read ON departments FOR SELECT USING (campus_id = app_current_campus_id());

ALTER TABLE hostels ENABLE ROW LEVEL SECURITY;
CREATE POLICY hostels_read ON hostels FOR SELECT USING (campus_id = app_current_campus_id());

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_read ON categories FOR SELECT USING (true);

-- --- Users -----------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Students see fellow students on their own campus, and nobody else.
CREATE POLICY users_read_same_campus ON users FOR SELECT
  USING (campus_id = app_current_campus_id() AND deleted_at IS NULL);

-- A student may only ever update their own row; the guard trigger above pins the
-- fields that must not be self-assigned.
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id() AND campus_id = app_current_campus_id());

-- --- Preferences (private) -------------------------------------------------

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_preferences_own ON user_preferences FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY user_preferences_write ON user_preferences FOR UPDATE
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY user_preferences_insert ON user_preferences FOR INSERT
  WITH CHECK (user_id = app_current_user_id());

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_own ON notification_preferences FOR SELECT
  USING (user_id = app_current_user_id());
CREATE POLICY notification_preferences_write ON notification_preferences FOR UPDATE
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY notification_preferences_insert ON notification_preferences FOR INSERT
  WITH CHECK (user_id = app_current_user_id());

-- --- Verification (private) ------------------------------------------------

ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY verification_own ON verification_records FOR SELECT
  USING (user_id = app_current_user_id() OR (app_is_staff() AND campus_id = app_current_campus_id()));

-- --- Requests --------------------------------------------------------------

ALTER TABLE requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY requests_read ON requests FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND (
    app_is_staff()
    OR requester_id = app_current_user_id()
    OR selected_helper_id = app_current_user_id()
    OR visibility IN ('CAMPUS', 'NEARBY')
    OR (visibility = 'HOSTEL'
        AND visibility_hostel_id IS NOT NULL
        AND visibility_hostel_id = app_current_hostel_id())
    OR (visibility = 'DEPARTMENT'
        AND visibility_department_id IS NOT NULL
        AND visibility_department_id = app_current_department_id())
    OR (visibility = 'YEAR'
        AND visibility_year IS NOT NULL
        AND visibility_year = app_current_year())
    OR (visibility = 'FAVOURITES' AND app_is_invited_to_request(id))
  )
);

-- A student can only ever create a request in their own name, on their own campus.
CREATE POLICY requests_insert ON requests FOR INSERT WITH CHECK (
  campus_id = app_current_campus_id() AND requester_id = app_current_user_id()
);

CREATE POLICY requests_update ON requests FOR UPDATE
  USING (
    campus_id = app_current_campus_id()
    AND (requester_id = app_current_user_id()
         OR selected_helper_id = app_current_user_id()
         OR app_is_staff())
  )
  WITH CHECK (campus_id = app_current_campus_id());

-- --- Offers ----------------------------------------------------------------

ALTER TABLE request_offers ENABLE ROW LEVEL SECURITY;

-- A helper sees their own offers; a requester sees every offer on their request.
CREATE POLICY request_offers_read ON request_offers FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND (helper_id = app_current_user_id() OR app_is_request_participant(request_id) OR app_is_staff())
);

CREATE POLICY request_offers_insert ON request_offers FOR INSERT WITH CHECK (
  campus_id = app_current_campus_id() AND helper_id = app_current_user_id()
);

CREATE POLICY request_offers_update ON request_offers FOR UPDATE
  USING (
    campus_id = app_current_campus_id()
    AND (helper_id = app_current_user_id() OR app_is_request_participant(request_id) OR app_is_staff())
  )
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE request_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_status_history_read ON request_status_history FOR SELECT
  USING (app_is_request_participant(request_id) OR app_is_staff());

ALTER TABLE request_reward_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_reward_history_read ON request_reward_history FOR SELECT USING (true);

ALTER TABLE request_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_invitations_read ON request_invitations FOR SELECT
  USING (helper_id = app_current_user_id() OR app_is_request_participant(request_id));

ALTER TABLE saved_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_requests_own ON saved_requests FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY saved_requests_insert ON saved_requests FOR INSERT WITH CHECK (user_id = app_current_user_id());
CREATE POLICY saved_requests_delete ON saved_requests FOR DELETE USING (user_id = app_current_user_id());

-- --- Favourites (private relationships) ------------------------------------

ALTER TABLE favourite_helpers ENABLE ROW LEVEL SECURITY;
-- Deliberately visible only to the owner: who you trust is nobody else's business.
CREATE POLICY favourite_helpers_own ON favourite_helpers FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY favourite_helpers_insert ON favourite_helpers FOR INSERT
  WITH CHECK (user_id = app_current_user_id() AND campus_id = app_current_campus_id());
CREATE POLICY favourite_helpers_delete ON favourite_helpers FOR DELETE USING (user_id = app_current_user_id());

-- --- Chat ------------------------------------------------------------------

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_read ON conversations FOR SELECT
  USING (app_is_conversation_participant(id) OR app_is_staff());

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_participants_read ON conversation_participants FOR SELECT
  USING (app_is_conversation_participant(conversation_id) OR app_is_staff());
CREATE POLICY conversation_participants_update ON conversation_participants FOR UPDATE
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- Only the two participants of a transaction can read its chat (spec §30).
CREATE POLICY messages_read ON messages FOR SELECT
  USING (app_is_conversation_participant(conversation_id) OR app_is_staff());
-- And a message can only be sent as yourself, into a conversation you belong to.
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  sender_id = app_current_user_id()
  AND campus_id = app_current_campus_id()
  AND app_is_conversation_participant(conversation_id)
);

-- --- Notifications ---------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

-- --- Payments --------------------------------------------------------------

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_read ON payments FOR SELECT USING (
  payer_id = app_current_user_id() OR payee_id = app_current_user_id()
  OR (app_is_staff() AND campus_id = app_current_campus_id())
);
-- Students may advance a payment's state but never create one: payments are opened
-- by the server when a request reaches PAYMENT_PENDING.
CREATE POLICY payments_update ON payments FOR UPDATE
  USING (payer_id = app_current_user_id() OR payee_id = app_current_user_id() OR app_is_staff())
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE transaction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY transaction_events_read ON transaction_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id
            AND (p.payer_id = app_current_user_id() OR p.payee_id = app_current_user_id()))
  OR app_is_staff()
);

-- --- Ratings ---------------------------------------------------------------

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
-- Reviews are public within the campus so reputation is meaningful.
CREATE POLICY ratings_read ON ratings FOR SELECT USING (campus_id = app_current_campus_id());
-- You may only submit a rating as yourself, and never about yourself.
CREATE POLICY ratings_insert ON ratings FOR INSERT WITH CHECK (
  campus_id = app_current_campus_id()
  AND rater_id = app_current_user_id()
  AND ratee_id <> app_current_user_id()
);

-- --- Marketplace -----------------------------------------------------------

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY listings_read ON listings FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND (status <> 'DRAFT' OR seller_id = app_current_user_id() OR app_is_staff())
);
CREATE POLICY listings_insert ON listings FOR INSERT
  WITH CHECK (campus_id = app_current_campus_id() AND seller_id = app_current_user_id());
CREATE POLICY listings_update ON listings FOR UPDATE
  USING (seller_id = app_current_user_id() OR app_is_staff())
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE listing_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_images_read ON listing_images FOR SELECT USING (
  EXISTS (SELECT 1 FROM listings l WHERE l.id = listing_id)
);
CREATE POLICY listing_images_insert ON listing_images FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM listings l WHERE l.id = listing_id AND l.seller_id = app_current_user_id())
);

-- --- Rentals ---------------------------------------------------------------

ALTER TABLE rental_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY rental_items_read ON rental_items FOR SELECT USING (campus_id = app_current_campus_id());
CREATE POLICY rental_items_insert ON rental_items FOR INSERT
  WITH CHECK (campus_id = app_current_campus_id() AND owner_id = app_current_user_id());
CREATE POLICY rental_items_update ON rental_items FOR UPDATE
  USING (owner_id = app_current_user_id() OR app_is_staff())
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE rental_item_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY rental_item_images_read ON rental_item_images FOR SELECT USING (
  EXISTS (SELECT 1 FROM rental_items i WHERE i.id = item_id)
);
CREATE POLICY rental_item_images_insert ON rental_item_images FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM rental_items i WHERE i.id = item_id AND i.owner_id = app_current_user_id())
);

ALTER TABLE rentals ENABLE ROW LEVEL SECURITY;
CREATE POLICY rentals_read ON rentals FOR SELECT USING (
  owner_id = app_current_user_id() OR renter_id = app_current_user_id()
  OR (app_is_staff() AND campus_id = app_current_campus_id())
);
-- A rental request is always made in your own name, and never on your own item.
CREATE POLICY rentals_insert ON rentals FOR INSERT WITH CHECK (
  campus_id = app_current_campus_id()
  AND renter_id = app_current_user_id()
  AND owner_id <> app_current_user_id()
);
CREATE POLICY rentals_update ON rentals FOR UPDATE
  USING (owner_id = app_current_user_id() OR renter_id = app_current_user_id() OR app_is_staff())
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE rental_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY rental_events_read ON rental_events FOR SELECT
  USING (app_is_rental_participant(rental_id) OR app_is_staff());

-- --- Moderation ------------------------------------------------------------

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_read ON reports FOR SELECT USING (
  reporter_id = app_current_user_id() OR (app_is_staff() AND campus_id = app_current_campus_id())
);
CREATE POLICY reports_insert ON reports FOR INSERT
  WITH CHECK (campus_id = app_current_campus_id() AND reporter_id = app_current_user_id());
CREATE POLICY reports_update ON reports FOR UPDATE
  USING (app_is_staff() AND campus_id = app_current_campus_id())
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY disputes_read ON disputes FOR SELECT USING (
  opened_by = app_current_user_id() OR against_id = app_current_user_id()
  OR (app_is_staff() AND campus_id = app_current_campus_id())
);
CREATE POLICY disputes_insert ON disputes FOR INSERT
  WITH CHECK (campus_id = app_current_campus_id() AND opened_by = app_current_user_id());
CREATE POLICY disputes_update ON disputes FOR UPDATE
  USING (app_is_staff() AND campus_id = app_current_campus_id())
  WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE dispute_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispute_evidence_read ON dispute_evidence FOR SELECT
  USING (app_is_dispute_participant(dispute_id) OR app_is_staff());
CREATE POLICY dispute_evidence_insert ON dispute_evidence FOR INSERT WITH CHECK (
  submitted_by = app_current_user_id() AND app_is_dispute_participant(dispute_id)
);

-- --- Attachments -----------------------------------------------------------

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
-- Ownership plus the `is_public` flag; download authorisation for files attached to
-- a transaction is additionally checked in the API against the parent record.
CREATE POLICY attachments_read ON attachments FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND (owner_id = app_current_user_id() OR is_public OR app_is_staff())
);
CREATE POLICY attachments_insert ON attachments FOR INSERT
  WITH CHECK (campus_id = app_current_campus_id() AND owner_id = app_current_user_id());

-- --- Audit log (staff only, append-only) -----------------------------------

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT USING (app_is_staff());
