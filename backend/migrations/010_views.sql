-- ===========================================================================
-- 010 — Read models
--
-- `public_user_profiles` is the canonical "what one student may see about
-- another" projection: reputation, verification and availability, but never
-- credentials, phone number, UPI details or exact location.
--
-- `security_invoker = true` makes the view run with the *caller's* privileges, so
-- the RLS policy on `users` still applies through the view. Without it, a view
-- would quietly become a way around campus isolation.
-- ===========================================================================

CREATE VIEW public_user_profiles WITH (security_invoker = true) AS
SELECT
  u.id,
  u.campus_id,
  u.full_name,
  u.avatar_url,
  u.bio,
  d.code                        AS department_code,
  d.name                        AS department_name,
  u.department_id,
  u.hostel_id,
  u.year_of_study,
  u.is_verified,
  u.verification_method,
  u.average_rating,
  u.rating_count,
  u.completed_tasks,
  u.cancelled_tasks,
  u.disputed_tasks,
  u.reliability_score,
  u.skills,
  u.badges,
  u.role,
  u.account_status,
  u.created_at                  AS member_since,
  COALESCE(p.availability, 'AVAILABLE_NOW') AS availability,

  -- Derived reputation rates, matching packages/shared/src/reputation.ts.
  CASE WHEN (u.completed_tasks + u.cancelled_tasks) = 0 THEN 1.0
       ELSE u.completed_tasks::double precision / (u.completed_tasks + u.cancelled_tasks)
  END AS completion_rate,
  CASE WHEN (u.completed_tasks + u.cancelled_tasks) = 0 THEN 0.0
       ELSE u.cancelled_tasks::double precision / (u.completed_tasks + u.cancelled_tasks)
  END AS cancellation_rate,
  CASE WHEN u.selections_received = 0 THEN 1.0
       ELSE u.selections_responded::double precision / u.selections_received
  END AS response_rate,

  CASE
    WHEN u.completed_tasks >= 50 AND u.reliability_score >= 85 THEN 'GOLD'
    WHEN u.completed_tasks >= 20 AND u.reliability_score >= 70 THEN 'SILVER'
    WHEN u.completed_tasks >= 5                                THEN 'BRONZE'
    ELSE 'NEW'
  END AS tier
FROM users u
LEFT JOIN departments d      ON d.id = u.department_id
LEFT JOIN user_preferences p ON p.user_id = u.id
WHERE u.deleted_at IS NULL;

GRANT SELECT ON public_user_profiles TO campusbuddy_app;
