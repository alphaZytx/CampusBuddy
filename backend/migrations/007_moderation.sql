-- ===========================================================================
-- 007 — Reports, disputes, evidence
-- ===========================================================================

CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id     uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  reporter_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  target_type   text NOT NULL CHECK (target_type IN ('USER','REQUEST','LISTING','RENTAL_ITEM','MESSAGE','PAYMENT')),
  target_id     uuid NOT NULL,
  reason        text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED','ESCALATED')),
  resolution    text,
  reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER reports_set_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX reports_status_idx ON reports (campus_id, status, created_at DESC);
-- One open report per person per target stops report-spam brigading.
CREATE UNIQUE INDEX reports_no_duplicate_open
  ON reports (reporter_id, target_type, target_id)
  WHERE status IN ('OPEN','UNDER_REVIEW') AND reporter_id IS NOT NULL;

CREATE TABLE disputes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id     uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  subject_type  text NOT NULL CHECK (subject_type IN ('REQUEST','RENTAL','LISTING')),
  subject_id    uuid NOT NULL,
  opened_by     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  against_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  reason        text NOT NULL,
  description   text NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                  'OPEN','UNDER_REVIEW','RESOLVED_REQUESTER','RESOLVED_HELPER',
                  'RESOLVED_SPLIT','DISMISSED')),
  resolution    text,
  resolved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER disputes_set_updated_at BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX disputes_status_idx ON disputes (campus_id, status, created_at DESC);
CREATE INDEX disputes_subject_idx ON disputes (subject_type, subject_id);
-- Only one live dispute per transaction.
CREATE UNIQUE INDEX disputes_one_open_per_subject
  ON disputes (subject_type, subject_id) WHERE status IN ('OPEN','UNDER_REVIEW');

CREATE TABLE dispute_evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id     uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  submitted_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note           text,
  attachment_id  uuid REFERENCES attachments(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispute_evidence_not_empty CHECK (note IS NOT NULL OR attachment_id IS NOT NULL)
);
CREATE INDEX dispute_evidence_idx ON dispute_evidence (dispute_id, created_at);

-- Sliding-window counters backing OTP throttling and abuse limits (spec §48).
CREATE TABLE rate_limit_events (
  id          bigserial PRIMARY KEY,
  bucket      text NOT NULL,
  identifier  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_events_lookup ON rate_limit_events (bucket, identifier, created_at DESC);
