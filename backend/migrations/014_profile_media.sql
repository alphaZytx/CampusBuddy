-- ===========================================================================
-- 014 — Profile photos and payment QR codes as managed uploads
--
-- `users.avatar_url` and `users.upi_qr_url` were free-text addresses. That let a
-- student point their avatar at any external image, which every viewer's
-- browser would then fetch — a tracking pixel. Both now reference an upload the
-- student made themselves, and the file is served through short-lived signed
-- links rather than a permanent public address.
-- ===========================================================================

-- The read model depends on avatar_url, so it is rebuilt around the new column.
DROP VIEW public_user_profiles;

ALTER TABLE users
  ADD COLUMN avatar_attachment_id uuid REFERENCES attachments(id) ON DELETE SET NULL,
  ADD COLUMN upi_qr_attachment_id uuid REFERENCES attachments(id) ON DELETE SET NULL;

ALTER TABLE users
  DROP COLUMN avatar_url,
  DROP COLUMN upi_qr_url;

-- Identical to migration 010 apart from avatar_attachment_id. The payment QR code
-- is deliberately absent: it is only ever shown to someone who owes the student
-- money, through the payments API.
CREATE VIEW public_user_profiles WITH (security_invoker = true) AS
SELECT
  u.id,
  u.campus_id,
  u.full_name,
  u.avatar_attachment_id,
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

-- A profile photo or QR code must be the student's own upload, of the right kind.
-- The API only ever sets these to a file it has just received, but this makes the
-- rule hold for every code path, including direct SQL.
CREATE OR REPLACE FUNCTION guard_user_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.avatar_attachment_id IS NOT NULL
     AND NEW.avatar_attachment_id IS DISTINCT FROM OLD.avatar_attachment_id
     AND NOT EXISTS (
       SELECT 1 FROM attachments a
        WHERE a.id = NEW.avatar_attachment_id
          AND a.owner_id = NEW.id
          AND a.purpose = 'AVATAR'
     ) THEN
    RAISE EXCEPTION 'A profile photo must be your own uploaded image';
  END IF;

  IF NEW.upi_qr_attachment_id IS NOT NULL
     AND NEW.upi_qr_attachment_id IS DISTINCT FROM OLD.upi_qr_attachment_id
     AND NOT EXISTS (
       SELECT 1 FROM attachments a
        WHERE a.id = NEW.upi_qr_attachment_id
          AND a.owner_id = NEW.id
          AND a.purpose = 'UPI_QR'
     ) THEN
    RAISE EXCEPTION 'A payment QR code must be your own uploaded image';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER users_guard_media
BEFORE UPDATE OF avatar_attachment_id, upi_qr_attachment_id ON users
FOR EACH ROW EXECUTE FUNCTION guard_user_media();
