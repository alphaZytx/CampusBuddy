-- ===========================================================================
-- 011 — Request attachments
--
-- A proper join table rather than an array column, so an attachment can be
-- authorised by following the request it belongs to.
-- ===========================================================================

CREATE TABLE request_attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  attachment_id  uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  sort_order     integer NOT NULL DEFAULT 0,
  UNIQUE (request_id, attachment_id)
);
CREATE INDEX request_attachments_request_idx ON request_attachments (request_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON request_attachments TO campusbuddy_app;

ALTER TABLE request_attachments ENABLE ROW LEVEL SECURITY;
-- Visible to anyone who can already see the parent request: the RLS policy on
-- `requests` is what actually decides, and this simply follows it.
CREATE POLICY request_attachments_read ON request_attachments FOR SELECT USING (
  EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id)
);
CREATE POLICY request_attachments_insert ON request_attachments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.requester_id = app_current_user_id())
);
