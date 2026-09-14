# Security

The threat model CampusBuddy was built against, and the control that answers each threat.

The governing principle is the specification's: **never trust the client** for identity, role,
campus, price, status, completion, ownership or payment state. Every one of those is derived or
re-validated on the server, and most are additionally enforced by PostgreSQL.

---

## 1. Defence in depth

Four independent layers. A failure in one does not open the door.

```
1. Validation      Zod schemas, shared with the client so they cannot disagree
2. Authorisation   Session-derived identity, role checks, participant checks
3. Row Level       PostgreSQL policies — a forgotten WHERE clause returns nothing
   Security        rather than everything
4. Constraints     Unique indexes, CHECKs and triggers that make invalid states
   & triggers      unrepresentable
```

---

## 2. Identity and impersonation

**Threat.** A client claims to be someone else, or acts on another campus.

**Controls.**

- Campus membership is derived from the email domain at registration and is never accepted from
  a request body.
- Access tokens are HS256 JWTs, but the token is treated as *proof of identity only*. Role,
  verification and account status are re-read from the database on every request, so a
  suspension takes effect immediately rather than at token expiry.
- A token minted before a student changed campus stops working.
- Every write policy pins ownership:

  ```sql
  CREATE POLICY requests_insert ON requests FOR INSERT WITH CHECK (
    campus_id = app_current_campus_id() AND requester_id = app_current_user_id()
  );
  ```

**Tested.** `security.test.ts` posts a request with `requesterId` set to another student and
asserts the created request belongs to the caller; a forged token claiming `PLATFORM_ADMIN` is
rejected with 401.

---

## 3. Credentials

- **scrypt** (memory-hard, from Node's standard library — no native module to trust), 16384/8/1,
  16-byte random salt, parameters stored with the hash so they can be raised later.
- Comparison is constant-time.
- **Password hashes live in `user_credentials`, a table the application role has no grant on at
  all.** Authentication runs in the trusted service context. A flaw in an ordinary query path
  cannot reach a credential.
- Login runs a hash comparison even when no such account exists, so response time does not
  reveal whether an email is registered — and both failures return identical wording.
- Changing a password revokes every other session.

---

## 4. Sessions

- Refresh tokens are 48 bytes of entropy, stored **only as a SHA-256 hash**. A database leak
  cannot be replayed as a login.
- Every refresh rotates the token, and the rotation is claimed with a single conditional
  `UPDATE`, so two refreshes racing with one token cannot both succeed. Presenting an
  already-rotated token is treated as theft: **every session for that user is revoked**.
- Signing out sends the device's own refresh token and ends that session only; it needs no valid
  access token, so it works however long the app was closed. The student's other devices stay
  signed in.
- The apps end a session only when the server refuses it. Losing signal while a token is being
  refreshed keeps the stored session.

**Tested.** The reuse path, and signing out one device while another stays signed in, are both
asserted end to end.

---

## 5. Campus isolation

**Threat.** A student reads another campus's requests, chats or payments.

**Control.** Row Level Security on every table holding user data, enforced by PostgreSQL for a
role with no `BYPASSRLS`. Frontend filtering is treated as cosmetic.

```ts
db.asUser({ userId, campusId, role }, async (tx) => {
  // SET LOCAL ROLE campusbuddy_app; set_config('app.user_id', …, true);
  // Every policy below now applies. A missing WHERE clause returns nothing.
});
```

Whether a transaction is trusted is decided by `current_user`, not by a session variable, so a
forgotten or forged setting cannot promote a request into the service context.

Restricted visibility (hostel, department, year, trusted-helpers-only) is enforced in the same
`SELECT` policy, and the targeting is **frozen at creation** — editing your profile later cannot
retroactively widen who could see an old request. A private request can only be addressed to
verified, active students on the same campus.

**Tested.** A department-restricted request is invisible in another department's feed *and*
returns 404 by direct id.

---

## 6. Privilege escalation

**Threat.** A student makes themselves an admin, self-verifies, or inflates their reputation.

**Control.** `guard_user_immutables`, a `BEFORE UPDATE` trigger that raises for anything but the
service context:

```sql
IF NOT app_is_service() THEN
  IF NEW.role            <> OLD.role            THEN RAISE …
  IF NEW.is_verified  IS DISTINCT FROM OLD.is_verified THEN RAISE …
  IF NEW.account_status  <> OLD.account_status  THEN RAISE …
  IF NEW.total_earned_paise <> OLD.total_earned_paise
     OR NEW.completed_tasks <> OLD.completed_tasks
     OR NEW.reliability_score <> OLD.reliability_score THEN RAISE …
END IF;
```

**Tested.** Three tests attempt each of these *directly against the database as the application
role*, bypassing the API entirely, and assert the trigger refuses.

---

## 7. Transaction integrity

**Threat.** Two helpers accepted for one request; a status skipped to `PAID`; a rating forged;
a payment amount edited.

**Controls.**

- `requests.status` is written in exactly one function, which validates against an actor-aware
  state machine first. A helper cannot confirm their own completion; a requester cannot mark a
  task done on the helper's behalf. A move the machine forbids is answered with 409 (stale) or
  403 (wrong party), never a 500.
- `UNIQUE INDEX … WHERE status = 'ACCEPTED'` makes two accepted offers impossible even under a
  race. A helper who withdraws takes their accepted offer with them, so the requester can choose
  someone else.
- Helper selection locks the request row with `SELECT … FOR UPDATE` before writing.
- Payment amounts are derived server-side from the stored request. `guard_payment_immutables`
  refuses any later change to the amount or the parties.
- Ratings are immutable: a `BEFORE UPDATE` trigger raises unconditionally.
- Rental disputes go through the rental state machine like every other rental change, and a
  disputed item stays out of circulation until a moderator resolves it.

Where a lock is not permitted — a helper offering on someone else's request cannot lock it,
correctly — correctness comes from a guarded `INSERT … SELECT` that re-checks the status inside
the same statement, plus the unique index.

---

## 8. Payment honesty

**Threat.** The app implies a transfer was verified when it was not.

**Control.** The design refuses to. The payment machine separates:

| State | Meaning |
|---|---|
| `PAYMENT_CLAIMED` | The payer says they sent it. **Unverified.** |
| `PAYMENT_CONFIRMED` | The payee confirms it arrived. **The only evidence.** |

A request reaches `PAID` only on the second. Earnings move only on the second. The payer is
returned 403 if they attempt `confirm_received`, and the UI states plainly that opening a UPI
app proves nothing. A dismissed dispute returns the request to where it was — it is never
closed as paid without a payment.

**Tested.** Explicitly: after `claim_sent` the request is asserted to still be
`PAYMENT_PENDING`.

---

## 9. Privacy

| Data | Treatment |
|---|---|
| Exact coordinates | Public feeds get a ~110 m grid. Exact positions only to the two participants |
| Location tracking | None. Position is read on explicit action and can be cleared with one tap |
| Phone numbers | Never in a public profile |
| UPI ID and QR code | Shown only to the person who currently owes money, and only until confirmed |
| Profile photos | Location and camera metadata removed — by the app before upload, and again by the server |
| Chat | RLS-restricted to conversation participants; a helper who is replaced loses access |
| Favourites | Visible only to the student who set them — nobody is told they were favourited |
| Preferences | Private to their owner. The server consults them through two narrow `SECURITY DEFINER` functions that answer only "should this student be alerted?" |
| Verification evidence | Readable by the student and staff only |
| Logs | A redacting logger strips passwords, tokens, OTPs, UPI IDs and exact coordinates by key name |

---

## 10. Abuse and spam

| Vector | Control |
|---|---|
| Mass registration | 30 accounts per hour per network address |
| Credential stuffing | 10 attempts per 5 min per account; 100 per 5 min per network address |
| OTP brute force | 6-digit code, 5 attempts per code (each miss is recorded before the refusal), 10-minute expiry, 60 s resend cooldown, 5 per hour |
| Runaway clients | 300 API requests per minute per signed-in student |
| Request spam | 20 per hour; at most 10 open at once |
| Message flooding | 120 per 5 minutes |
| Report brigading | One open report per person per target; 10 per day |
| Duplicate offers | Unique index |

Counters live in the database, so limits survive a restart and hold across processes; each
counter is serialised with a transaction-scoped advisory lock, so a burst of parallel attempts
cannot all slip under the limit. The `rate_limit_events` table is revoked from the application
role — the users being limited cannot read or forge the counters.

**Client addresses** come from the connection itself. `X-Forwarded-For` is honoured only from as
many proxies as `TRUST_PROXY` declares (none by default), so a client cannot rotate a made-up
header to escape a per-address limit.

---

## 11. File uploads

- 5 MB cap, one file per request.
- **Type verified by magic number**, not by the `Content-Type` header or the filename.
  Allowlist: JPEG, PNG, WebP, GIF, HEIC, PDF.
- The stored extension comes from the *detected* type, so an executable or an HTML page can
  never be written to disk.
- Stored under a random key outside any web root; reachable only through an authorising route.
- Served with `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options:
  nosniff`.
- Filenames are sanitised of directory separators and control characters.
- **Only your own files can be attached.** A trigger refuses a request, message, listing, rental
  item, dispute or completion proof that references another student's upload.
- **Access follows the parent record.** A file is visible to whoever can see what it is attached
  to — a listing photo to the campus, a chat image to the two participants — through an RLS
  policy that defers to the parent table's own policy. By id alone, a file is private to its
  owner.
- **Signed links.** An `<img>` tag cannot send a bearer token, so entitled viewers receive
  `/api/uploads/<id>?expires=…&signature=…` — an HMAC over the file id and expiry, with a key
  derived for this purpose alone. It cannot be moved to another file or extended, lasts one to
  two hours, and is compared in constant time.
- **Profile photos and QR codes lose their metadata.** A phone photo embeds the GPS position it
  was taken at — usually a hostel room. The app re-encodes images through a canvas before upload,
  and the server independently strips EXIF, XMP, IPTC, comments, PNG text chunks and anything
  appended after the image, refusing — rather than storing — a file whose structure it cannot
  follow.
- **No external image addresses.** A profile photo is always the student's own upload; the
  `guard_user_media` trigger rejects pointing it at anyone else's file. An arbitrary URL here
  would let one student make every viewer's browser fetch a tracking image.
- **A payment QR code is never public.** It is reachable only through a signed link handed to
  the student who currently owes its owner money, and only until that payment is confirmed. The
  app checks the image decodes to a genuine `upi://pay` link before upload; the server does not
  decode it, since a wrong code only affects its own uploader.

---

## 12. Admin actions

- Role re-checked server-side on every call; the panel decides only what to render.
- Only a `PLATFORM_ADMIN` can grant `PLATFORM_ADMIN`, and a campus admin cannot change a
  platform admin's account at all. Nobody can change their own role or suspend themselves.
- Suspension or deactivation revokes every session and closes any open realtime connection,
  signing the student out immediately.
- Every state-changing admin action writes to `audit_logs` with actor, target, metadata and IP.
- The audit log is append-only and readable only by admins.

---

## 13. Transport and headers

- CORS is an explicit allowlist from `CORS_ORIGINS`. Any other origin simply receives no CORS
  headers, so the browser blocks it.
- API responses carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store`, so private data never sits in a shared cache.
- 1 MB body limit; 5 MB multipart limit.
- Every response carries a correlation id; 500s log the stack server-side and return nothing
  specific to the client.
- Constraint, RLS and state-machine refusals are mapped to meaningful 4xx codes rather than
  leaking as 500s.
- Realtime connections that stop answering pings are dropped, so dead sockets never accumulate.

---

## 14. Production checklist

`assertProductionSafety()` refuses to boot with any of these unresolved:

- [ ] `JWT_SECRET` replaced with 32+ random bytes
- [ ] `EMAIL_PROVIDER=smtp` with a host and a real `SMTP_FROM`
- [ ] `NODE_ENV=production`

Additionally, before a real deployment:

- [ ] `DATABASE_URL` pointing at a managed PostgreSQL with backups
- [ ] TLS terminated in front of the API
- [ ] `TRUST_PROXY` matching the proxies in front of the API, which send `X-Forwarded-For`
- [ ] `CORS_ORIGINS` set to the real front-end origins
- [ ] Campus coordinates verified on the ground
- [ ] Uploads on persistent storage or object storage

---

## 15. What is not defended against

Stated plainly, because pretending otherwise would be the real vulnerability.

- **GPS spoofing.** A determined student can fake a location. That is why GPS is one signal
  among two, and why every verification event is recorded with its method, coordinates,
  distance and accuracy for later review.
- **Collusive rating inflation.** Two students can complete fake tasks and rate each other.
  Bayesian shrinkage limits the benefit and the audit trail makes the pattern visible, but
  nothing here detects it automatically.
- **Payment fraud between students.** CampusBuddy records claims; it cannot see a bank. The
  dispute system exists precisely because this cannot be solved technically without a
  settlement provider.
- **A compromised admin account.** Audit logs make actions traceable after the fact. There is no
  second factor.
- **A shared signed link.** Whoever holds a signed file link can open that file until it expires
  (at most two hours), exactly as with any link-based sharing.
