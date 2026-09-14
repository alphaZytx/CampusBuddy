-- ===========================================================================
-- 015 — Preferences, staff history, attachments and disputed rentals
--
-- Four problems found in review, each fixed where the rule belongs:
--
--   1. RLS keeps a student's preferences private, which is right, but it meant
--      the student whose action triggered a notification could not see the
--      recipient's settings either. Every opt-out, "busy" status and quiet-hours
--      window was silently ignored. Two narrow SECURITY DEFINER functions now
--      answer exactly the question the server needs answered, and nothing more.
--   2. Staff could not record a status change on a request they moderate.
--   3. Files referenced from requests, messages, listings, rentals and disputes
--      were never checked for ownership, and were invisible to the very people
--      they were attached for.
--   4. A disputed rental released its item for rebooking while the item could
--      still be in the renter's hands.
-- ===========================================================================

-- --- 1a. Which helpers should hear about a new request ----------------------

CREATE OR REPLACE FUNCTION app_matching_helpers(target_request uuid, max_results integer DEFAULT 40)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id
    FROM requests req
    JOIN users u ON u.campus_id = req.campus_id
    LEFT JOIN user_preferences p          ON p.user_id = u.id
    LEFT JOIN notification_preferences np ON np.user_id = u.id
   WHERE req.id = target_request
     -- Only the requester may ask, or trusted server work, which sets no user.
     AND (app_current_user_id() IS NULL OR req.requester_id = app_current_user_id())
     AND u.id <> req.requester_id
     AND u.is_verified
     AND u.account_status = 'ACTIVE'
     AND u.deleted_at IS NULL
     AND COALESCE(p.availability, 'AVAILABLE_NOW') <> 'BUSY'
     AND COALESCE(np.new_matching_requests, true)
     AND (NOT COALESCE(np.urgent_only, false) OR req.urgency = 'URGENT')
     AND req.reward_paise >= COALESCE(np.min_reward_paise, 0)
     AND (
       cardinality(COALESCE(p.preferred_categories, '{}')) = 0
       OR req.category_slug = ANY (p.preferred_categories)
     )
     AND (
       req.approx_lat IS NULL OR p.last_lat IS NULL
       OR haversine_metres(p.last_lat, p.last_lng, req.approx_lat, req.approx_lng)
          <= COALESCE(np.max_distance_metres, p.max_distance_metres, 2000)
     )
     -- Never alert someone who would not be allowed to open the request.
     AND (
       req.visibility IN ('CAMPUS', 'NEARBY')
       OR (req.visibility = 'HOSTEL'     AND u.hostel_id     = req.visibility_hostel_id)
       OR (req.visibility = 'DEPARTMENT' AND u.department_id = req.visibility_department_id)
       OR (req.visibility = 'YEAR'       AND u.year_of_study = req.visibility_year)
       OR (req.visibility = 'FAVOURITES' AND EXISTS (
             SELECT 1 FROM request_invitations i
              WHERE i.request_id = req.id AND i.helper_id = u.id))
     )
   ORDER BY
     (req.category_slug = ANY (COALESCE(p.preferred_categories, '{}'))) DESC,
     (COALESCE(p.availability, 'AVAILABLE_NOW') = 'AVAILABLE_NOW') DESC,
     u.reliability_score DESC
   LIMIT greatest(0, least(max_results, 200));
$$;

-- --- 1b. Whether a student wants one kind of notification --------------------

CREATE OR REPLACE FUNCTION app_notification_preference(recipient uuid, preference text)
RETURNS TABLE (enabled boolean, quiet_hours_start integer, quiet_hours_end integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE preference
           WHEN 'new_matching_requests' THEN np.new_matching_requests
           WHEN 'offers'                THEN np.offers
           WHEN 'chat'                  THEN np.chat
           WHEN 'payments'              THEN np.payments
           WHEN 'ratings'               THEN np.ratings
           WHEN 'rentals'               THEN np.rentals
           WHEN 'reminders'             THEN np.reminders
           ELSE true
         END,
         np.quiet_hours_start,
         np.quiet_hours_end
    FROM notification_preferences np
    JOIN users u ON u.id = np.user_id
   WHERE np.user_id = recipient
     -- Only about someone on the caller's own campus.
     AND (app_current_campus_id() IS NULL OR u.campus_id = app_current_campus_id());
$$;

REVOKE ALL ON FUNCTION app_matching_helpers(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_notification_preference(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_matching_helpers(uuid, integer) TO campusbuddy_app;
GRANT EXECUTE ON FUNCTION app_notification_preference(uuid, text) TO campusbuddy_app;

-- --- 2. Staff may record the transitions they perform -----------------------

DROP POLICY request_status_history_insert ON request_status_history;
CREATE POLICY request_status_history_insert ON request_status_history FOR INSERT
  WITH CHECK (
    app_is_request_participant(request_id)
    OR (
      app_is_staff()
      AND EXISTS (
        SELECT 1 FROM requests r
         WHERE r.id = request_id AND r.campus_id = app_current_campus_id()
      )
    )
  );

-- The requester may remove a former helper from the request's chat when a new
-- helper takes over, so the old one stops seeing the conversation.
CREATE POLICY conversation_participants_delete ON conversation_participants FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
        JOIN requests r ON r.id = c.request_id
       WHERE c.id = conversation_id AND r.requester_id = app_current_user_id()
    )
  );

-- --- 3a. A referenced file must be the referencing student's own upload -------

CREATE OR REPLACE FUNCTION guard_attachment_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_column text := TG_ARGV[0];
  referenced    uuid := (to_jsonb(NEW) ->> target_column)::uuid;
  actor         uuid := app_current_user_id();
BEGIN
  -- Nothing attached, or trusted server work (seeding, jobs), which sets no user.
  IF referenced IS NULL OR actor IS NULL THEN
    RETURN NEW;
  END IF;
  -- Saving a row again without changing its file needs no fresh check.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) ->> target_column)::uuid IS NOT DISTINCT FROM referenced THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id = referenced AND a.owner_id = actor) THEN
    RAISE EXCEPTION 'An attached file must be your own upload';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER request_attachments_guard_owner
  BEFORE INSERT OR UPDATE ON request_attachments
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');

CREATE TRIGGER messages_guard_attachment
  BEFORE INSERT OR UPDATE OF attachment_id ON messages
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');

CREATE TRIGGER listing_images_guard_owner
  BEFORE INSERT OR UPDATE ON listing_images
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');

CREATE TRIGGER rental_item_images_guard_owner
  BEFORE INSERT OR UPDATE ON rental_item_images
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');

CREATE TRIGGER dispute_evidence_guard_attachment
  BEFORE INSERT OR UPDATE OF attachment_id ON dispute_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');

CREATE TRIGGER requests_guard_completion_proof
  BEFORE INSERT OR UPDATE OF completion_proof_id ON requests
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('completion_proof_id');

-- --- 3b. A file is visible to whoever can see what it is attached to ----------
-- Each subquery runs under the viewer's own RLS on the parent table, so a file
-- inherits exactly the visibility of the request, message, listing, rental item
-- or dispute it belongs to. Permissive policies combine with OR, so this only
-- ever adds to the owner/public/staff rule in migration 009.

CREATE POLICY attachments_read_referenced ON attachments FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND (
    EXISTS (SELECT 1 FROM request_attachments ra WHERE ra.attachment_id = attachments.id)
    OR EXISTS (
      SELECT 1 FROM requests r
       WHERE r.completion_proof_id = attachments.id
         AND (r.requester_id = app_current_user_id() OR r.selected_helper_id = app_current_user_id())
    )
    OR EXISTS (SELECT 1 FROM messages m WHERE m.attachment_id = attachments.id)
    OR EXISTS (SELECT 1 FROM listing_images li WHERE li.attachment_id = attachments.id)
    OR EXISTS (SELECT 1 FROM rental_item_images ri WHERE ri.attachment_id = attachments.id)
    OR EXISTS (SELECT 1 FROM dispute_evidence e WHERE e.attachment_id = attachments.id)
  )
);

CREATE INDEX IF NOT EXISTS request_attachments_attachment_idx ON request_attachments (attachment_id);
CREATE INDEX IF NOT EXISTS messages_attachment_idx
  ON messages (attachment_id) WHERE attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS listing_images_attachment_idx ON listing_images (attachment_id);
CREATE INDEX IF NOT EXISTS rental_item_images_attachment_idx ON rental_item_images (attachment_id);
CREATE INDEX IF NOT EXISTS dispute_evidence_attachment_idx
  ON dispute_evidence (attachment_id) WHERE attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_completion_proof_idx
  ON requests (completion_proof_id) WHERE completion_proof_id IS NOT NULL;

-- --- 4. A disputed rental keeps its item out of circulation -------------------

DROP INDEX rentals_one_active_per_item;
CREATE UNIQUE INDEX rentals_one_active_per_item
  ON rentals (item_id) WHERE status IN ('RESERVED', 'RENTED', 'RETURN_PENDING', 'DISPUTED');

CREATE OR REPLACE FUNCTION sync_rental_item_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  item uuid := COALESCE(NEW.item_id, OLD.item_id);
  live text;
BEGIN
  SELECT status INTO live FROM rentals
   WHERE item_id = item AND status IN ('RESERVED', 'RENTED', 'RETURN_PENDING', 'DISPUTED')
   LIMIT 1;

  UPDATE rental_items
     SET status = CASE
                    WHEN status = 'UNLISTED' THEN 'UNLISTED'
                    WHEN live = 'RESERVED' THEN 'RESERVED'
                    WHEN live IN ('RENTED', 'RETURN_PENDING', 'DISPUTED') THEN 'RENTED'
                    ELSE 'AVAILABLE'
                  END
   WHERE id = item;
  RETURN NULL;
END;
$$;

-- --- 5. An administrator's geofence survives a restart -----------------------
-- The geofence is seeded from .env and re-applied on each boot, which silently
-- undid any correction an administrator made from the panel while standing on
-- campus. Once set there, the panel's values win (see bootstrapCampus).

ALTER TABLE campuses ADD COLUMN geofence_set_by_admin_at timestamptz;
