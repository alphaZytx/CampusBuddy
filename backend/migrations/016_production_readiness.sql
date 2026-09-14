-- ===========================================================================
-- 016 — Production readiness: safety, consent, payment evidence and durability
-- ===========================================================================

-- Students can silence a person without reporting them, or fully block contact.
CREATE TABLE user_safety_controls (
  owner_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked        boolean NOT NULL DEFAULT false,
  muted          boolean NOT NULL DEFAULT false,
  reason         text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, target_id),
  CONSTRAINT safety_control_not_self CHECK (owner_id <> target_id),
  CONSTRAINT safety_control_has_effect CHECK (blocked OR muted)
);
CREATE TRIGGER user_safety_controls_set_updated_at BEFORE UPDATE ON user_safety_controls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX user_safety_controls_target_idx ON user_safety_controls (target_id) WHERE blocked;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_safety_controls TO campusbuddy_app;
ALTER TABLE user_safety_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_safety_controls_own ON user_safety_controls FOR SELECT
  USING (owner_id = app_current_user_id());
CREATE POLICY user_safety_controls_insert ON user_safety_controls FOR INSERT
  WITH CHECK (owner_id = app_current_user_id());
CREATE POLICY user_safety_controls_update ON user_safety_controls FOR UPDATE
  USING (owner_id = app_current_user_id()) WITH CHECK (owner_id = app_current_user_id());
CREATE POLICY user_safety_controls_delete ON user_safety_controls FOR DELETE
  USING (owner_id = app_current_user_id());

CREATE OR REPLACE FUNCTION app_users_blocked(first_user uuid, second_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_safety_controls
     WHERE blocked AND ((owner_id = first_user AND target_id = second_user)
                     OR (owner_id = second_user AND target_id = first_user))
  );
$$;
REVOKE ALL ON FUNCTION app_users_blocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_users_blocked(uuid, uuid) TO campusbuddy_app;

CREATE OR REPLACE FUNCTION app_user_muted(owner_user uuid, target_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_safety_controls
     WHERE owner_id = owner_user AND target_id = target_user AND muted
  );
$$;
REVOKE ALL ON FUNCTION app_user_muted(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_muted(uuid, uuid) TO campusbuddy_app;

-- Moderation decisions are append-only, appealable, and measurable against an SLA.
ALTER TABLE reports ADD COLUMN sla_due_at timestamptz;
ALTER TABLE reports ADD COLUMN escalated_at timestamptz;
UPDATE reports SET sla_due_at = created_at + interval '24 hours' WHERE sla_due_at IS NULL;
ALTER TABLE reports ALTER COLUMN sla_due_at SET DEFAULT (now() + interval '24 hours');
ALTER TABLE reports ALTER COLUMN sla_due_at SET NOT NULL;

ALTER TABLE disputes ADD COLUMN sla_due_at timestamptz;
ALTER TABLE disputes ADD COLUMN escalated_at timestamptz;
UPDATE disputes SET sla_due_at = created_at + interval '24 hours' WHERE sla_due_at IS NULL;
ALTER TABLE disputes ALTER COLUMN sla_due_at SET DEFAULT (now() + interval '24 hours');
ALTER TABLE disputes ALTER COLUMN sla_due_at SET NOT NULL;

CREATE TABLE moderation_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id       uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type     text NOT NULL CHECK (action_type IN ('WARNING','STRIKE','SUSPENSION','RESTRICTION','NOTE')),
  reason          text NOT NULL CHECK (length(reason) BETWEEN 3 AND 2000),
  points          integer NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 100),
  expires_at      timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_user_idx ON moderation_actions (user_id, created_at DESC);

CREATE TABLE moderation_appeals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderation_action_id  uuid NOT NULL REFERENCES moderation_actions(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement             text NOT NULL CHECK (length(statement) BETWEEN 10 AND 3000),
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UPHELD','OVERTURNED','WITHDRAWN')),
  reviewed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution            text,
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (moderation_action_id, user_id)
);

CREATE TABLE abuse_signals (
  id            bigserial PRIMARY KEY,
  campus_id     uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  signal_type   text NOT NULL,
  score         integer NOT NULL CHECK (score BETWEEN 1 AND 100),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWED','DISMISSED')),
  detected_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX abuse_signals_review_idx ON abuse_signals (campus_id, status, score DESC, detected_at DESC);

-- A report can carry several screenshots/documents, just like a dispute.
CREATE TABLE report_evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  submitted_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note           text CHECK (note IS NULL OR length(note) <= 1000),
  attachment_id  uuid REFERENCES attachments(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_evidence_not_empty CHECK (note IS NOT NULL OR attachment_id IS NOT NULL)
);
CREATE INDEX report_evidence_report_idx ON report_evidence (report_id, created_at);
CREATE TRIGGER report_evidence_guard_attachment
  BEFORE INSERT OR UPDATE OF attachment_id ON report_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('attachment_id');
GRANT SELECT, INSERT ON report_evidence TO campusbuddy_app;
ALTER TABLE report_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_evidence_read ON report_evidence FOR SELECT USING (
  EXISTS (SELECT 1 FROM reports r WHERE r.id = report_id)
);
CREATE POLICY report_evidence_insert ON report_evidence FOR INSERT WITH CHECK (
  submitted_by = app_current_user_id()
  AND EXISTS (SELECT 1 FROM reports r WHERE r.id = report_id AND r.reporter_id = app_current_user_id())
);
CREATE POLICY attachments_read_report_evidence ON attachments FOR SELECT USING (
  EXISTS (SELECT 1 FROM report_evidence e WHERE e.attachment_id = attachments.id)
);

-- Payer-provided evidence remains a claim. Only the payee can confirm receipt.
ALTER TABLE payments ADD COLUMN transaction_reference text
  CHECK (transaction_reference IS NULL OR length(transaction_reference) BETWEEN 4 AND 100);
ALTER TABLE payments ADD COLUMN receipt_attachment_id uuid REFERENCES attachments(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN expires_at timestamptz;
ALTER TABLE payments ADD COLUMN reminder_sent_at timestamptz;
ALTER TABLE payments ADD COLUMN expiry_notified_at timestamptz;
UPDATE payments SET expires_at = created_at + interval '7 days' WHERE expires_at IS NULL;
ALTER TABLE payments ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
CREATE INDEX payments_due_idx ON payments (expires_at)
  WHERE status IN ('PAYMENT_PENDING','PAYMENT_INITIATED','PAYMENT_CLAIMED');
CREATE TRIGGER payments_guard_receipt
  BEFORE INSERT OR UPDATE OF receipt_attachment_id ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_attachment_reference('receipt_attachment_id');
CREATE POLICY attachments_read_payment_receipt ON attachments FOR SELECT USING (
  EXISTS (SELECT 1 FROM payments p WHERE p.receipt_attachment_id = attachments.id)
);

-- Android push registrations. The token is private and can be revoked remotely.
CREATE TABLE push_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id      uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  platform       text NOT NULL CHECK (platform IN ('ANDROID','IOS','WEB')),
  token          text NOT NULL UNIQUE,
  device_name    text,
  app_version    text,
  enabled        boolean NOT NULL DEFAULT true,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id) WHERE enabled;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_devices TO campusbuddy_app;
ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_devices_own ON push_devices FOR SELECT USING (user_id = app_current_user_id());
CREATE POLICY push_devices_insert ON push_devices FOR INSERT
  WITH CHECK (user_id = app_current_user_id() AND campus_id = app_current_campus_id());
CREATE POLICY push_devices_update ON push_devices FOR UPDATE
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY push_devices_delete ON push_devices FOR DELETE USING (user_id = app_current_user_id());

-- Versioned policy documents and an immutable acceptance history.
CREATE TABLE legal_documents (
  document_type  text NOT NULL CHECK (document_type IN ('PRIVACY','TERMS','COMMUNITY')),
  version        text NOT NULL,
  title          text NOT NULL,
  content        text NOT NULL,
  effective_at   timestamptz NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_type, version)
);
CREATE TABLE user_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  document_type  text NOT NULL,
  version        text NOT NULL,
  accepted       boolean NOT NULL,
  ip_hash        text,
  user_agent     text,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_type, version) REFERENCES legal_documents(document_type, version)
);
CREATE INDEX user_consents_user_idx ON user_consents (user_id, recorded_at DESC);

INSERT INTO legal_documents (document_type, version, title, content, effective_at) VALUES
 ('PRIVACY','2026-09','Privacy notice','CampusBuddy uses account, campus verification, transaction, safety and optional location data to operate the campus marketplace. Location is never tracked in the background. Contact support to exercise privacy rights.',now()),
 ('TERMS','2026-09','Terms of use','Use CampusBuddy lawfully and respectfully. CampusBuddy introduces students but does not process or guarantee external payments. Users remain responsible for items, services and transfers they agree to.',now()),
 ('COMMUNITY','2026-09','Community rules','No harassment, discrimination, fraud, unsafe services, prohibited goods, spam or attempts to move disputes outside the safety process. Report urgent safety concerns immediately.',now());

-- Durable side effects and jobs can be claimed by any API/worker instance.
CREATE TABLE durable_outbox (
  id             bigserial PRIMARY KEY,
  topic          text NOT NULL,
  aggregate_id   uuid,
  payload        jsonb NOT NULL,
  attempts       integer NOT NULL DEFAULT 0,
  available_at   timestamptz NOT NULL DEFAULT now(),
  locked_at      timestamptz,
  processed_at   timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX durable_outbox_pending_idx ON durable_outbox (available_at, id)
  WHERE processed_at IS NULL;
GRANT INSERT ON durable_outbox TO campusbuddy_app;
GRANT USAGE, SELECT ON SEQUENCE durable_outbox_id_seq TO campusbuddy_app;

CREATE TABLE job_queue (
  id             bigserial PRIMARY KEY,
  job_type       text NOT NULL,
  dedupe_key     text UNIQUE,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts       integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 8,
  run_at         timestamptz NOT NULL DEFAULT now(),
  locked_at      timestamptz,
  completed_at   timestamptz,
  failed_at      timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_queue_ready_idx ON job_queue (run_at, id)
  WHERE completed_at IS NULL AND failed_at IS NULL;

CREATE TABLE idempotency_keys (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key            text NOT NULL,
  method         text NOT NULL,
  path           text NOT NULL,
  request_hash   text NOT NULL,
  status_code    integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (user_id, key)
);

-- Keep the hot paths indexed as data grows.
CREATE INDEX IF NOT EXISTS messages_sender_created_idx ON messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_campus_feed_idx ON requests (campus_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_sla_idx ON reports (sla_due_at) WHERE status IN ('OPEN','UNDER_REVIEW');
CREATE INDEX IF NOT EXISTS disputes_sla_idx ON disputes (sla_due_at) WHERE status IN ('OPEN','UNDER_REVIEW');

GRANT SELECT ON moderation_actions, moderation_appeals TO campusbuddy_app;
GRANT INSERT ON moderation_appeals TO campusbuddy_app;
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_appeals ENABLE ROW LEVEL SECURITY;
CREATE POLICY moderation_actions_visible ON moderation_actions FOR SELECT USING (
  user_id = app_current_user_id() OR (app_is_staff() AND campus_id = app_current_campus_id())
);
CREATE POLICY moderation_appeals_visible ON moderation_appeals FOR SELECT USING (
  user_id = app_current_user_id() OR app_is_staff()
);
CREATE POLICY moderation_appeals_insert ON moderation_appeals FOR INSERT
  WITH CHECK (user_id = app_current_user_id());
