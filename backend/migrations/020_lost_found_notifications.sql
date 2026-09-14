-- 020 — Independent Lost & Found notification preference
ALTER TABLE notification_preferences ADD COLUMN lost_found boolean NOT NULL DEFAULT true;

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
           WHEN 'lost_found'            THEN np.lost_found
           ELSE true
         END,
         np.quiet_hours_start,
         np.quiet_hours_end
    FROM notification_preferences np
    JOIN users u ON u.id = np.user_id
   WHERE np.user_id = recipient
     AND (app_current_campus_id() IS NULL OR u.campus_id = app_current_campus_id());
$$;
REVOKE ALL ON FUNCTION app_notification_preference(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_notification_preference(uuid, text) TO campusbuddy_app;
