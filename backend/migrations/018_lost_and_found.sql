-- 018 — Dedicated campus Lost & Found with private ownership verification

ALTER TABLE attachments DROP CONSTRAINT attachments_purpose_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_purpose_check
  CHECK (purpose IN ('GENERAL','AVATAR','REQUEST','MESSAGE','LISTING','RENTAL_ITEM','PROOF','DISPUTE','REPORT','UPI_QR','LOST_FOUND'));

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('USER','REQUEST','LISTING','RENTAL_ITEM','MESSAGE','PAYMENT','LOST_FOUND'));

CREATE TABLE lost_found_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_type text NOT NULL CHECK (post_type IN ('LOST','FOUND')),
  title text NOT NULL CHECK (length(btrim(title)) >= 3),
  description text NOT NULL CHECK (length(btrim(description)) >= 5),
  category text NOT NULL CHECK (category IN ('ID_AND_CARDS','ELECTRONICS','KEYS','BOOKS_AND_NOTES','BAGS','CLOTHING','ACCESSORIES','SPORTS','OTHER')),
  color text,
  brand text,
  approximate_location text NOT NULL,
  occurred_at timestamptz NOT NULL,
  verification_question text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MATCHED','RETURNED','CLOSED','EXPIRED')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER lost_found_posts_set_updated_at BEFORE UPDATE ON lost_found_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX lost_found_feed_idx ON lost_found_posts (campus_id, status, post_type, created_at DESC);
CREATE INDEX lost_found_author_idx ON lost_found_posts (author_id, created_at DESC);
CREATE INDEX lost_found_expiry_idx ON lost_found_posts (expires_at) WHERE status IN ('OPEN','MATCHED');
CREATE INDEX lost_found_search_idx ON lost_found_posts USING gin
  (to_tsvector('english', title || ' ' || description || ' ' || coalesce(brand,'') || ' ' || coalesce(color,'')));

CREATE TABLE lost_found_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES lost_found_posts(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (post_id, attachment_id)
);
CREATE INDEX lost_found_images_attachment_idx ON lost_found_images (attachment_id);

CREATE TABLE lost_found_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES lost_found_posts(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL,
  verification_answer text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, claimant_id)
);
CREATE TRIGGER lost_found_claims_set_updated_at BEFORE UPDATE ON lost_found_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX lost_found_claims_post_idx ON lost_found_claims (post_id, status, created_at DESC);
CREATE INDEX lost_found_claims_claimant_idx ON lost_found_claims (claimant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON lost_found_posts, lost_found_images, lost_found_claims TO campusbuddy_app;

ALTER TABLE lost_found_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY lost_found_posts_read ON lost_found_posts FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND NOT app_users_blocked(app_current_user_id(), author_id)
);
CREATE POLICY lost_found_posts_insert ON lost_found_posts FOR INSERT WITH CHECK (
  campus_id = app_current_campus_id() AND author_id = app_current_user_id()
);
CREATE POLICY lost_found_posts_update ON lost_found_posts FOR UPDATE USING (
  author_id = app_current_user_id() OR app_is_staff()
) WITH CHECK (campus_id = app_current_campus_id());

ALTER TABLE lost_found_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY lost_found_images_read ON lost_found_images FOR SELECT USING (
  EXISTS (SELECT 1 FROM lost_found_posts p WHERE p.id = post_id)
);
CREATE POLICY lost_found_images_insert ON lost_found_images FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM lost_found_posts p WHERE p.id = post_id AND p.author_id = app_current_user_id())
);

ALTER TABLE lost_found_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY lost_found_claims_read ON lost_found_claims FOR SELECT USING (
  claimant_id = app_current_user_id()
  OR EXISTS (SELECT 1 FROM lost_found_posts p WHERE p.id = post_id AND p.author_id = app_current_user_id())
  OR app_is_staff()
);
CREATE POLICY lost_found_claims_insert ON lost_found_claims FOR INSERT WITH CHECK (
  claimant_id = app_current_user_id()
  AND EXISTS (SELECT 1 FROM lost_found_posts p WHERE p.id = post_id AND p.author_id <> app_current_user_id() AND p.status = 'OPEN')
);
CREATE POLICY lost_found_claims_update ON lost_found_claims FOR UPDATE USING (
  claimant_id = app_current_user_id()
  OR EXISTS (SELECT 1 FROM lost_found_posts p WHERE p.id = post_id AND p.author_id = app_current_user_id())
);

CREATE TRIGGER lost_found_images_guard_owner BEFORE INSERT OR UPDATE ON lost_found_images
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');

CREATE POLICY attachments_read_lost_found ON attachments FOR SELECT USING (
  campus_id = app_current_campus_id()
  AND EXISTS (SELECT 1 FROM lost_found_images i WHERE i.attachment_id = attachments.id)
);
