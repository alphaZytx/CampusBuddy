-- ===========================================================================
-- 012 — Insert policies for server-written ledger tables
--
-- Status history, reward history, conversations, payments and transaction
-- events are written by the server as part of a student's action, inside that
-- student's own RLS-bound transaction. With RLS enabled and no INSERT policy,
-- PostgreSQL denies those writes outright — correct by default, but it means
-- each one needs an explicit, tightly scoped rule.
--
-- The principle throughout: you may only append to the ledger of a transaction
-- you are actually a party to.
-- ===========================================================================

-- Append-only lifecycle history for a request you are part of.
CREATE POLICY request_status_history_insert ON request_status_history FOR INSERT
  WITH CHECK (app_is_request_participant(request_id));

CREATE POLICY request_reward_history_insert ON request_reward_history FOR INSERT
  WITH CHECK (app_is_request_participant(request_id));

-- Only the requester may invite trusted helpers to their own private request.
CREATE POLICY request_invitations_insert ON request_invitations FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM requests r
             WHERE r.id = request_id AND r.requester_id = app_current_user_id())
  );

-- A conversation may only be opened for a transaction you are a party to.
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (
    campus_id = app_current_campus_id()
    AND (
      (request_id IS NOT NULL AND app_is_request_participant(request_id))
      OR (rental_id IS NOT NULL AND app_is_rental_participant(rental_id))
    )
  );

CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (app_is_conversation_participant(id))
  WITH CHECK (campus_id = app_current_campus_id());

-- Adding the first participants is a chicken-and-egg problem: membership of a
-- conversation is what makes it visible, so a policy that reads `conversations`
-- directly would find nothing at the moment the conversation is created. This
-- SECURITY DEFINER helper looks past that one row to the transaction underneath.
CREATE OR REPLACE FUNCTION app_can_join_conversation(target_conversation uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = target_conversation
       AND (
         (c.request_id IS NOT NULL AND app_is_request_participant(c.request_id))
         OR (c.rental_id IS NOT NULL AND app_is_rental_participant(c.rental_id))
       )
  );
$$;

-- Participants are added when the conversation is created; membership follows
-- the underlying transaction rather than being freely assignable.
CREATE POLICY conversation_participants_insert ON conversation_participants FOR INSERT
  WITH CHECK (app_can_join_conversation(conversation_id));

-- A payment can only be opened against a transaction you are a party to. The
-- amount itself is still derived server-side and pinned by a trigger.
CREATE POLICY payments_insert ON payments FOR INSERT
  WITH CHECK (
    campus_id = app_current_campus_id()
    AND (
      (request_id IS NOT NULL AND app_is_request_participant(request_id))
      OR (rental_id IS NOT NULL AND app_is_rental_participant(rental_id))
    )
  );

CREATE POLICY transaction_events_insert ON transaction_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payments p
       WHERE p.id = payment_id
         AND (p.payer_id = app_current_user_id() OR p.payee_id = app_current_user_id())
    )
  );

CREATE POLICY rental_events_insert ON rental_events FOR INSERT
  WITH CHECK (app_is_rental_participant(rental_id));

-- Notifications are the one case where the row belongs to *someone else*: the
-- point of a notification is to tell the counterparty what just happened. The
-- API is the only writer, so the rule enforced here is campus isolation — and
-- reading remains restricted to the recipient by `notifications_own`, which is
-- what actually protects privacy.
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (campus_id = app_current_campus_id());
