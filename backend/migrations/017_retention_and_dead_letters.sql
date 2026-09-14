-- 017 — Explicit retention schedule and dead-letter state

ALTER TABLE attachments DROP CONSTRAINT attachments_purpose_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_purpose_check
  CHECK (purpose IN ('GENERAL','AVATAR','REQUEST','MESSAGE','LISTING','RENTAL_ITEM','PROOF','DISPUTE','REPORT','UPI_QR'));

ALTER TABLE durable_outbox ADD COLUMN max_attempts integer NOT NULL DEFAULT 8
  CHECK (max_attempts BETWEEN 1 AND 100);
ALTER TABLE durable_outbox ADD COLUMN failed_at timestamptz;
DROP INDEX durable_outbox_pending_idx;
CREATE INDEX durable_outbox_pending_idx ON durable_outbox (available_at, id)
  WHERE processed_at IS NULL AND failed_at IS NULL;

INSERT INTO legal_documents (document_type, version, title, content, effective_at) VALUES
('PRIVACY','2026-09-retention','Privacy notice',
'CampusBuddy uses account and campus-verification data, transaction records, safety reports, uploaded media, and location only when you explicitly share it. Last shared location is cleared after 30 days. Notifications are kept for 180 days. Messages linked to a closed transaction are kept for 365 days. Resolved reports, disputes, and their evidence are kept for 730 days for safety and appeals. Unattached uploads are deleted after 24 hours; linked media follows its parent record. Account deletion removes credentials and identifying profile fields while retaining anonymised transaction and safety records where needed to protect other users. You can export your data or deactivate/delete your account from Privacy Centre.', now());
