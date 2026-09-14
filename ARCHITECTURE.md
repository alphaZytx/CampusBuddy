# Architecture

How CampusBuddy is put together, and why each significant decision was made.

---

## 1. The shape of the system

```
┌──────────────────┐     ┌──────────────────┐
│  Student PWA     │     │  Admin panel     │
│  React + Vite    │     │  React + Vite    │
│  localhost:5173  │     │  localhost:5174  │
└────────┬─────────┘     └────────┬─────────┘
         │  HTTPS + WebSocket              │
         └──────────────┬─────────────────┘
                        ▼
         ┌──────────────────────────────┐
         │  Fastify API  (TypeScript)   │
         │                              │
         │  routes → services → SQL     │
         │  auth · RLS context · jobs   │
         └──────────────┬───────────────┘
                        ▼
         ┌──────────────────────────────┐
         │  PostgreSQL 18               │
         │  RLS · triggers · FTS        │
         │  PGlite (embedded) or server │
         └──────────────────────────────┘

         ┌──────────────────────────────┐
         │  @campusbuddy/shared         │
         │  imported by all three       │
         │  state machines · matching   │
         │  reputation · money · zod    │
         └──────────────────────────────┘
```

Four workspaces in one npm monorepo. The shared package is the important one: it is the reason
the browser and the server cannot drift apart about what a valid request looks like, which
status transitions exist, or how a reward is calculated.

---

## 2. Decisions worth explaining

### 2.1 Real PostgreSQL, embedded

**Decision.** PostgreSQL 18 through PGlite (a WebAssembly build) by default; ordinary
`node-postgres` when `DATABASE_URL` is set.

**Why.** The project needs genuine Row Level Security, triggers, generated columns, partial
unique indexes and full-text search — those are the load-bearing parts of the design, and SQLite
has none of them. But requiring a reviewer to install Docker and PostgreSQL before they can see
anything work is a real cost. PGlite gives the full engine with `npm install`.

Both drivers sit behind one `Database` interface (`backend/src/db/client.ts`) exposing
`query`, `transaction` and `asUser`. Nothing above that file knows which is active, so the
choice is genuinely reversible.

### 2.2 Row Level Security as the campus boundary

**Decision.** Every ordinary read and write runs as `campusbuddy_app`, a database role with no
`BYPASSRLS`, inside a transaction that carries the caller's identity in transaction-local
session settings.

```ts
db.asUser({ userId, campusId, role }, async (tx) => { … })
//  ↓ issues
//  SET LOCAL ROLE campusbuddy_app
//  SELECT set_config('app.user_id', …, true), set_config('app.campus_id', …, true), …
```

**Why.** Authorisation written only in application code fails open the moment someone forgets a
`WHERE` clause. Here the policies are enforced by PostgreSQL itself: a query that forgets to
filter by campus simply returns nothing, and an `INSERT` that names the wrong owner is rejected.
`SET LOCAL` scopes the identity to the transaction, so it cannot leak between requests sharing a
pooled connection.

Trusted server-side work — migrations, jobs, seeding, authentication — runs as the table owner
and is not subject to RLS. Which mode is active is derived from `current_user`, not from a
session variable, so a forgotten or forged setting can never promote a request into the trusted
context.

### 2.3 The state machine is the only writer

**Decision.** `requests.status` is written in exactly one function, `applyTransition`, which
validates the move against a shared, actor-aware transition table before touching the row.

```ts
assertRequestTransition('COMPLETED', 'PAYMENT_PENDING', 'HELPER')
//   → throws: a helper cannot confirm their own completion
```

**Why.** A marketplace is a state machine wearing a UI. Scattering `UPDATE requests SET status`
across twenty route handlers is how a request ends up both `CANCELLED` and `PAID`. Centralising
it means every transition is validated, recorded in `request_status_history`, and testable in
isolation. The same table drives the client: `availableActions` on every request response is
computed from it, so a button is never offered for an action the server would refuse.

Three transitions are performed by the *system* on behalf of a helper who is not yet a
participant — the first offer flipping `OPEN → OFFERS_RECEIVED`, for instance. Widening the RLS
policy to allow that would also let a helper edit the request's title. Instead each one is a
`SECURITY DEFINER` function that can do precisely that one thing and re-derives its own
preconditions (`013_system_transitions.sql`).

### 2.4 Money is integer paise

**Decision.** Every monetary value, everywhere, is an integer count of paise.

**Why.** `0.1 + 0.2 !== 0.3`. Reward escalation, deposit settlement and payment totals all
involve repeated arithmetic, and float drift in a ledger is not recoverable. `bigint` columns
in PostgreSQL, `number` in TypeScript, formatted for display only at the edge by `formatINR`.

### 2.5 Only the payee can confirm a payment

**Decision.** The request reaches `PAID` when the **recipient** confirms the money arrived —
never when the payer says they sent it.

**Why.** CampusBuddy has no view into a bank. A UPI deep link opens the payer's app; whether
the transfer completes is invisible to us. Claiming otherwise would be a lie encoded in the
schema. So the payment machine distinguishes `PAYMENT_CLAIMED` (the payer's unverified word)
from `PAYMENT_CONFIRMED` (the payee's confirmation), and earnings move only on the latter.

### 2.6 Deferred side effects

**Decision.** Realtime pushes and notifications are queued in an `Outbox` and flushed only
after the transaction commits.

**Why.** Sending "you were selected!" for a transaction that then rolls back is worse than
sending nothing. `withUserTx` runs the handler, commits, then flushes.

A related trap this project hit and fixed: a failed statement poisons the entire PostgreSQL
transaction, so a caught-and-ignored error still turns the eventual `COMMIT` into a silent
`ROLLBACK`. Notification writes are therefore wrapped in a `SAVEPOINT` — that is what actually
makes them non-fatal, rather than a `try/catch` that only appears to.

### 2.7 Privacy is applied at the serialiser

**Decision.** Exact coordinates, phone numbers and UPI handles are attached to a response in
one place (`backend/src/core/serializers.ts`), gated on who is asking.

**Why.** Deciding "should this viewer see this field" separately in every handler guarantees
that one of them eventually gets it wrong. Public feeds get coordinates rounded to a ~110 m
grid; exact positions go only to the two participants; a payee's UPI ID is revealed only to the
person who currently owes them money, and only until the payment is confirmed.

---

## 3. Request lifecycle

```
                    ┌──────────────────────────────┐
                    ▼                              │
   OPEN ──────► OFFERS_RECEIVED ──────► HELPER_SELECTED
    │  ▲             │                       │    │
    │  └─────────────┘                       │    └──► (helper declines) ──► OPEN
    │   all offers withdrawn                 ▼
    │                                    ACCEPTED
    │                                        │
    │                                        ▼
    │                                   IN_PROGRESS ─────────┐
    │                                        │               │
    │                                        ▼               ▼
    │                                   COMPLETED        DISPUTED
    │                                     │    │              │
    │                    (requester says  │    │ confirm      │ admin
    │                     not done)       ▼    ▼              │ resolves
    │                                 REJECTED  PAYMENT_PENDING ◄┘
    │                                     │            │
    │                                     └─ retry ──► │ payee confirms receipt
    │                                                  ▼
    │                                                PAID
    │                                                  │ both rate
    ▼                                                  ▼
CANCELLED / EXPIRED / HELPER_WITHDREW                RATED
```

Every arrow is a row in `REQUEST_TRANSITIONS` with the set of actors permitted to take it.
`nextRequestStatuses(status, actor)` drives the UI; `assertRequestTransition` guards the write.

---

## 4. Layers in the API

```
routes/     HTTP shape: parse with Zod, resolve the caller, map errors
services/   Business rules, transitions, invariants
db/         Driver abstraction, RLS context, migrations
core/       Cross-cutting: auth, errors, rate limiting, serialisers, outbox
```

The rule is that a route never contains a business rule and a service never touches
`FastifyRequest`. It keeps the interesting logic testable without HTTP, which is why the unit
suite can cover the state machine, matching and reputation with no database at all.

---

## 5. Realtime

One WebSocket per signed-in student, authenticated by the same access token as the REST API.
Channels:

| Channel | Who receives it |
|---|---|
| `user:<id>` | That student, on every device — offers, selections, payments, ratings |
| `campus:<id>` | Everyone on campus — new open requests, reward changes |
| `request:<id>` | The two participants of one request |
| `conversation:<id>` | The two participants of one chat |

Subscription to a request, rental or conversation channel is **authorised against the database
at subscribe time** — a client cannot listen in by guessing an id. The client reconnects with
exponential backoff and resubscribes automatically.

---

## 6. Matching

`packages/shared/src/matching.ts` is a pure module with no imports from the API or the UI.

```
score = 0.25·distance     + 0.15·categoryMatch + 0.15·availability
      + 0.15·rating       + 0.10·reliability   + 0.10·rewardPreference
      + 0.05·responseHistory + 0.05·urgencyFit
```

Each component returns 0..1 and the weights are configurable, so the total is always 0..1 and
comparable across requests. Two deliberate properties:

- **Ratings are Bayesian-adjusted** toward a 3.5-star prior, so a single five-star review does
  not outrank a long record.
- **New students are not locked out.** Missing history scores neutral-positive rather than zero,
  because a marketplace where newcomers can never win their first task does not bootstrap.

The feed's "Recommended" ordering mirrors the same signals in SQL so ranking happens in the
database over indexed columns rather than by loading rows into memory.

---

## 7. Background jobs

`backend/src/jobs/scheduler.ts`, every 30 seconds, skipping a tick if the previous one is still
running:

| Job | What it does |
|---|---|
| `expireRequests` | Moves past-deadline requests to `EXPIRED` and closes their offers |
| `escalateRewards` | Raises opted-in rewards a step, never past the requester's ceiling |
| `activateScheduledRequests` | Publishes and announces scheduled requests when due |
| `sendRentalReminders` | Warns a renter two hours before an item is due back |
| `lapseAvailability` | Ends expired "available until" windows |
| `processPaymentDeadlines` | Sends UPI reminders and marks expired evidence windows |
| `detectAbuseSignals` | Queues repeated cancellations/report bursts for human review |
| `processDurableOutbox` | Delivers FCM push with bounded retries and dead-letter state |
| `pruneRetainedData` | Enforces location, chat, safety, notification and media retention |

Each re-checks its preconditions under a row lock, so a job and a user action racing on the same
request cannot both win. `runJobsOnce` is exported so tests drive them deterministically instead
of waiting on wall-clock time.

---

## 8. Frontend

Both front ends are React 18 + Vite, sharing one design system built on CSS custom properties
with light and dark themes.

- **`useAsync`** gives every screen loading, error, empty and retry states as a matter of course
  rather than as an afterthought.
- **`api.ts`** attaches the access token and transparently refreshes it on a 401. Concurrent
  401s share a single refresh, because refresh tokens rotate and a burst of parallel refreshes
  would look like token theft and log the student out.
- **`availableActions`** from the server decides which buttons render, so the UI and the state
  machine cannot disagree.
- The student app is an installable PWA with a manifest and a maskable icon.

---

## 9. Scale-out path now implemented

| Limit | Where it bites | What would replace it |
|---|---|---|
| WebSockets attached to one process | Multiple API instances | Redis Pub/Sub fan-out plus per-process socket registries |
| PGlite single connection | Development only | Required managed `DATABASE_URL`, configurable pool and slow-query budget |
| Offset pagination on the feed | Deep pages get slower | Keyset pagination on `(score, id)` |
| Local disk uploads | Development only | S3-compatible private storage behind signed application URLs |
| In-app notifications | App is closed | FCM delivery from the durable database outbox |
| Per-process mutation retry state | Load-balanced retries | Database idempotency keys on every non-multipart mutation |

Presence remains intentionally ephemeral; if online/offline indicators become a product feature,
store leases with TTLs in Redis rather than treating a socket on one process as global truth.
