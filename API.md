# API reference

Base URL `http://localhost:4000/api`. JSON in, JSON out.

Authenticate with `Authorization: Bearer <accessToken>`. Access tokens last 30 minutes;
refresh tokens last 30 days and **rotate on every use** — the old one stops working immediately,
and presenting a spent token revokes the whole session family as suspected theft.

## Errors

Every failure has the same shape and a stable machine-readable `code`:

```json
{
  "error": {
    "code": "OFFER_EXISTS",
    "message": "You have already made an offer on this request.",
    "details": { "fields": { "rewardPaise": "Reward must be at least ₹1" } },
    "requestId": "7c1f…"
  }
}
```

| Status | Meaning |
|---|---|
| 400 | Malformed or not allowed in this state |
| 401 | Missing, expired or invalid token |
| 403 | Authenticated but not permitted — includes `NOT_VERIFIED`, `ACCOUNT_SUSPENDED`, and `ACTION_NOT_ALLOWED` when a lifecycle move belongs to the other party |
| 404 | Not found, **or not visible to you** — the two are deliberately indistinguishable |
| 409 | Conflict — duplicate offer, already rated, helper already chosen; `INVALID_TRANSITION` when a request, rental or payment has already moved on (a stale screen or a double tap); `REQUEST_SCHEDULED` for an offer on a request that is not live yet |
| 410 | Gone — expired OTP or deadline |
| 422 | Validation failed; `details.fields` maps field paths to messages |
| 429 | Rate limited; `details.retryAfterSeconds`, and a `Retry-After` header |
| 500 | Server fault — `requestId` matches the server log |
| 503 | `EMAIL_DELIVERY_FAILED` — the mail server could not be reached; try again shortly |

Amounts are always **integer paise** (₹30 is `3000`). Timestamps are ISO-8601 UTC.

API responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`.

---

## Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/register` | Campus derived from the email domain, never from the body |
| `POST` | `/auth/login` | Throttled per account and, more loosely, per network address |
| `POST` | `/auth/refresh` | Rotates the refresh token. Of two refreshes racing with one token, exactly one wins |
| `POST` | `/auth/logout` | `{ refreshToken }` ends that one session and needs no access token; with no body, a signed-in student is signed out on every device |
| `GET` | `/auth/me` | The signed-in student, including private fields |
| `POST` | `/auth/change-password` | Revokes every other session |

```http
POST /api/auth/register
{ "fullName": "Rahul Kumar", "email": "rahul.ug22.cs@nitp.ac.in",
  "password": "CampusBuddy@2026", "departmentId": "…", "yearOfStudy": 3 }

201 → { "accessToken": "…", "refreshToken": "…", "expiresIn": 1800, "user": { … } }
```

## Verification

| Method | Path | Notes |
|---|---|---|
| `GET` | `/verification/status` | Current state and any pending OTP |
| `POST` | `/verification/email/request` | 60 s cooldown, 5 per hour |
| `POST` | `/verification/email/verify` | 5 attempts per code, each miss counted; then the code is retired |
| `POST` | `/verification/location/verify` | Checked against the campus geofence |

```http
POST /api/verification/location/verify
{ "lat": 25.5856, "lng": 84.8516, "accuracyMetres": 12 }

200 → { "verified": true, "method": "CAMPUS_LOCATION", "verifiedAt": "…", "user": { … } }
403 → { "error": { "code": "OUTSIDE_CAMPUS",
                   "details": { "distanceMetres": 1043000, "radiusMetres": 1500 } } }
```

In development (`EMAIL_PROVIDER=console`) the OTP response includes `devMode: true` and
`devCode`, so a demo works without a mailbox. The server refuses to start in production with
that provider.

## Reference data

| Method | Path | Auth |
|---|---|---|
| `GET` | `/campus` | Public — campus, departments, hostels, permitted domains |
| `GET` | `/categories` | Public — the category tree |

## Requests

| Method | Path | Notes |
|---|---|---|
| `GET` | `/requests` | The feed. See query parameters below |
| `POST` | `/requests` | Verified students only |
| `GET` | `/requests/:id` | Includes `availableActions` for the caller |
| `PATCH` | `/requests/:id` | Requester only, while still open |
| `GET` | `/requests/:id/history` | Status and reward history |
| `POST` | `/requests/:id/reward` | Increase only, never past the ceiling |
| `POST` | `/requests/:id/cancel` | Reason required |
| `POST` | `/requests/:id/repeat` | Returns a draft to review, does not publish |

On creation, the request is pushed to helpers whose **own** settings match it — availability,
preferred categories, minimum reward, distance, urgent-only — and who are allowed to see it.

- **Private requests.** `visibility: "FAVOURITES"` with `invitedHelperIds` addresses a request to
  specific students only. Each must be a verified, active student on the same campus, and not
  you; otherwise `400`.
- **Scheduled requests.** With a future `scheduledFor`, the request stays out of the feed, sends
  no alerts, refuses offers (`409 REQUEST_SCHEDULED`) and does not auto-escalate until that time,
  when it is announced like a new request. A time already past means "now".

**Feed parameters:** `scope` (`ALL` · `MINE` · `MY_TASKS` · `RECOMMENDED` · `NEARBY` ·
`ENDING_SOON`), `sort` (`RECOMMENDED` · `NEAREST` · `HIGHEST_REWARD` · `ENDING_SOON` ·
`NEWEST`), `categorySlug`, `q`, `minRewardPaise`, `maxRewardPaise`, `maxDistanceMetres`,
`urgency`, `status`, `lat`, `lng`, `limit` (≤50), `cursor`.

```http
GET /api/requests?scope=RECOMMENDED&sort=NEAREST&lat=25.5854&lng=84.8514&limit=20

200 → { "items": [ { "id": "…", "title": "Bring Cold Drink",
                     "rewardPaise": 1000, "productCostPaise": 2000,
                     "totalBudgetPaise": 3000, "distanceMetres": 347,
                     "status": "OPEN", "availableActions": ["make_offer"], … } ],
        "nextCursor": "eyJvZmZzZXQiOjIwfQ", "total": null }
```

### Lifecycle

Each of these validates the move against the state machine and records it in history.

| Method | Path | Who |
|---|---|---|
| `POST` | `/requests/:id/offers` | Any verified student but the requester. Renews a withdrawn offer, or one passed over before the request reopened |
| `POST` | `/requests/:id/offers/:offerId/withdraw` | The helper who made it |
| `GET` | `/requests/:id/offers` | The requester (all) or a helper (their own) |
| `POST` | `/requests/:id/select-helper` | Requester. The chat now belongs to the requester and this helper |
| `POST` | `/requests/:id/accept` | Selected helper |
| `POST` | `/requests/:id/decline-selection` | Selected helper — the request reopens |
| `POST` | `/requests/:id/start` | Helper |
| `POST` | `/requests/:id/complete` | Helper — optional note and proof |
| `POST` | `/requests/:id/confirm` | Requester — **opens the payment** |
| `POST` | `/requests/:id/reject` | Requester — reason required |
| `POST` | `/requests/:id/resume` | Helper, after a rejection |
| `POST` | `/requests/:id/withdraw` | Helper — retires their accepted offer; counts against reliability |
| `POST` | `/requests/:id/reopen` | Requester, after a withdrawal |

## Payments

| Method | Path | Notes |
|---|---|---|
| `GET` | `/payments` | Everything you pay or are paid |
| `GET` | `/payments/:id` | With its full event ledger |
| `POST` | `/payments/:id/action` | `mark_initiated` · `claim_sent` · `confirm_received` · `deny_received` · `dispute` |

`claim_sent` is the payer saying they sent money. It is recorded as a claim and **does not**
mark the request paid. Only `confirm_received`, taken by the payee, does that — and the API
returns 403 if the payer attempts it.

While a payment is due, the **payer's** view of it carries `payeeUpiId`, `upiUri` and
`payeeUpiQrUrl` (a signed image link). The payee, and everyone after confirmation, gets `null`
for all three.

## Ratings

| Method | Path | Notes |
|---|---|---|
| `POST` | `/requests/:id/ratings` | Only after `PAID`, once per person, never about yourself |
| `GET` | `/requests/:id/ratings` | Both ratings on a task |
| `GET` | `/users/:id/ratings` | A student's received reviews |

## Users

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users/:id` | Public profile, reviews, whether you have favourited them |
| `GET` | `/users` | Directory search |
| `PATCH` | `/users/me` | Name, phone, department, hostel, year, bio, skills. Department and hostel must be this campus's |
| `PATCH` | `/users/me/payment-details` | UPI ID. Omit to leave it, `null` to clear it |
| `PUT` | `/users/me/avatar` | Multipart, one JPG or PNG. Replaces — and deletes — the previous photo |
| `DELETE` | `/users/me/avatar` | Back to initials |
| `PUT` | `/users/me/payment-qr` | Multipart, one JPG or PNG of your UPI QR code |
| `DELETE` | `/users/me/payment-qr` | Removes the QR; the UPI ID is kept |
| `PATCH` | `/users/me/preferences` | Availability, categories, minimum reward, radius; `availableUntil: null` clears the end time |
| `PATCH` | `/users/me/notification-preferences` | Per-type toggles and quiet hours (read in campus time). Fields you do not send are left alone; `null` clears quiet hours |
| `POST` | `/users/me/location` | One explicit position share |
| `DELETE` | `/users/me/location` | Forget it |
| `GET` | `/users/me/earnings` | Totals, pending, per month |
| `GET` | `/users/me/favourites` | Private to you |
| `PUT`/`DELETE` | `/users/:id/favourite` | Add or remove |

## Chat

| Method | Path |
|---|---|
| `GET` | `/conversations` |
| `GET` | `/requests/:id/conversation` |
| `GET` | `/conversations/:id/messages` |
| `POST` | `/conversations/:id/messages` |
| `POST` | `/conversations/:id/read` |

## Marketplace and rentals

| Method | Path |
|---|---|
| `GET`/`POST` | `/listings` |
| `GET`/`PATCH`/`DELETE` | `/listings/:id` |
| `GET`/`POST` | `/rental-items` |
| `GET`/`DELETE` | `/rental-items/:id` |
| `GET`/`POST` | `/rentals` |
| `GET` | `/rentals/:id` |
| `POST` | `/rentals/:id/{accept,decline,cancel,confirm-pickup,mark-returned,confirm-return}` |

Rental fees are computed server-side from the stored item price and the period. A client-supplied
price is ignored. Only the owner and the renter can act on a rental. `cancel` is available to the
renter before the owner accepts, and to either side once reserved.

## Moderation

| Method | Path |
|---|---|
| `POST` | `/reports` |
| `GET` | `/reports/mine` |
| `GET`/`POST` | `/disputes` |
| `GET` | `/disputes/:id` |
| `POST` | `/disputes/:id/evidence` |

Opening a dispute moves the underlying request or rental to `DISPUTED`, freezing it until a
moderator rules; a disputed rental's item cannot be booked by anyone else meanwhile. Only moves
the state machine allows are accepted — a finished rental cannot be disputed.

## Admin

All of these require `MODERATOR`, `CAMPUS_ADMIN` or `PLATFORM_ADMIN`, re-checked server-side on
every call. Every state change writes an audit record.

| Method | Path | Minimum role |
|---|---|---|
| `GET` | `/admin/analytics` | Moderator |
| `GET` | `/admin/users` | Moderator |
| `PATCH` | `/admin/users/:id` | Admin — suspend, reinstate, change role. Never yourself; a platform admin only by another |
| `GET` | `/admin/requests` | Moderator |
| `GET`/`PATCH` | `/admin/reports`, `/admin/reports/:id` | Moderator |
| `GET`/`PATCH` | `/admin/disputes`, `/admin/disputes/:id` | Moderator |
| `GET`/`PATCH` | `/admin/campus` | Moderator reads, admin edits. A saved geofence outranks `.env` from then on |
| `GET` | `/admin/audit-logs` | Admin |

Resolving a request dispute puts the request where the ruling says: `RESOLVED_REQUESTER`
cancels it; `RESOLVED_HELPER` makes it payable (opening the payment if there was none) or paid
if the money already arrived; `RESOLVED_SPLIT` closes it as paid; `DISMISSED` returns it to the
state it was in when the dispute was opened. Resolving a rental dispute completes the rental.

## Files

| Method | Path | Notes |
|---|---|---|
| `POST` | `/uploads?purpose=…` | Multipart, ≤5 MB, type verified by magic number. Profile photos and QR codes use their own endpoints |
| `GET` | `/uploads/:id?expires=…&signature=…` | A signed link — no token needed |
| `GET` | `/uploads/:id` | With a bearer token, authorised by following the parent record |

Every file the API hands back — `avatarUrl`, `upiQrUrl`, `payeeUpiQrUrl`, `completionProofUrl`,
and the `url` of every attachment on a request, message, listing, rental item or piece of dispute
evidence — is a signed link, minted only for a viewer entitled to it.

Only JPEG, PNG, WebP, GIF, HEIC and PDF are accepted, and the stored extension comes from the
detected type — never from the client's filename. Profile photos and QR codes accept JPG and PNG
only, and have EXIF, text chunks and trailing data stripped on the server. Attaching someone
else's upload to anything is refused with `403`.

**Signed links** exist because an `<img>` tag cannot send an `Authorization` header. It is an HMAC
over the file id and expiry, valid for one to two hours, and identical for every request made
within the same hour so browsers can cache the image. An altered, moved or expired link returns
`403 LINK_EXPIRED`; a valid link to a file that has since been replaced returns `404`.

## WebSocket

```
ws://localhost:4000/ws?token=<accessToken>
```

On connect you are subscribed to `user:<yourId>` and `campus:<yourCampusId>`. To join another
channel:

```json
{ "action": "subscribe", "channel": "request:<uuid>" }
```

Every such subscription is authorised against the database — a client cannot listen in by
guessing an id. Frames:

```json
{ "event": "OFFER_CREATED", "channel": "request:…", "payload": { … }, "at": "…" }
```

Events include `REQUEST_CREATED`, `OFFER_CREATED`, `HELPER_SELECTED`, `REWARD_CHANGED`,
`TASK_COMPLETED`, `COMPLETION_CONFIRMED`, `PAYMENT_UPDATED`, `RATING_CREATED`,
`MESSAGE_CREATED`, `RENTAL_*` and `DISPUTE_*`.

A refused token closes the socket with code `4001`: refresh the access token, then reconnect.
The server pings every 30 seconds and drops connections that stop answering.

## Rate limits

| Action | Limit |
|---|---|
| Any API call | 300 per minute per signed-in student |
| Login | 10 per 5 min per account; 100 per 5 min per network address |
| Registration | 30 per hour per network address (`REGISTER_RATE_LIMIT_MAX`) |
| OTP request | 1 per 60 s, 5 per hour |
| OTP verify | 5 attempts per code |
| Create request | 20 per hour |
| Offer | 60 per hour |
| Send message | 120 per 5 min |
| Upload | 30 per hour |
| Report | 10 per day |

The network address comes from the connection, or from `X-Forwarded-For` only as far back as
`TRUST_PROXY` proxies — a client cannot supply its own.
