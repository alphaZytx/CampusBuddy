# CampusBuddy

**A verified, campus-restricted peer-to-peer marketplace for students of NIT Patna, Bihta Campus.**

One student needs a cold drink from the canteen, a calculator for three hours, or DBMS notes
before tomorrow's exam. Another student is already walking that way, owns that calculator, or
took those notes last semester. CampusBuddy connects the two, tracks the transaction from
request to payment to rating, and builds a reputation that makes the next one easier.

```
Need → Post request → Nearby students notified → Offers → Choose a helper
     → Chat → Task done → Confirm → Pay → Both rate → Reputation updates
```

---

## What is actually built

Everything below is implemented, wired end to end, and covered by tests. Nothing here is a
mockup or a placeholder screen.

| Area | Included |
|---|---|
| **Accounts** | Registration restricted to the campus email domain, scrypt password hashing, JWT access tokens, rotating refresh tokens with theft detection, sign-out per device |
| **Verification** | College-email OTP (hashed, expiring, attempt-limited, rate limited) and campus GPS geofencing — either one is sufficient |
| **Requests** | Create, discover, filter, search, sort, paginate; scheduled and private requests; 14-state lifecycle enforced by a shared state machine |
| **Offers** | Accept the listed reward or propose your own; duplicate offers and post-selection offers are impossible at the database level |
| **Rewards** | Manual increases and optional automatic escalation up to a ceiling, with full history |
| **Matching** | A documented, weighted scoring module, and new requests pushed only to helpers whose own settings match |
| **Realtime** | WebSocket push for offers, selections, status changes, reward changes, payments, rentals and chat |
| **Chat** | Request-scoped conversations, readable only by the two participants |
| **Profiles** | Profile photos — cropped to a square, with the phone's location data removed before storage; "ask privately" from any profile |
| **Payments** | The helper's UPI QR code (checked to be a real UPI code on upload) and UPI ID, shown only to the payer; UPI deep links; an honest state machine where only the payee's confirmation counts |
| **Ratings** | Two-way, multi-dimensional, one per person per task, permanently immutable |
| **Reputation** | Bayesian-adjusted rating, completion and cancellation rates, a reliability score, tiers and badges |
| **Rentals** | Item listings, deposits, a six-state rental lifecycle, disputes, and settlement |
| **Marketplace** | Buy, sell, exchange and give away, campus-only; contacting a seller opens a private request to them |
| **Moderation** | Reports, disputes that freeze a transaction, admin resolution, audit logging |
| **Admin panel** | Analytics, student management, report and dispute queues, campus geofence configuration |
| **Offline** | An installable PWA that opens without signal, keeps you signed in, and reconnects by itself |
| **Security** | PostgreSQL Row Level Security on every table, immutability triggers, rate limiting that cannot be dodged with a forged header, file-type verification, signed file links, image metadata stripping |

---

## Getting started

**Requirements:** Node.js 20 or newer. That is all — no Docker, no database server, no
external accounts.

```bash
git clone <your-repo-url> campusbuddy
cd campusbuddy

cp .env.example .env      # sensible development defaults; edit if you like
npm install
npm run db:reset          # creates the schema and loads demo data
npm run dev               # starts the API, the student app and the admin panel
```

| Service | URL |
|---|---|
| Student app (PWA) | http://localhost:5173 |
| Admin panel | http://localhost:5174 |
| API | http://localhost:4000/api |
| Health check | http://localhost:4000/api/health |

### Demo accounts

`npm run db:reset` creates 24 students, 2 staff accounts, and a campus with requests at every
stage of the lifecycle, marketplace listings, rentals, an open report and an open dispute.

| Account | Email | Role |
|---|---|---|
| Aman Singh | `aman.ug22.cs@nitp.ac.in` | Helper with a strong track record |
| Rahul Kumar | `rahul.ug22.cs@nitp.ac.in` | Requester |
| Ananya Mishra | `ananya.ug21.cs@nitp.ac.in` | Top-rated academic helper |
| Campus Administrator | `admin@nitp.ac.in` | Admin panel |
| Student Moderator | `moderator@nitp.ac.in` | Reports and disputes only |

Password for all of them: **`CampusBuddy@2026`**

All demo names, phone numbers and UPI handles are invented. No real personal data is in this
repository.

To demo the payment QR code, sign in as Aman, open **Profile → Payment details**, and upload
[`docs/demo/sample-upi-qr.png`](docs/demo/sample-upi-qr.png). It encodes Aman's fictional demo
UPI ID, so it is accepted without a mismatch warning. Then, as Rahul, take a request with Aman to
the payment stage and the QR appears under **Scan to pay**.

---

## Why this stack

CampusBuddy runs on **real PostgreSQL 18**, via [PGlite](https://pglite.dev) — PostgreSQL
compiled to WebAssembly and embedded in the Node process. The schema, constraints,
transactions, triggers, generated columns, full-text search and Row Level Security are all
genuine PostgreSQL. It simply needs no server to install and no Docker to run, which makes the
project clone-and-run for anyone evaluating it.

For a real deployment, set `DATABASE_URL` and the same code talks to an ordinary PostgreSQL
server instead. Nothing above the database driver knows or cares which is in use.

```
campusbuddy/
├── packages/shared/     Domain model shared by every part of the system:
│                        state machines, matching, reputation, money, validation
├── backend/             Fastify API, PostgreSQL schema, RLS policies, jobs, tests
│   ├── migrations/      15 ordered, checksum-verified SQL migrations
│   ├── seed/            Demo dataset
│   └── tests/           177 tests: unit, integration, security, media, regressions
├── mobile/              React PWA — the student app
├── admin/               React admin panel
└── docs/                Architecture diagrams and supporting notes
```

The shared package is the reason the client can never disagree with the server about what a
valid request looks like or which buttons should be enabled: both import the same Zod schemas
and the same state machine.

---

## Commands

```bash
npm run dev            # API + student app + admin panel together
npm run dev:backend    # API only
npm test               # backend unit and end-to-end API tests
npm run typecheck      # TypeScript across all four workspaces
npm run lint           # ESLint, including the React hooks rules
npm run db:migrate     # apply new migrations
npm run db:reset       # drop, rebuild and reseed (development only)
npm run build          # production builds of both front ends
```

---

## Configuration

Everything is in `.env` — see `.env.example` for the annotated list. The values worth knowing:

| Variable | Purpose |
|---|---|
| `ALLOWED_EMAIL_DOMAINS` | Who may register. Defaults to `nitp.ac.in` |
| `CAMPUS_CENTRE_LAT` / `LNG` / `GEOFENCE_RADIUS_METRES` | The campus geofence used for location verification |
| `CAMPUS_TIMEZONE` | Quiet hours and reminder times are read in it. Defaults to `Asia/Kolkata` |
| `EMAIL_PROVIDER` | `console` for development, `smtp` for real delivery |
| `JWT_SECRET` | Must be replaced before any real deployment |
| `DATABASE_URL` | Set to use an external PostgreSQL server instead of the embedded one |
| `TRUST_PROXY` | How many reverse proxies sit in front of the API — `0` locally, usually `1` in production. See [DEPLOYMENT.md](DEPLOYMENT.md) |
| `REDIS_URL` | Cross-instance realtime event fan-out |
| `S3_BUCKET` / `MALWARE_SCAN_URL` | Durable private media and upload scanning |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | FCM delivery while Android is backgrounded or closed |

> **The campus coordinates in `.env.example` are approximate.** Before a live demo, stand on the
> Bihta campus, read your actual coordinates from any maps app, and set them from
> **Admin → Campus**, which edits them without a redeploy. Once saved there, they take precedence
> over `.env` on every restart. Location verification depends on them being right.

---

## Two deliberate honesty decisions

**CampusBuddy does not move money.** It builds a UPI deep link, opens the payer's own UPI app,
and records what each side says happened. Opening a payment app proves nothing about whether a
transfer succeeded, so the app never claims it did: a request only becomes `PAID` when the
**person receiving the money** confirms it arrived. A payer's claim alone is recorded as a
claim and nothing more. There is a test that asserts exactly this.

**Verification codes in development are not fake.** With `EMAIL_PROVIDER=console`, the OTP is
genuinely generated, hashed with an HMAC, stored, rate limited, expired and verified — only the
delivery is local, and the UI says so in plain words. Set `EMAIL_PROVIDER=smtp` with your SMTP
credentials and the same flow sends real email. The server refuses to start in production with
the console provider.

---

## Documentation

| File | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system fits together, and why each significant decision was made |
| [DATABASE.md](DATABASE.md) | Full schema, relationships, indexes, and the integrity rules |
| [API.md](API.md) | Every endpoint, with request and response shapes |
| [SECURITY.md](SECURITY.md) | The threat model and each control that answers it |
| [TESTING.md](TESTING.md) | What is tested, and how to run it |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Going from this repository to a running deployment |
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | The product as built, mapped to the original specification |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Current state, known limitations, and what would come next |

---

## Known limitations

These are deliberate boundaries, not oversights. Each is explained in
[PROJECT_STATE.md](PROJECT_STATE.md).

- **No real payment integration.** Payments are recorded, not processed. A settlement provider
  would slot in behind the existing `payments` state machine.
- **Push notifications are in-app and realtime only.** There is no APNs/FCM delivery, because
  that needs platform credentials and a native shell.
- **GPS is one signal, not proof.** A determined student can spoof a location. That is why
  every verification event is recorded with its method and measurements for later review.
- **Single campus by design.** The schema is campus-scoped throughout and would extend to more
  campuses, but multi-tenant onboarding was explicitly out of scope.
