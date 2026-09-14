# Product specification, as built

CampusBuddy against the original specification: what exists, where it lives, and where the
implementation deliberately diverged.

---

## The one-line description

> CampusBuddy is a verified, NIT Patna Bihta Campus-restricted peer-to-peer marketplace that lets
> students request and provide small services, assistance, rentals, academic resources and other
> student-to-student support in exchange for rewards. It combines campus verification,
> geolocation, realtime requests, matching, communication, transaction tracking and reputation
> into a single campus ecosystem.

---

## Coverage

| Spec area | Status | Where |
|---|---|---|
| §8 Registration | Built | `modules/auth`, `screens/auth/Register` |
| §9 College email verification | Built — hashed, expiring, rate limited | `modules/verification` |
| §10 Campus geolocation verification | Built — circular geofence | `modules/verification`, `shared/geo` |
| §11 Multi-signal verification | Built — the method is a stored field, not an assumption | `verification_records.method` |
| §12 Campus isolation | Built — PostgreSQL RLS | `009_rls_policies.sql` |
| §13 Profiles | Built — including profile photos | `screens/Profile`, `public_user_profiles` |
| §14 Home dashboard | Built | `screens/Home` |
| §15–19 Requests | Built — all fields, deadlines, visibility scopes | `modules/requests` |
| §20 Urgency | Built — ranks higher, notifies first | feed scoring |
| §21 Reward model | Built — cost, reward and total shown separately | `screens/CreateRequest` |
| §22 Dynamic escalation | Built — manual and automatic, with a ceiling and history | `jobs/scheduler` |
| §23 Discovery | Built — filters, five sorts, pagination | `modules/requests/feed` |
| §24 Matching | Built — weighted, documented, UI-independent | `shared/matching` |
| §25 Offers and bidding | Built — duplicates and races impossible | `modules/requests/routes` |
| §26 Status machine | Built — 14 states, actor-aware | `shared/status-machine` |
| §27 Acceptance | Built — atomic, row-locked | `select-helper` |
| §28 Cancellation | Built — stage-dependent, affects reliability | transitions + triggers |
| §29 Realtime | Built — WebSocket, authorised channels | `realtime/` |
| §30 Chat | Built — participants only | `modules/chat` |
| §31 Location features | Built — coarsened public, exact for participants | `core/serializers` |
| §32 Notifications | Built — persisted, realtime, preference-aware, quiet hours | `modules/notifications` |
| §33 Availability | Built | `user_preferences` |
| §34 Completion flow | Built — with rejection and retry | transitions |
| §35–37 Payments | Built — UPI QR code and UPI ID, honest workflow | `modules/payments`, `screens/PaymentPanel` |
| §38 Two-way ratings | Built — multi-dimensional, immutable | `modules/ratings` |
| §39–40 Reputation | Built — Bayesian, in-database | `008_reputation_triggers.sql` |
| §41–42 Rentals | Built — full lifecycle, deposits | `modules/rentals` |
| §43 Marketplace | Built | `modules/listings` |
| §44–46 Academic, tutoring, technical help | Built — as categories with skills and tutor profiles | `shared/constants` |
| §47 Search | Built — GIN full-text | `requests_search_idx` |
| §48 Favourite helpers | Built — private | `favourite_helpers` |
| §49 Repeat requests | Built — returns a draft to review | `/requests/:id/repeat` |
| §50 Scheduled requests | Built — activated by a job | `activateScheduledRequests` |
| §54 Communities | Built — hostel, department, year visibility | `requests.visibility_*` |
| §56–58 Dashboards | Built | `screens/Home`, `Tasks`, `Earnings` |
| §59–60 Admin and roles | Built — 4 roles | `modules/admin` |
| §61–62 Reports and disputes | Built — disputes freeze the transaction | `modules/moderation` |
| §63 Fraud prevention | Built — see SECURITY.md | throughout |
| §64 Privacy | Built | serialisers + RLS |
| §65–67 Database design | Built — 31 tables | DATABASE.md |
| §68–70 Security, RLS, storage | Built | SECURITY.md |
| §71–72 Notification and event architecture | Built | `notifications/service`, `DOMAIN_EVENTS` |
| §73 Analytics | Built | `/admin/analytics` |
| §77 Gamification | Built — badges and tiers | `refresh_user_reputation` |
| §79–83 UX, design system, accessibility, error states | Built | `styles/global.css`, `useAsync` |
| §84–86 Offline, idempotency, time | Built — the installed app opens offline and keeps the session; clock times in campus time | `sw.js`, `api.ts`, unique constraints, `core/campus-time` |
| §87 Search and performance | Built — indexed, paginated | DATABASE.md |
| §89 Testing | Built — 177 tests, plus a browser run of the key flows | TESTING.md |
| §90 Demo data | Built — 26 accounts, every lifecycle stage | `seed/` |
| §91–93 Documentation | Built — 9 documents | this repository |

### Not built, deliberately

| Spec area | Why |
|---|---|
| §51 Request bundling | The spec itself says not to attempt route optimisation before the core marketplace is reliable |
| §52 Campus heat map | Analytics exist; the geospatial visualisation would need a mapping library for little added insight |
| §53 Exam season mode | Would need an academic calendar the project does not have |
| §75–76 AI features | The spec lists these as future work and warns against fake AI. Nothing is stubbed |
| §78 Campus points | Would blur the line the spec asks to keep sharp between money, reputation and gamification |

---

## Divergences worth stating

**1. Web PWA rather than Flutter.**
The spec preferred Flutter and Supabase. This machine had neither, and a stack that cannot be
run cannot be shown to be correct. The React PWA is installable to a phone home screen, uses
real geolocation, and — the deciding factor — every claim in this repository is verified by
tests that actually execute. The backend architecture is unchanged by the choice: it is a
PostgreSQL database with RLS behind an HTTP API, which is what the Supabase design would have
been.

**2. PGlite rather than a Supabase project.**
Same reasoning, and no functional loss: PGlite *is* PostgreSQL 18, including the RLS the spec
asks for. Setting `DATABASE_URL` points the identical code at a Supabase or any other PostgreSQL
instance.

**3. Payments are recorded, never claimed as verified.**
The spec is emphatic (§35, §122) that QR scanning must not be presented as proof. The schema
encodes the distinction: `PAYMENT_CLAIMED` is the payer's unverified word, `PAYMENT_CONFIRMED`
is the payee's confirmation, and only the second moves money in the ledger or the request to
`PAID`.

**4. Notifications are in-app and realtime, not push.**
APNs/FCM needs platform credentials and a native shell. The notification service is written so a
push transport slots in behind it without touching a single call site.

**5. Departments and hostels are seeded with plausible names.**
NIT Patna's department list is public; the hostel block names in the seed are placeholders. Both
are editable from the admin panel.

---

## The demo, in order

The seed is arranged so this can be walked without preparation:

1. **Register** with an `@nitp.ac.in` address — try `@gmail.com` first to see it refused.
2. **Verify** by email OTP (shown in the dev banner) or by campus location.
3. **Post** "Bring Cold Drink" — ₹20 cost, ₹10 reward, total derived as ₹30.
4. **In a second browser**, sign in as another student and watch it appear in the feed live.
5. **Offer** to help; watch the notification reach the first browser without a refresh.
6. **Select** the helper. The chat opens for both.
7. **Accept → Start → Complete** as the helper.
8. **Confirm** as the requester. A ₹30 payment opens with a UPI deep link.
9. **Mark as sent** — and point out the request is *still* `PAYMENT_PENDING`.
10. **Confirm receipt** as the helper. Now it is `PAID`.
11. **Both rate.** The request reaches `RATED` and the helper's reputation moves.
12. **Show the history** — every transition, with actor and timestamp.
13. **Escalation:** post a request with auto-escalation and a ceiling; show the reward rise.
14. **Rentals:** borrow the seeded calculator through to a settled deposit.
15. **Admin panel:** analytics, the open dispute, resolve it, then the audit log entry it wrote.

For the security discussion, `npm test` runs the 30 adversarial assertions in
`security.test.ts` — several of which attack the database directly rather than the API.

---

## What makes it more than CRUD

- **A state machine that is genuinely authoritative**, with actor-aware transitions, one writer,
  and an immutable history.
- **Row Level Security doing real work** — provable by attacking the database directly with the
  application role and watching it refuse.
- **A reputation model with defensible mathematics** — Bayesian shrinkage so one review cannot
  fake a record, and a floor so newcomers can still get work.
- **An honest payment design** that says what it does not know, and encodes that in the schema.
- **Privacy as a design decision**, not a disclaimer: coarsened coordinates, no background
  tracking, UPI details revealed only at the moment they are needed.
