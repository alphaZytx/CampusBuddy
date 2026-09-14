# Deployment

From this repository to something students can actually use.

---

## Development

```bash
cp .env.example .env
npm install
npm run db:reset     # schema + demo data
npm run dev          # API :4000, student app :5173, admin :5174
```

No database server, no Docker. The embedded PostgreSQL lives in `backend/.data/`, which is
git-ignored.

---

## Production

### 1. A real PostgreSQL server

The embedded database is for development and evaluation. For a deployment, provision PostgreSQL
15 or newer (Supabase, Neon, Railway, RDS or your own) and set:

```bash
DATABASE_URL=postgres://user:password@host:5432/campusbuddy
```

Nothing else changes — the driver abstraction means the same migrations and the same SQL run
against either.

**The migration needs privileges to create a role.** `001_roles_and_helpers.sql` creates
`campusbuddy_app`. On a managed provider that forbids `CREATE ROLE`, create it once by hand:

```sql
CREATE ROLE campusbuddy_app NOLOGIN;
```

The application must connect as the **owner** of the tables, not as `campusbuddy_app` — it
switches to that role per transaction with `SET LOCAL ROLE`. Connecting as `campusbuddy_app`
directly would break every trusted operation, including authentication.

```bash
npm run db:migrate
```

Migrations are idempotent and checksum-verified, so this is safe to run on every deploy.

### 2. Environment

```bash
NODE_ENV=production
PORT=4000
HOST=127.0.0.1          # nginx on the same machine; use 0.0.0.0 inside a container

# 48 random bytes. The server refuses to start with the development default.
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")

DATABASE_URL=postgres://…
CORS_ORIGINS=https://campusbuddy.example.edu,https://admin.campusbuddy.example.edu

# One reverse proxy (the nginx below) in front of the API. See "Client addresses".
TRUST_PROXY=1

EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASSWORD=…
SMTP_FROM=CampusBuddy <no-reply@campusbuddy.example.edu>

ALLOWED_EMAIL_DOMAINS=nitp.ac.in
CAMPUS_TIMEZONE=Asia/Kolkata
CAMPUS_CENTRE_LAT=…      # verified on the ground — see below
CAMPUS_CENTRE_LNG=…
CAMPUS_GEOFENCE_RADIUS_METRES=1500

S3_BUCKET=campusbuddy-production
S3_REGION=ap-south-1
S3_ENDPOINT=                    # only for a non-AWS S3-compatible provider
MALWARE_SCAN_URL=https://scanner.internal/scan
REDIS_URL=rediss://…
FIREBASE_SERVICE_ACCOUNT_JSON={"project_id":"…","client_email":"…","private_key":"…"}
```

`assertProductionSafety()` refuses to boot if `JWT_SECRET` is still the default or shorter than
32 characters, if `EMAIL_PROVIDER=console`, or if SMTP is chosen without a host or with the
`example.com` sender still in place — because none of those can deliver a verification code or
protect a session.

**Client addresses.** Registration, sign-in and OTP requests are rate limited per network
address, so the API must know each student's real address. `TRUST_PROXY` says how many proxies to
believe `X-Forwarded-For` from: `0` (the default) ignores the header entirely, so nobody can
invent an address; `1` trusts the single nginx in front of the API. Set it to the number of
proxies you actually run — too low and every student appears to share the proxy's address; too
high and a client can spoof theirs.

**Campus Wi-Fi.** Hostels often share one public address. The per-address sign-in limit
(`AUTH_IP_RATE_LIMIT_MAX`, 100 per 5 minutes) is therefore far looser than the per-account one
(`AUTH_RATE_LIMIT_MAX`, 10 per 5 minutes), and registration allows 30 accounts per address per
hour (`REGISTER_RATE_LIMIT_MAX`). Raise them if a whole campus sits behind one address.

### 3. Verify the campus geofence

**Do this before students rely on it.** The coordinates in `.env.example` are approximate. Stand
on the Bihta campus, read your position from any maps app, and set it from **Admin → Campus**,
which updates it without a redeploy and writes an audit record.

The `.env` values seed the geofence and are re-applied on each start **until** an administrator
saves it from the panel. From then on the panel's values win, so a restart never undoes a
correction made on campus.

A radius of 1500 m comfortably covers a campus. Too small and students indoors fail
verification; too large and the check stops meaning anything.

### 4. Build and run

```bash
npm ci
npm run build          # produces mobile/dist and admin/dist
npm run db:migrate
npm start              # the API
```

Serve `mobile/dist` and `admin/dist` as static files from any web server or CDN. Both are SPAs,
so every unmatched path must fall back to `index.html`, and both need `/api` and `/ws` passed to
the API:

```nginx
# Shared by both sites: pass the real client address on, and allow photo uploads
# (the API accepts up to MAX_UPLOAD_BYTES, 5 MB by default; nginx's own default is 1 MB).
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  server_name campusbuddy.example.edu;
  root /srv/campusbuddy/mobile/dist;
  client_max_body_size 6m;

  location / { try_files $uri $uri/ /index.html; }

  location /api {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;   # the API pings every 30 s
  }
}

server {
  server_name admin.campusbuddy.example.edu;
  root /srv/campusbuddy/admin/dist;

  location / { try_files $uri $uri/ /index.html; }

  location /api {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Keep the API alive with systemd, PM2 or a container:

```ini
[Unit]
Description=CampusBuddy API
After=network.target

[Service]
WorkingDirectory=/srv/campusbuddy
ExecStart=/usr/bin/npm start
Restart=always
EnvironmentFile=/srv/campusbuddy/.env
User=campusbuddy

[Install]
WantedBy=multi-user.target
```

### 5. TLS

Terminate TLS in front of the API — Caddy or Certbot with nginx. Two reasons beyond the obvious:
geolocation is unavailable to browsers on insecure origins, and a PWA will not install without
HTTPS. With Caddy, `TRUST_PROXY=1` applies in the same way.

### 6. Uploads

Production requires `S3_BUCKET`; the API uses any S3-compatible object store with server-side
encryption, per-account/campus quotas and private, expiring application-signed URLs. Set
`MALWARE_SCAN_URL` to an internal service that accepts the raw bytes and returns `2xx` for clean
or `422` for rejected content. Put a CDN in front of `/api/uploads/*`; keep query strings in its
cache key and never strip the signature or expiry.

Local development still uses `UPLOAD_DIR`. Unattached uploads are purged after 24 hours and
linked media follows the retention of its parent record.

---

## Android app (APK)

The student app is also packaged as an Android app with Capacitor (`mobile/android`). Its
screens ship inside the APK; on first launch it asks for the server address, checks it, and
remembers it. Changing server later is one tap on the welcome screen — no new APK.

**The server must allow the app's origin:** keep `http://localhost` in `CORS_ORIGINS`.

Build (needs Android Studio's SDK and its bundled Java):

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
VITE_DEFAULT_SERVER=https://campusbuddy.example.edu npm run android:apk
# → mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

`VITE_DEFAULT_SERVER` only pre-fills the first-launch box. To try the app against a laptop on
the same Wi-Fi, set `HOST=0.0.0.0` in that laptop's `.env` (with a real `JWT_SECRET`, since the
server is then reachable from the network) and use its Wi-Fi address, e.g.
`http://192.168.1.20:4000`. Many campus networks block device-to-device traffic; a phone
hotspot avoids that.

The build is a **debug** APK: fine for installing directly on phones, not for the Play Store,
which needs a release build signed with your own key. The app allows plain `http` servers so a
laptop works during testing; a deployed server should use `https`.

For closed-app push notifications, create an Android app named `com.campusbuddy.app` in Firebase,
place its real `google-services.json` at `mobile/android/app/google-services.json`, and set the
matching server service-account JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`. Do not commit either
credential. Notification taps carry an internal path and open the relevant request, chat,
payment or rental screen.

---

## Creating the first administrator

Registration always creates a `STUDENT`. Promote one directly, once:

```sql
UPDATE users SET role = 'PLATFORM_ADMIN' WHERE email = 'you@nitp.ac.in';
```

That admin can then grant `CAMPUS_ADMIN` and `MODERATOR` from the panel. Nobody can change their
own role or suspend themselves, only a `PLATFORM_ADMIN` can create another, and a campus admin
cannot change a platform admin's account.

---

## Operating notes

**Health check.** `GET /api/health` returns status, driver and campus. Point your uptime monitor
at it.

**Logs.** Structured JSON in production, redacting passwords, tokens, OTPs, UPI IDs and exact
coordinates by key. Every 500 carries a `requestId` that matches the response the user saw.

**Backups.** Enable provider snapshots and point-in-time recovery for PostgreSQL plus object
versioning/lifecycle rules for S3. `scripts/backup-postgres.sh` creates a portable custom-format
snapshot for restore drills. Test restoration in staging; an untested backup is not a backup.

**Migrations on deploy.** Run `npm run db:migrate` before starting the new version. Adding a
migration is safe; editing an applied one is refused, because it would silently produce different
schemas on different machines. Always add a new file instead.

**Scaling.** API instances are stateless behind a load balancer. Redis Pub/Sub fans WebSocket
events across instances; signed-in rate limits and idempotency keys are database-shared; push
delivery uses a durable outbox with retry/dead-letter state. During shutdown each process stops
jobs, disconnects WebSockets and drains Fastify before closing the pool. Use a managed PostgreSQL
primary with pooling/PITR; direct only analytics and explicitly stale-safe reads to replicas after
measuring replication lag. Validate indexes using slow-query logs and `pg_stat_statements`.

**Environments and rollback.** Use separate projects/accounts, databases, Redis namespaces,
object buckets and Firebase apps for development, staging and production. The CI workflow checks
types, lint, all migrations/tests, web builds, production dependencies and an Android build.
Deploy an immutable image from the tested commit, run migrations once, then roll instances
gradually. Roll back application images independently; use forward-fix migrations rather than
reversing a migration that may already contain production data.

---

## Deployment checklist

- [ ] `DATABASE_URL` on managed PostgreSQL with automated backups
- [ ] Connection pool sized below the provider limit; slow-query alerts and `pg_stat_statements` enabled
- [ ] Restore drill completed; replica lag and failover tested
- [ ] `campusbuddy_app` role exists; the app connects as the table owner
- [ ] `JWT_SECRET` freshly generated
- [ ] `NODE_ENV=production`
- [ ] `EMAIL_PROVIDER=smtp` with credentials that actually send, and a real `SMTP_FROM`
- [ ] `CORS_ORIGINS` set to the real origins
- [ ] `TRUST_PROXY` matches the proxies in front of the API, and they send `X-Forwarded-For`
- [ ] `client_max_body_size` at least the upload limit
- [ ] TLS in front of the API and both front ends
- [ ] Campus coordinates verified on the ground and saved from Admin → Campus
- [ ] Private S3 bucket, malware scanner, quotas and lifecycle rules configured
- [ ] Redis configured and reachable from every API instance
- [ ] Firebase service account and Android `google-services.json` belong to the same Firebase app
- [ ] First administrator promoted
- [ ] `npm run db:migrate` in the deploy pipeline
- [ ] `/api/health` monitored
- [ ] Admin → Operations has no dead-letter backlog
- [ ] CI is green and staging Android smoke test completed
