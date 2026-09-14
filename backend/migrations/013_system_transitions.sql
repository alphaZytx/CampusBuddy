-- ===========================================================================
-- 013 — System-authored transitions
--
-- Two lifecycle moves are performed by the *system* in response to a helper's
-- action rather than by a party to the request:
--
--   OPEN            -> OFFERS_RECEIVED   (the first offer arrives)
--   OFFERS_RECEIVED -> OPEN              (the last pending offer is withdrawn)
--
-- A helper is not a participant in the request, so the RLS policies on
-- `requests` and `request_status_history` correctly refuse to let them write.
-- Rather than widening those policies -- which would also let a helper edit a
-- request's title or reward -- each transition gets its own SECURITY DEFINER
-- function that can do exactly one thing and nothing else.
--
-- Each function re-derives its own preconditions, so being callable is not the
-- same as being able to misuse it: the caller must genuinely have an offer on a
-- request in their own campus.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app_mark_offers_received(target_request uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE requests
     SET status = 'OFFERS_RECEIVED'
   WHERE id = target_request
     AND status = 'OPEN'
     AND campus_id = app_current_campus_id()
     -- The caller must actually have an offer on this request.
     AND EXISTS (
       SELECT 1 FROM request_offers o
        WHERE o.request_id = target_request
          AND o.helper_id = app_current_user_id()
          AND o.status = 'PENDING'
     );

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN RETURN false; END IF;

  INSERT INTO request_status_history
    (request_id, from_status, to_status, action, actor_role, actor_id, note)
  VALUES
    (target_request, 'OPEN', 'OFFERS_RECEIVED', 'offer_received', 'SYSTEM', NULL,
     'First helper offer received');

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app_reopen_if_no_offers(target_request uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE requests
     SET status = 'OPEN'
   WHERE id = target_request
     AND status = 'OFFERS_RECEIVED'
     AND campus_id = app_current_campus_id()
     -- Only when nothing is pending any more.
     AND NOT EXISTS (
       SELECT 1 FROM request_offers o
        WHERE o.request_id = target_request AND o.status = 'PENDING'
     );

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN RETURN false; END IF;

  INSERT INTO request_status_history
    (request_id, from_status, to_status, action, actor_role, actor_id, note)
  VALUES
    (target_request, 'OFFERS_RECEIVED', 'OPEN', 'all_offers_withdrawn', 'SYSTEM', NULL,
     'All pending offers were withdrawn');

  RETURN true;
END;
$$;

-- These are the only two ways an ordinary member may touch another student's
-- request, so grant them explicitly rather than relying on the PUBLIC default.
REVOKE ALL ON FUNCTION app_mark_offers_received(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_reopen_if_no_offers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_mark_offers_received(uuid) TO campusbuddy_app;
GRANT EXECUTE ON FUNCTION app_reopen_if_no_offers(uuid) TO campusbuddy_app;
