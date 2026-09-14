# Testing

**177 tests across 6 suites**, plus a 16-check browser run of the production builds.

```
✓ tests/unit.test.ts       (44)  pure business logic, no database
✓ tests/lifecycle.test.ts  (22)  the complete transaction, end to end
✓ tests/security.test.ts   (30)  what a determined client must not be able to do
✓ tests/features.test.ts   (33)  chat, rentals, marketplace, discovery, jobs, moderation
✓ tests/media.test.ts      (23)  profile photos, payment QR codes, uploads, signed links
✓ tests/review.test.ts     (25)  regressions for every problem found in the pre-release review
```

```bash
npm test                 # everything
npm run test:watch       # watch mode
npx vitest run --root backend tests/security.test.ts   # one suite
npm run lint             # ESLint, including the React hooks rules
npm run typecheck        # TypeScript across all four workspaces
npm run test:e2e         # the browser run — see below
```

Every suite runs against a **fresh in-memory PostgreSQL**, so tests never touch the development
database and never depend on each other's leftovers. Requests go through `app.inject`, Fastify's
in-process dispatcher, which runs the entire middleware stack — auth resolution, validation,
error mapping and RLS — exactly as it does over HTTP, without binding a port.

---

## What each suite covers

### Unit — the rules themselves

No database, no HTTP. These are the calculations the whole marketplace depends on.

- **Money.** That `0.1 + 0.2` really does equal `0.3` in paise; Indian-style thousands grouping;
  whole rupees drop their decimals.
- **Geo.** Haversine against a known 111 m distance; geofence membership at the boundary;
  rejection of "null island" `(0,0)`; that coarsening actually moves the published point.
- **State machine.** The happy path start to finish; that steps cannot be skipped; and — the
  important ones — that a *legal* transition attempted by the *wrong actor* is refused. A helper
  cannot confirm their own completion. A requester cannot cancel work already in progress.
- **Matching.** Scores stay in 0..1; a closer, better-matched helper outranks a distant one;
  busy/too-far/underpaid helpers are excluded; and a brand-new student still scores well enough
  to win work without outranking a proven helper.
- **Reputation.** That a single five-star review does *not* read as a flawless record; that a
  fresh account is treated as new rather than bad; that frequent cancellation costs you.
- **Quiet hours** across midnight, and **rental billing** rounding part-periods up.
- **UPI links.** Reading the payee from a `upi://pay` code; rejecting websites, mandates and
  malformed addresses.
- **Signed file links.** Rejecting a link moved to another file, extended, altered or expired;
  identical links within an hour so images cache; always at least an hour of validity.
- **Metadata stripping.** EXIF, comments and appended data removed from a JPEG while byte
  stuffing and restart markers survive intact; PNG text chunks removed; a clean PNG unchanged
  byte for byte; a truncated file refused.

### Lifecycle — the demo, as a test

Nineteen numbered steps walking the exact flow the project demonstrates:

```
 1. Rahul posts "Bring Cold Drink" — ₹20 cost + ₹10 reward, total derived as ₹30
 2. It appears in Aman's feed, but not in his own-requests list
 3. Rahul cannot offer to help with his own request
 4. Aman offers → the request moves to OFFERS_RECEIVED
 5. Offering again updates the offer instead of creating a second one
 6. Rahul is notified
 7. Rahul selects Aman → chat opens
 8. Aman accepts, starts, completes
 9. Aman cannot confirm his own completion
10. Rahul confirms → a ₹30 payment is opened
11. Rating is refused before the payment is confirmed
12. Rahul claiming payment does NOT mark the request paid
13. Rahul cannot confirm receipt on Aman's behalf
14. Aman confirms receipt → PAID
15. Both rate → RATED
16. A duplicate rating is refused
17. Aman's reputation and earnings update
18. The full status history was recorded, in order
19. The first-task badge was awarded
```

Plus dynamic reward escalation: raising works, lowering is refused, the ceiling is enforced, the
history is recorded, and a helper cannot change the reward. And payment notifications: the payee
is told when money is marked as sent, the payer when receipt is confirmed.

### Security — the adversarial suite

Grouped by what is being attempted:

| Group | Examples |
|---|---|
| Authentication | Forged and tampered tokens; identical wording for unknown-email and wrong-password; registration blocked outside the campus domain; password change revokes sessions; **refresh-token reuse kills the session family** |
| Verification gating | Unverified students cannot post; location verification refused from Mumbai and accepted from campus; a wrong OTP does not verify |
| Ownership | A client-supplied `requesterId` and `status` are ignored; strangers cannot cancel, edit, withdraw another's offer, or rate a task they had nothing to do with |
| Privilege escalation | Self-promotion via the profile endpoint; **direct database attempts** to change role, self-verify, or inflate earnings as the application role; the admin panel closed to students; a self-signed admin claim rejected |
| Database guarantees | Ratings immutable; self-rating refused; two accepted offers impossible; paying yourself refused; a payment amount cannot be edited |

Several of these bypass the API entirely and attack the database directly as `campusbuddy_app`,
because that is the only way to prove RLS and the triggers — not just the route handlers — are
actually holding.

```ts
await expect(
  db.asUser(context, (tx) =>
    tx.query(`UPDATE users SET role = 'PLATFORM_ADMIN' WHERE id = $1`, [outsider.id]),
  ),
).rejects.toThrow(/Roles can only be changed by an administrator/);
```

### Media — photos and QR codes

- **Profile photos.** Upload, then served to other students through a signed link that works
  with no token; altered, moved and unsigned links refused; GPS and comments stripped from a JPEG;
  replacing a photo deletes the old file; removal; only JPG and PNG accepted; a damaged image
  refused; an external image address ignored; and — directly in the database — pointing a profile
  at another student's upload rejected by the trigger.
- **Payment QR codes.** Saved; kept when the UPI ID changes; absent from the public profile;
  shown to the payer while payment is due, as a link that actually serves the image; hidden from
  the payee and from strangers; unreadable by id with another student's token; gone once
  payment is confirmed; removable without losing the UPI ID.
- **General uploads.** The uploader gets a signed link, while by id the file stays private to its
  owner; profile purposes redirected to their own endpoints; a 1.5 MB file accepted despite the
  1 MB JSON limit; a file over 5 MB refused with `413`.

### Features — everything else

- **Chat.** Opens only once a helper is committed; both participants can talk; a third student
  gets 404 on read and is refused on write; empty messages rejected; unread counts clear on read.
- **Rentals.** Listing; owner cannot rent their own item; **fee computed server-side and a
  client-supplied price ignored**; the full lifecycle through to a settled deposit; over-refund
  refused; double-booking blocked by the unique index.
- **Marketplace.** Create and find by search; a giveaway is forced to be free; only the seller
  can edit; removal drops it from the feed.
- **Discovery.** Filters by category, reward and text; sorting; pagination returning distinct
  pages; a department-restricted request invisible to other departments; **exact coordinates
  hidden from non-participants while the requester still sees their own**.
- **Background jobs.** Expiry; escalation clamped to the ceiling and idempotent on a second
  pass; a full pass runs clean.
- **Moderation.** Reports and duplicate refusal; a dispute freezing a request; outsiders cannot
  open one; admin resolution unfreezing it; analytics without dividing by zero; suspension
  signing a student out immediately; an audit record for every admin action.

### Review — regressions

One test for each problem found in the pre-release review, each of which failed (or could not
have passed) before its fix:

| Area | What is asserted |
|---|---|
| Helpers leaving | A selected helper can decline; a helper can withdraw mid-task, the requester can reopen and choose again — including a helper passed over the first time — and the former helper loses access to the chat |
| Lifecycle refusals | A stale move answers `409 INVALID_TRANSITION`, the wrong party `403 ACTION_NOT_ALLOWED` — never a 500 |
| Preferences | New-request alerts reach only helpers whose own settings match, never an opted-out or busy one, never the requester; an "offers off" helper is not notified; saving one setting keeps quiet hours; an availability end time can be cleared |
| Verification | Every wrong OTP is counted, and the code is retired after the last allowed attempt — even the right code then fails |
| Sessions | Signing out with a refresh token ends that device only, with no access token needed |
| HTTP | A forged `X-Forwarded-For` is ignored; an unknown origin gets no CORS headers instead of a 500; API responses are `no-store` and `nosniff` |
| Invitations | Only verified students on the campus, never yourself; only the invitee is alerted, and a bystander gets 404 |
| Files | Attaching another student's upload is refused; a listing photo reaches other students through a link an `<img>` can load |
| Admin | A campus admin cannot demote or suspend the platform admin; nobody can suspend themselves; a geofence saved in the panel survives a restart |
| Disputes | A dismissed dispute returns the request to where it was, with no payment recorded; ruling for the helper mid-task opens the missing payment |
| Rentals | The owner can cancel a reservation; staff cannot act as either side; a disputed item stays booked until resolved; a finished rental cannot be disputed |
| Scheduled requests | Quiet, unescalated and closed to offers until their time; then announced to matching helpers, with escalation counted from going live |
| Campus time and budgets | Clock times read in campus time on any server; the per-student request budget allows its quota, then asks the student to wait |

---

## Deterministic time

Jobs are tested by moving the data rather than waiting on the clock:

```ts
await db.query(`UPDATE requests SET deadline_at = now() - interval '1 minute' WHERE id = $1`, [id]);
expect(await expireRequests(db)).toBeGreaterThanOrEqual(1);
```

`runJobsOnce` is exported for exactly this. The scheduler is disabled in tests
(`DISABLE_JOBS=true`) so nothing runs behind the suite's back.

---

## The browser run

`scripts/e2e.mjs` drives the **production builds** of both front ends in headless Chrome
against the real API and the seeded demo data — 16 checks, including:

- Rahul posts a request; Aman's offer reaches him live, without a refresh; he selects Aman.
- Aman accepts, starts and withdraws; Rahul reopens and chooses a helper again.
- Signing out on one device leaves the student signed in on another.
- "Contact the seller" opens a pre-filled request only the seller can see, and sends it.
- Offline, the installed app still opens, says so, and keeps the session; back online, it
  recovers by itself.
- The admin panel refuses an empty geofence field.
- No uncaught error in either app throughout.

It creates data, so run it against freshly reset demo data:

```bash
npm run db:reset && npm run build
npm start                                     # API on :4000
npm run preview -w mobile -- --port 4173      # production student app
npm run preview -w admin -- --port 4174       # production admin panel
npm run test:e2e
```

It uses the Chrome installed on the machine (`puppeteer-core` downloads no browser); set
`CHROME_PATH` elsewhere than macOS, and `APP_URL`, `ADMIN_URL` and `API_URL` to point it at
other servers.

For UI work, `npm run dev` and the demo accounts in the README are the fastest path: the seed
deliberately leaves requests at every stage of the lifecycle, plus an open report and an open
dispute for the admin panel.

---

## What is not covered

Stated plainly:

- **The browser run is not in CI.** It needs a local Chrome and the three servers running.
- **No load testing.** Index choices are reasoned about rather than measured.
- **SMTP delivery is untested** in CI, since it needs real credentials. The provider interface is
  covered, and a failing mail server is answered with a clear `503`; the wire itself is not.
