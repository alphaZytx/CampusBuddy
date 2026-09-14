-- ===========================================================================
-- 004 — Conversations, messages, notifications
-- ===========================================================================

CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  request_id  uuid REFERENCES requests(id) ON DELETE CASCADE,
  rental_id   uuid,
  subject     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- A conversation always hangs off exactly one transaction, which is what makes
  -- "only participants may read this" a decidable question.
  CONSTRAINT conversations_one_subject CHECK (
    (request_id IS NOT NULL AND rental_id IS NULL) OR
    (request_id IS NULL AND rental_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX conversations_request_key ON conversations (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX conversations_rental_key ON conversations (rental_id) WHERE rental_id IS NOT NULL;

CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Membership is explicit: chat authorisation is a row lookup, never an inference.
CREATE TABLE conversation_participants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at     timestamptz,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX conversation_participants_user_idx ON conversation_participants (user_id);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id        uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             text CHECK (body IS NULL OR length(body) <= 2000),
  attachment_id    uuid REFERENCES attachments(id) ON DELETE SET NULL,
  shared_lat       double precision,
  shared_lng       double precision,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- A message must actually carry something.
  CONSTRAINT messages_not_empty CHECK (
    body IS NOT NULL OR attachment_id IS NOT NULL OR
    (shared_lat IS NOT NULL AND shared_lng IS NOT NULL)
  )
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
