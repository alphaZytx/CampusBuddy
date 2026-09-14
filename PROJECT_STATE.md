# Project state

Where CampusBuddy stands, what is known to be true, and what would come next.

**Last verified:** all 177 tests passing, lint and typecheck clean across four workspaces, both
front ends building, and a 16-check browser run of the production builds passing against the
seeded data with no server errors logged.

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript throughout, strict mode |
| API | Fastify 5 on Node 20+ |
| Database | PostgreSQL 18 — PGlite embedded by default, any server via `DATABASE_URL` |
| Realtime | WebSocket (`@fastify/websocket`) |
| Front ends | React 18 + Vite 6, one shared design system; the student app is an offline-capable PWA |
| Validation | Zod, shared between client and server |
| Tests | Vitest, in-process HTTP via `app.inject`; a headless-Chrome run of the builds |
| Auth | scrypt + HS256 JWT + rotating refresh tokens |

Deliberately small dependency surface: no ORM, no UI kit, no state-management library. The SQL
is visible, which for a project whose point is database design is a feature.

---

## Verified state

```
Typecheck   4 workspaces, 0 errors
Lint        0 problems (TypeScript rules, React hooks rules)
Tests       177 passed (unit 44, lifecycle 22, security 30, features 33, media 23, review 25)
Browser     16/16 checks against the production builds (npm run test:e2e)
Migrations  15, applied cleanly from empty
Seed        26 accounts, 56 requests, 43 payments, 86 ratings, 8 listings,
            8 rental items, 2 rentals, 1 open report, 1 open dispute
Builds      mobile 103 KB gzipped, plus a 47 KB QR decoder fetched only when adding a QR
            · admin 78 KB gzipped
```

---

## Notable problems found and fixed while building

Recorded because each one is a real trap in this stack, not a typo.

**1. A caught error still rolled back the transaction.**
Notification writes were wrapped in `try/catch` so a notification failure could not break the
business action. But a failed statement puts the whole PostgreSQL transaction into an aborted
state, and the eventual `COMMIT` silently becomes a `ROLLBACK`. The API returned `201 Created`
while saving nothing. Fixed with a `SAVEPOINT` around each notification, which is what actually
makes a failure non-fatal.

**2. `RETURNING` is subject to the `SELECT` policy.**
Inserting a notification *for another student* and asking for its id back was refused: the
author cannot read the recipient's row. Same problem for a conversation, which has no
participants at the instant it is created. Both now generate ids in the application.

**3. `SELECT … FOR UPDATE` also applies the `UPDATE` policy.**
A helper offering on someone else's request cannot lock it — correctly, since they may not
modify it. Correctness now comes from a guarded `INSERT … SELECT` that re-checks the status in
the same statement, plus the unique index.

**4. Generated columns are NULL in a `BEFORE` trigger.**
An immutability guard compared `NEW.total_budget_paise` against its parts, which is always NULL
before the row is computed — so every update failed. Removed: PostgreSQL already refuses to let
anyone assign a generated column.

**5. `array || 'literal'` is ambiguous.**
PostgreSQL could not choose between `array || element` and `array || array` and tried to parse
the badge name as an array literal. Fixed with explicit `::text` casts.

**6. Service context derived from a session variable was fragile.**
`app_is_service()` originally read a session setting the embedded driver never set. It now
derives from `current_user`, which cannot be forgotten or forged.

**7. Uploaded images could never have been displayed.**
Files were served only to a bearer token, but an `<img>` tag cannot send one. Found while adding
profile photos; fixed with short-lived signed links minted only for entitled viewers.

**8. The avatar field accepted any address.**
`avatarUrl` and `upiQrUrl` were free text, so a student could have made every viewer's browser
fetch an external tracking image. Both are now references to the student's own upload, enforced
by a trigger.

**9. Payment notifications were silently dropped.**
The payments query never selected `campus_id`, so every "payment sent" and "payment confirmed"
notification was written with no campus and refused by RLS. The savepoint around notifications
kept the payment itself working — which is exactly why nothing visibly broke, and why no test
noticed. Found in the server log while testing the QR flow; a regression test now covers it.

---

## Found in the pre-release review

A full review of every module, screen and migration before calling the project ready. Each item
below is fixed and has a regression test (`review.test.ts`) or a browser check.

**Lifecycle**

- **A helper could never withdraw or decline.** The status change cleared `selected_helper_id`
  *before* the history row was written, and the history policy only accepts rows from a party to
  the request — so both buttons returned 403. The history is now written first.
- **After a withdrawal, the request could never find another helper.** The departing helper's
  offer stayed `ACCEPTED`, and the one-accepted-offer index then refused every later selection.
  Helpers passed over earlier could not offer again either. Both fixed; the departing helper
  also loses access to the chat.
- **A double tap or a stale screen produced a 500.** State-machine refusals were never mapped to
  HTTP. They now return `409 INVALID_TRANSITION` or `403 ACTION_NOT_ALLOWED`.
- **Scheduled requests escalated before going live, and were then never announced**; the
  requester was notified about their own request. Offers on a not-yet-live request are now
  refused, escalation waits for go-live, and announcement uses the same matching as any request.

**Notifications and matching**

- **Every notification preference was ignored.** RLS keeps preferences private, so when a student
  acted, the server — running as that student — could not see the recipient's settings, found
  nothing, and assumed "all on". Opt-outs, busy status, preferred categories, minimum reward,
  distance and quiet hours were all bypassed, and restricted-visibility requests alerted
  students who could not open them. Two narrow `SECURITY DEFINER` functions now answer exactly
  those questions.
- **Quiet hours used the server's clock** (five and a half hours out on a UTC host), and so did
  rental reminder times. Both now use `CAMPUS_TIMEZONE`.
- **Saving any notification setting wiped quiet hours**, and an availability end time could not
  be cleared.

**Security**

- **Per-address rate limits could be dodged** by sending a made-up `X-Forwarded-For` on every
  request. Proxies are now trusted only as far as `TRUST_PROXY` says. The sample nginx
  configuration also never forwarded the address, so in production every student would have
  shared one rate-limit bucket; it does now.
- **Wrong OTP guesses were never counted.** The attempt counter was updated inside the
  transaction that then threw, so the update rolled back with it. Refusals are now returned and
  thrown only after the commit.
- **Attachments were never checked for ownership**, so a request, message, listing or dispute
  could reference another student's upload. A trigger now refuses it.
- **A campus admin could demote or suspend the platform admin**, and an admin could suspend
  themselves. Both refused; suspension now also closes open realtime connections.
- Refresh-token rotation is now claimed atomically, and per-address counters are serialised with
  an advisory lock so parallel bursts cannot slip under a limit.

**Sessions and offline**

- **Signing out signed the student out on every device.** The apps now send the device's own
  refresh token, which ends only that session and needs no access token.
- **A network blip signed the student out.** A failed refresh with no connection, or opening the
  app offline, wiped the stored session. Now only a definite refusal does; otherwise the app
  shows an offline screen and recovers by itself.
- **The PWA could not open without signal.** A service worker now keeps the app shell (never any
  API data) so the installed app opens and says it is offline.
- Realtime reconnected forever with an expired token, and dead sockets were never reaped. The
  client now renews the token first; the server drops connections that stop answering pings.

**Moderation and rentals**

- **Dismissing a dispute marked the request `PAID`** with no payment made; ruling for the helper
  on a mid-task dispute left nothing to pay. Rulings now land where they should.
- **Rental disputes bypassed the state machine**, could reopen a finished rental, released the
  item for rebooking while it might still be with the renter, and could never be resolved.
- The owner was offered a "Cancel" the API then refused; staff could act as the renter; the
  rental screen had no dispute button and did not update live.

**Admin panel**

- **A geofence saved in the panel was overwritten on every restart** by the values in `.env`.
- **An empty field moved the campus to 0°N 0°E**, which would have failed every location
  verification.
- An unknown CORS origin (for instance `vite preview`) turned every request into a 500.

**Student app**

- A second offer never appeared for the requester without leaving the screen.
- "Contact the seller" posted nothing useful: its pre-fill was ignored. It now opens a private
  request addressed to the seller; profiles gained "Ask … privately" the same way.
- Discover's "Load more" could list a page twice and failed silently; chat messages read as they
  arrived came back as unread; a pending location prompt could hang "Post request".

**Tooling**

- `npm run lint` pointed at an ESLint that was never installed. It is now configured, including
  the React hooks rules, and passes clean.

---

## Known limitations

Boundaries, not oversights.

| Limitation | Consequence | What would resolve it |
|---|---|---|
| No payment provider | Money moves outside the app; the ledger records claims and confirmations | A settlement provider behind the existing `payments` state machine |
| No push notifications | Nothing is delivered while the app is closed | FCM/APNs behind the existing notification service |
| No notification settings screen | Toggles and quiet hours work through the API, but the student app has no screen for them yet | A settings sheet on the profile, calling `PATCH /users/me/notification-preferences` |
| Realtime hub and request budget are in-process | Multiple API instances would not share subscribers or budgets | Redis pub/sub or PostgreSQL `LISTEN/NOTIFY` behind `publish()` |
| Uploads on local disk | Lost on an ephemeral container | S3 behind the same authorising route |
| Offset pagination on the feed | Deep pages slow down | Keyset pagination on `(score, id)` |
| GPS is spoofable | Location verification is a signal, not proof | Nothing technical fully solves this; every event is recorded for review |
| Browser run is not in CI | It needs a local Chrome and the three servers | A CI job with a Chrome image |
| Circular geofence only | A rectangular campus fits it loosely | A polygon boundary; the column layout already anticipates it |
| Single campus | No cross-campus anything | The schema is campus-scoped throughout, so it extends — but onboarding was out of scope |

---

## Things a reviewer might reasonably ask

**"Is the Row Level Security real, or decorative?"**
Real. `security.test.ts` attacks the database directly as the `campusbuddy_app` role, bypassing
the API entirely, and asserts that role changes, self-verification and earnings inflation are all
refused by the database. Superusers bypass RLS, which is why user traffic runs under a role that
is not one.

**"What stops two helpers being accepted for the same request?"**
Three things, in order: the state machine refuses the second transition; the selection path locks
the request row with `SELECT … FOR UPDATE`; and a partial unique index on accepted offers makes
it impossible even if both of those were somehow bypassed.

**"Why integer paise?"**
`0.1 + 0.2 !== 0.3`. Reward escalation and deposit settlement compound the error, and a ledger
that drifts is not recoverable. There is a unit test asserting exactly this.

**"How can a new student ever get work?"**
The matching module scores missing history as neutral-positive rather than zero, and ratings are
shrunk toward a 3.5-star prior so a veteran's record cannot be unbeatable. A test asserts a
newcomer scores above 0.4 while still ranking below a proven helper.

**"What happens if the requester never pays?"**
The request sits at `PAYMENT_PENDING`. Either party can open a dispute, which freezes it and
sends it to a moderator, who can rule for either side. Nothing quietly resolves itself.

---

## If work continued

In the order that would add the most value:

1. **A notification settings screen** — the API and the database already honour every toggle and
   quiet-hours window; only the screen is missing.
2. **The browser run in CI**, over the same seeded data.
3. **A settlement provider**, turning the recorded ledger into real escrow.
4. **Push notifications**, so a request reaches someone who does not have the app open.
5. **Photos in chat and listings** — the upload pipeline, ownership checks, visibility rules and
   signed links all serve these already; only their compose UI is missing.
6. **A polygon geofence**, for a campus that a circle fits badly.
7. **Redis-backed realtime**, the single change needed to run more than one API instance.

Explicitly *not* next: multi-campus onboarding, or AI features. The specification asks for one
campus done well, and warns against AI that does not actually process anything. Both remain the
right call.
