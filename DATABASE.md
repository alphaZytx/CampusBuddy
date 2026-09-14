# Database

PostgreSQL 18. 31 tables, one read-model view, 15 ordered migrations.

Run `npm run db:migrate` to apply, `npm run db:reset` to rebuild from scratch with demo data.
Migrations are checksummed on every boot: editing one that has already been applied is a hard
error, because it would silently produce different schemas on different machines.

---

## Migrations

| File | Contents |
|---|---|
| `001_roles_and_helpers.sql` | The `campusbuddy_app` role, session-identity functions, `haversine_metres` |
| `002_core_tables.sql` | Institutions, campuses, departments, hostels, users, credentials, sessions, verification, attachments, audit log |
| `003_requests.sql` | Categories, requests, offers, status history, reward history, invitations |
| `004_chat_notifications.sql` | Conversations, participants, messages, notifications |
| `005_payments_ratings.sql` | Payments, transaction events, ratings |
| `006_marketplace_rentals.sql` | Listings, rental items, rentals, rental events |
| `007_moderation.sql` | Reports, disputes, evidence, rate-limit counters |
| `008_reputation_triggers.sql` | Reputation recomputation, counters, badges, earnings |
| `009_rls_policies.sql` | Row Level Security, grants, immutability triggers |
| `010_views.sql` | `public_user_profiles` read model |
| `011_request_attachments.sql` | Request attachment join table |
| `012_write_policies.sql` | Insert policies for server-written ledger tables |
| `013_system_transitions.sql` | `SECURITY DEFINER` functions for system-authored transitions |
| `014_profile_media.sql` | Profile photo and payment QR as references to the student's own uploads |
| `015_privacy_and_lifecycle_fixes.sql` | Preference lookups for notifications and matching, staff status history, attachment ownership and visibility, disputed rentals kept out of circulation, admin-set geofence |

---

## Entity map

```
institutions ─┬─ campuses ─┬─ departments ─┐
              │            ├─ hostels ─────┤
              │            └───────────────┴──► users ──┬─ user_credentials (1:1, no app access)
              │                                         ├─ user_preferences (1:1)
              │                                         ├─ notification_preferences (1:1)
              │                                         ├─ sessions (1:N)
              │                                         ├─ verification_records (1:N)
              │                                         └─ favourite_helpers (N:M self)
              │
              └──► requests ──┬─ request_offers (1:N)
                              ├─ request_status_history (1:N, append-only)
                              ├─ request_reward_history (1:N, append-only)
                              ├─ request_attachments (1:N)
                              ├─ request_invitations (1:N)
                              ├─ conversations (1:1) ──┬─ conversation_participants
                              │                        └─ messages
                              ├─ payments (1:1) ── transaction_events (1:N, append-only)
                              └─ ratings (up to 2)

              └──► listings ── listing_images
              └──► rental_items ──┬─ rental_item_images
                                  └─ rentals ── rental_events
              └──► reports
              └──► disputes ── dispute_evidence
```

Every campus-scoped table carries `campus_id` directly. It is denormalised on purpose: RLS
policies must be able to check campus membership without a join, or every policy becomes a
subquery and every query pays for it.

---

## Integrity rules the database enforces itself

These are not enforced only in application code. The database refuses them.

| Rule | Mechanism |
|---|---|
| A request can never have two accepted helpers | `UNIQUE INDEX request_offers_single_accepted ON request_offers(request_id) WHERE status = 'ACCEPTED'` |
| A helper can offer only once per request | `UNIQUE (request_id, helper_id)` |
| A person can rate a task only once | `UNIQUE INDEX ratings_request_unique ON ratings(request_id, rater_id)` |
| Nobody can rate themselves | `CHECK (rater_id <> ratee_id)` |
| Nobody can be their own helper | `CHECK (selected_helper_id <> requester_id)` |
| Nobody can pay themselves | `CHECK (payer_id <> payee_id)` |
| An item cannot be booked twice over — including while a rental is disputed | `UNIQUE INDEX rentals_one_active_per_item ON rentals(item_id) WHERE status IN ('RESERVED','RENTED','RETURN_PENDING','DISPUTED')` |
| One payment per request | `UNIQUE INDEX payments_request_key ON payments(request_id)` |
| One open dispute per transaction | `UNIQUE INDEX disputes_one_open_per_subject ... WHERE status IN ('OPEN','UNDER_REVIEW')` |
| One live email OTP per student | `UNIQUE INDEX verification_active_email_otp ... WHERE method='COLLEGE_EMAIL' AND status='PENDING'` |
| A giveaway is free | `CHECK (listing_type <> 'GIVEAWAY' OR price_paise = 0)` |
| Escalation cannot exceed its ceiling | `CHECK (max_reward_paise IS NULL OR reward_paise <= max_reward_paise)` |
| Reward history records only increases | `CHECK (to_paise > from_paise)` |
| A returned deposit cannot exceed the deposit | `CHECK (deposit_returned_paise <= deposit_paise)` |
| A message must carry something | `CHECK (body IS NOT NULL OR attachment_id IS NOT NULL OR shared location)` |
| Ratings are permanent | `BEFORE UPDATE` trigger raises unconditionally |
| A payment's amount and parties are fixed | `guard_payment_immutables` trigger |
| A student cannot change their own role, verification, status, reputation or earnings | `guard_user_immutables` trigger, active for the app role only |
| A request cannot change campus or requester | `guard_request_immutables` trigger |
| A profile photo or QR code is the student's own upload, of the right kind | `guard_user_media` trigger |
| A file attached to a request, message, listing, rental item, dispute or completion is the attaching student's own upload | `guard_attachment_reference` trigger, on each referencing table |

---

## Money

Every amount is `bigint` paise. `total_budget_paise` is a **generated column**:

```sql
total_budget_paise bigint GENERATED ALWAYS AS (reward_paise + product_cost_paise) STORED
```

PostgreSQL computes it and rejects any attempt to assign it, so the displayed total can never
disagree with its parts.

---

## Reputation, maintained by the database

`refresh_user_reputation(uuid)` recomputes from the source rows, mirroring
`packages/shared/src/reputation.ts` exactly:

```
adjusted   = bayesian_rating(avg, count, prior 3.5, weight 5)
completion = completed / (completed + cancelled)          -- 1.0 for a new account
disputes   = disputed / completed
response   = selections_responded / selections_received   -- 1.0 for a new account
experience = min(1, completed / 50)
tenure     = min(1, account_age_days / 90)

reliability = round(100 × clamp01(
    0.40·((adjusted − 1) / 4)  +  0.20·completion  +  0.10·response
  + 0.15·experience            +  0.05·tenure      +  0.10·(1 − disputes) ))
```

It runs as `SECURITY DEFINER` because rating a helper must update *the helper's* row, which the
RLS policy on `users` deliberately forbids for ordinary statements. That is the distinction the
design turns on: the system maintains reputation, students never can.

Triggers keep it current on rating writes, on request status changes (completions,
withdrawals, cancellations, disputes) and on payment confirmation.

---

## Indexes

Chosen for the queries that actually run:

```sql
requests_feed_idx      (campus_id, status, created_at DESC)   -- the discover feed
requests_category_idx  (campus_id, category_slug, status)     -- category filter
requests_requester_idx (requester_id, created_at DESC)        -- "my requests"
requests_helper_idx    (selected_helper_id, created_at DESC)  -- "my tasks"
requests_deadline_idx  (deadline_at) WHERE status IN (open…)  -- the expiry job
requests_geo_idx       (campus_id, approx_lat, approx_lng)    -- nearby
requests_search_idx    GIN (to_tsvector(title || description))-- full-text search
```

Plus equivalents on listings, rental items, messages, notifications and payments, and an index
on every `attachment_id` column so the attachment visibility policy stays cheap. Partial indexes
are used wherever a query only ever touches a subset — the expiry job never looks at completed
requests, so the index does not carry them.

---

## `public_user_profiles`

The canonical "what one student may see about another" projection: reputation, verification and
availability, but never credentials, phone number, UPI details or exact location.

```sql
CREATE VIEW public_user_profiles WITH (security_invoker = true) AS …
```

`security_invoker = true` matters. Without it the view would run with its *owner's* privileges
and quietly become a way around campus isolation. With it, the RLS policy on `users` still
applies through the view.

---

## Row Level Security

RLS is enabled on every table holding user data. A table with RLS on and no policy for a
command denies that command outright — default-deny, which is why migration 012 exists to add
narrow insert policies for the ledger tables the server writes on a user's behalf.

Representative policies:

```sql
-- A student may only ever create a request in their own name, on their own campus
CREATE POLICY requests_insert ON requests FOR INSERT WITH CHECK (
  campus_id = app_current_campus_id() AND requester_id = app_current_user_id()
);

-- Chat is readable only by the two participants
CREATE POLICY messages_read ON messages FOR SELECT
  USING (app_is_conversation_participant(conversation_id) OR app_is_staff());

-- Who you trust is nobody else's business
CREATE POLICY favourite_helpers_own ON favourite_helpers FOR SELECT
  USING (user_id = app_current_user_id());

-- A file is visible to whoever can see what it is attached to: each subquery runs
-- under the viewer's own RLS on the parent table
CREATE POLICY attachments_read_referenced ON attachments FOR SELECT USING (
  campus_id = app_current_campus_id() AND (
       EXISTS (SELECT 1 FROM listing_images li WHERE li.attachment_id = attachments.id)
    OR EXISTS (SELECT 1 FROM messages m WHERE m.attachment_id = attachments.id)
    OR …
  )
);
```

Policies that need to consult a second table use `SECURITY DEFINER` helpers
(`app_is_request_participant`, `app_is_conversation_participant`, …) so a policy on one table
does not recurse into another table's policy.

### Private data the server still needs

A student's preferences are visible only to that student. But when Rahul posts a request, the
server — acting *as Rahul* — has to know which helpers want to hear about it, and whether each
one is in quiet hours. Two narrow `SECURITY DEFINER` functions answer exactly that and nothing
more:

| Function | Answers |
|---|---|
| `app_matching_helpers(request, limit)` | Which helpers match this request by their own availability, categories, minimum reward, distance, urgent-only setting — and who may see it at all. Callable only by the request's requester, or by server jobs |
| `app_notification_preference(recipient, kind)` | Whether this recipient wants this kind of notification, and their quiet-hours window. Same campus only |

Before these existed, both lookups ran through RLS and silently found nothing, so every opt-out
and quiet-hours setting was ignored.

**`user_credentials` receives no grants at all.** Password hashes are unreachable from the
application role, so even a flaw in an ordinary query path cannot read one. `sessions` and
`rate_limit_events` are revoked for the same reason.

Three subtleties worth knowing, all discovered while building this:

1. **`RETURNING` is subject to the `SELECT` policy.** Inserting a notification *for someone
   else* and asking for its id back is refused, because the author cannot read the recipient's
   row. Ids are generated in the application instead.
2. **`SELECT … FOR UPDATE` also applies the `UPDATE` policy.** A helper cannot lock a request
   they do not participate in. Where a lock is not permitted, correctness comes from a guarded
   `INSERT … SELECT` or a unique index rather than from a lock.
3. **A write can end the writer's own access.** When a helper withdraws, clearing
   `selected_helper_id` makes them no longer a participant — so the status-history row, whose
   insert policy requires a participant, is written *before* the status change rather than after.

---

## Inspecting the database

The embedded database lives in `backend/.data/campusbuddy`. To explore it:

```bash
npx tsx -e "
  import { getDatabase } from './backend/src/db/client.ts';
  const db = await getDatabase();
  const { rows } = await db.query('SELECT status, count(*) FROM requests GROUP BY status');
  console.table(rows);
"
```

Or point `DATABASE_URL` at a real PostgreSQL server and use `psql` as usual.
