# CampusBuddy — Master Prompt for Claude Code

> ## CURRENT DEPLOYMENT SCOPE — IMPORTANT
> **CampusBuddy is currently being built ONLY for students of NIT Patna at the Bihta Campus.**
>
> For the current MVP:
> - Institution: **National Institute of Technology Patna (NIT Patna)**
> - Campus: **Bihta Campus**
> - Target users: **NIT Patna students associated with the Bihta Campus**
> - Requests, rentals, marketplace listings, chats, ratings, and other peer-to-peer activity are restricted to this community.
> - The app must not behave like an open public marketplace.
> - Generic multi-college support is **not** part of the current MVP.
> - Keep the architecture extensible for future expansion, but do not spend MVP effort building multi-college onboarding or cross-college functionality.
>

> **Purpose:** This file is the complete product, UX, architecture, engineering, security, testing, documentation, and delivery specification for building **CampusBuddy** as a final-semester college project.
>
> **Instruction to Claude Code:** Read this entire file before implementing anything. Inspect the existing VS Code workspace first. Then build the application incrementally, test each major module, and keep the documentation updated.

---

# 1. ROLE AND OPERATING MODE

You are the primary software-engineering agent responsible for implementing **CampusBuddy** in the current VS Code workspace.

Your responsibilities:

- Inspect the repository before making changes.
- Understand the existing codebase before introducing a new architecture.
- Preserve useful existing work.
- Build the project rather than only describing it.
- Create missing files, folders, database migrations, configuration, tests, and documentation.
- Keep the application runnable after each major phase.
- Prefer clean, maintainable, production-style code over hacks.
- Make sensible implementation decisions without repeatedly asking for trivial confirmation.
- Do not claim functionality is complete unless it is implemented, connected, and tested.
- Do not leave fake buttons, dead screens, placeholder APIs, or misleading success messages.
- Use mock/development functionality only when a real external integration is not appropriate for the project, and label it clearly in both code and UI where necessary.
- Never expose secrets in source control.
- Create or update `.env.example`.
- Explain important architecture decisions in project documentation.
- Add tests for critical business logic and security rules.
- Keep the design extensible so advanced features can be added later.

If the workspace already contains code, first determine:

- Existing framework.
- Existing language.
- Existing build system.
- Existing backend.
- Existing database.
- Existing authentication.
- Existing project conventions.
- Existing reusable components.
- Existing README or design documents.

Do not wipe the repository unless it is clearly safe and necessary.

---

# 2. PROJECT IDENTITY

**Current Target Community: NIT Patna — Bihta Campus students only.**

## Name

**CampusBuddy**

## Project Type

Campus-restricted peer-to-peer marketplace and micro-service platform for **NIT Patna students at the Bihta Campus**.

## One-Line Description

CampusBuddy is a verified **NIT Patna Bihta Campus-only** platform where students can request and provide small services, errands, academic help, temporary access to items, buying/selling, borrowing/renting, and other student-to-student assistance in exchange for monetary rewards.

## Core Vision

Create a trusted digital ecosystem inside a college where students can help one another and earn from:

- Spare time.
- Physical availability.
- Skills.
- Knowledge.
- Personal resources.
- Unused possessions.
- Small errands.
- Academic expertise.

The same student can be both a requester and a helper.

---

# 3. PROBLEM STATEMENT

College students repeatedly face small problems that do not justify using a large external service:

- Need a cold drink from the canteen.
- Need chocolate or snacks from a shop.
- Need Maggie late at night.
- Need a pen, copy/notebook, printout, or stationery item.
- Need someone to pick up or deliver something within campus.
- Need a charger or calculator for a few hours.
- Need a camera, tripod, cable, or other gadget temporarily.
- Need class notes.
- Need previous-year questions.
- Need placement preparation material.
- Need a student to explain a difficult topic.
- Need help with a small hostel/campus task.
- Need to buy or sell used college items.

At the same time, many students:

- Are already going to the same shop/canteen.
- Have spare time.
- Own useful items.
- Have knowledge others need.
- Are willing to help for a reasonable reward.

CampusBuddy connects these two sides.

---

# 4. PRODUCT CONCEPT

CampusBuddy is not just a social network and not just a delivery application.

It is a **college-only peer-to-peer marketplace** combining:

- On-demand student services.
- Micro-gigs.
- Peer-to-peer assistance.
- Student rentals.
- Student marketplace.
- Academic resource exchange.
- Peer tutoring.
- Dynamic rewards.
- Realtime communication.
- Geolocation.
- College verification.
- Reputation and trust.

Core cycle:

```text
Need
↓
Create Request
↓
Discover / Match
↓
Offer / Accept
↓
Select Helper
↓
Communicate
↓
Complete
↓
Pay
↓
Rate
↓
Build Reputation
```

---

# 5. CORE PRODUCT PRINCIPLES

Build the product around these principles:

- **College-first:** Users primarily interact with members of their own college.
- **Verified:** Accounts should have a meaningful verification path.
- **Fast:** A small request should take very little time to post.
- **Reward-driven:** The helper sees a clear incentive.
- **Trusted:** Ratings, verification, transaction history, reporting, and moderation matter.
- **Realtime:** Important events should appear quickly.
- **Location-aware:** Distance and campus location should improve matching and delivery.
- **Privacy-aware:** Do not expose exact location or personal data unnecessarily.
- **State-driven:** Every request, rental, and transaction has explicit states.
- **Scalable:** Start with one college, but support multiple colleges architecturally.
- **Modular:** Keep auth, requests, payments, chat, matching, rentals, marketplace, and notifications logically separated.
- **Honest:** Never pretend an external payment or verification event was confirmed when it was not.

---

# 6. RECOMMENDED TECHNOLOGY STACK

If the workspace does not already define a suitable stack, prefer:

## Mobile Application

- Flutter
- Dart
- Material 3
- Riverpod or another maintainable modern state-management approach
- GoRouter or equivalent
- Feature-based modular architecture

## Backend

Preferred:

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Realtime
- Supabase Storage
- PostgreSQL Row Level Security (RLS)
- Edge Functions / server-side functions for protected business logic

## Geospatial

- PostgreSQL + PostGIS where available
- GPS/location APIs on mobile
- Map SDK where map display is useful

## Notifications

- Push notification provider appropriate for the chosen mobile platform
- Realtime events for in-app updates

## Admin Panel

A small web application is preferred:

- React/Next.js or equivalent
- Same backend/database
- Admin-only authorization

## Payments

For initial project:

- UPI ID / QR-based payment flow.
- Payment status recorded in the database.
- No false assumption that QR scanning verifies payment.

For advanced version:

- Real payment-provider integration behind a payment service abstraction.

---

# 7. PROJECT PHASES

Implement in phases.

## Phase 0 — Repository and Architecture

- Inspect repository.
- Decide final architecture.
- Create project structure.
- Configure environment handling.
- Configure linting/formatting.
- Create README.
- Create `.env.example`.
- Set up CI where practical.
- Add database migrations.
- Define coding conventions.

## Phase 1 — Authentication and College Verification

- Registration.
- Login.
- Logout.
- Password/session handling or passwordless flow.
- College selection.
- College email verification.
- Phone verification if included.
- Campus geolocation verification.
- Verification status.

## Phase 2 — Profiles and Core Requests

- Profile.
- Home feed.
- Create request.
- View request.
- Edit/cancel request.
- Request expiration.
- Categories.
- Request visibility.

## Phase 3 — Helper Marketplace

- Browse requests.
- Search/filter/sort.
- Offers.
- Accept/decline.
- Helper selection.
- Request lifecycle.
- Realtime updates.
- Notifications.

## Phase 4 — Chat and Location

- Request-specific chat.
- Approximate distance.
- Pickup/delivery.
- Location sharing after appropriate authorization.

## Phase 5 — Completion, Payments, Ratings

- Completion.
- Confirmation.
- QR/UPI display.
- Payment tracking.
- Ratings/reviews.
- Reputation.

## Phase 6 — Dynamic Rewards and Matching

- Reward escalation.
- Matching algorithm.
- Recommendation/ranking.

## Phase 7 — Rentals and Marketplace

- Rental listings.
- Borrowing.
- Deposits.
- Buy/sell/exchange/giveaway.
- Rental lifecycle.

## Phase 8 — Academic Help

- Notes/resources.
- PYQs.
- Placement resources.
- Peer tutoring.

## Phase 9 — Admin and Moderation

- Admin panel.
- Reports.
- Disputes.
- User moderation.
- Analytics.

## Phase 10 — Polish and Presentation

- UX refinement.
- Accessibility.
- Error states.
- Loading states.
- Security review.
- Test coverage.
- Demo dataset.
- Final README.
- Architecture diagrams.
- SRS-ready documentation.
- Final-semester presentation flow.

---

# 8. AUTHENTICATION AND REGISTRATION

## Registration Fields

Support:

- Full name.
- Profile photo.
- College.
- Department/course.
- Year.
- Semester where relevant.
- Phone number.
- Email.
- Password or passwordless credentials.
- Optional student ID/reference.

## Campus Scope

**Current deployment scope is fixed to NIT Patna students studying/located at the Bihta Campus.**

For the current MVP:

- Do not present a generic college-selection marketplace.
- Do not allow arbitrary colleges to register themselves.
- The default and only campus tenant is:
  - Institution: **National Institute of Technology Patna (NIT Patna)**
  - Campus: **Bihta Campus**
- Store the campus as a configured institution/campus record so the architecture remains extensible.
- Departments, hostels, campus zones, and other relevant groups should be configurable for the Bihta Campus.

A user account must therefore be associated with:

- NIT Patna.
- Bihta Campus.
- Department/course.
- Year/semester.

Future multi-college expansion may introduce additional institutions, but that is explicitly outside the current MVP scope.

---

# 9. COLLEGE EMAIL VERIFICATION

Flow:

```text
Register
↓
Select College
↓
Enter College Email
↓
Validate Domain
↓
Send OTP / Verification Link
↓
Verify
↓
CampusBuddy Verified
```

Requirements:

- Validate the official NIT Patna student email domain configured in the environment/database. **Do not hard-code or invent an email domain; obtain the correct official domain from the project configuration.**
- Verification token/OTP must expire.
- Prevent repeated abuse of OTP requests.
- Store verification timestamps.
- Do not store plaintext verification secrets.
- Allow resend with rate limiting.
- Show verification method in profile where appropriate.

Profile example:

```text
CampusBuddy Verified ✓
Verified via College Email
```

---

# 10. CAMPUS GEOLOCATION VERIFICATION

Alternative verification path:

```text
Register
↓
Select College
↓
Allow Location
↓
Get Current Coordinates
↓
Check College Geofence
↓
Inside Campus?
├── Yes → Verified
└── No → Verification Failed
```

Support:

- Simple center + radius for MVP.
- Polygon-based geofence later.

Store:

- College center or polygon.
- Configured allowed radius.
- Verification event timestamp.
- Verification method.

Security notes:

- GPS is not perfect proof of enrollment.
- Do not treat location as cryptographically trustworthy.
- Avoid unnecessary background tracking.
- Request location only when needed.
- Handle denied permissions.
- Consider basic spoofing checks on supported platforms where feasible.
- Keep privacy messaging clear.

Profile example:

```text
CampusBuddy Verified ✓
Verified via Campus Location
```

---

# 11. OPTIONAL MULTI-SIGNAL VERIFICATION

Design the verification system so it can support:

- College email.
- Phone.
- Student ID/manual review.
- Campus geolocation.

Allow future policies such as:

- Email only.
- Email + phone.
- Location + phone.
- Manual verification.

Do not hard-code verification assumptions throughout the application.

---

# 12. COLLEGE ISOLATION / MULTI-TENANCY

CampusBuddy is college-scoped.

Rules:

- Every student belongs to a college.
- Requests are normally visible only to users from the same college.
- Listings and rentals are normally college-specific.
- Chats are limited to authorized participants.
- Admin access is separated by role and optionally college.
- Backend/database policies must enforce isolation.
- Frontend filtering alone is not enough.

Future support:

- Universities with multiple campuses.
- Multiple campuses under one college.
- Department communities.
- Hostel communities.

---

# 13. USER PROFILE

Profile should include:

- Name.
- Profile photo.
- College.
- Department/course.
- Year/semester.
- Verification status.
- Verification method.
- Average rating.
- Number of completed tasks.
- Completion rate.
- Cancellation rate.
- Response rate.
- Skills.
- Preferred categories.
- Availability.
- Active listings.
- Rental items.
- Reviews.
- UPI ID / QR metadata where appropriate.

Example:

```text
Aman
★★★★★ 4.9
127 tasks completed
98% completion rate
2% cancellation rate
```

Do not publicly expose:

- Passwords.
- Authentication tokens.
- Sensitive private payment details.
- Exact residential/room details unless specifically required and authorized.

---

# 14. HOME SCREEN

Design a student-first dashboard.

Possible sections:

- Create Request.
- Nearby Requests.
- Recommended Requests.
- Active Requests.
- Active Tasks.
- Rentals.
- Marketplace.
- Academic Help.
- Earnings.
- Notifications.

Suggested bottom navigation:

```text
Home
Discover
Tasks
Marketplace
Chat
Profile
```

Keep the main action prominent:

```text
+ Create Request
```

---

# 15. REQUEST SYSTEM

A request represents a need that another student can fulfill.

## Request fields

- Request ID.
- Requester ID.
- College ID.
- Title.
- Description.
- Category.
- Subcategory.
- Reward.
- Optional item/product cost.
- Total estimated budget.
- Pickup location.
- Delivery location.
- Approximate location coordinates.
- Deadline.
- Urgency.
- Visibility scope.
- Attachments.
- Created time.
- Updated time.
- Current status.
- Selected helper.
- Completion metadata.
- Cancellation metadata.
- Payment association.
- Rating association.

---

# 16. REQUEST CREATION EXAMPLES

Example 1:

```text
Title:
Bring Cold Drink

Product cost:
₹20

Reward:
₹10

Total:
₹30

Pickup:
Campus Canteen

Delivery:
Hostel A

Deadline:
20 minutes

Urgency:
Normal
```

Example 2:

```text
Need DBMS Notes

Reward:
₹50

Deadline:
Tonight

Category:
Academic
```

Example 3:

```text
Need Scientific Calculator for 3 Hours

Reward:
₹40

Type:
Borrow/Rent
```

---

# 17. REQUEST CATEGORIES

## Quick Delivery

- Food.
- Cold drinks.
- Chocolates.
- Snacks.
- Grocery.
- Stationery.
- Printed documents.
- Small purchases.

## Campus Assistance

- Collection.
- Delivery.
- Queue/line assistance.
- Hostel assistance.
- Carrying/moving.
- Finding something.
- Small campus tasks.

## Academic Help

- Notes.
- PDFs.
- Previous-year questions.
- Placement questions.
- Interview preparation.
- Study resources.
- Topic explanations.
- Peer tutoring.
- Lab material.

## Borrow/Rent

- Scientific calculator.
- Charger.
- Power bank.
- Cable.
- HDMI cable.
- Books.
- Camera.
- Tripod.
- Speaker.
- Projector.
- Sports equipment.
- Other student-owned items.

## Technical Help

- Troubleshooting.
- Software setup.
- Programming guidance.
- Project guidance.
- Device setup.
- Printing/file help.

## Marketplace

- Buy.
- Sell.
- Rent.
- Borrow.
- Exchange.
- Give away.

---

# 18. REQUEST VISIBILITY

Requester can choose:

- Everyone in my college.
- Nearby students.
- Hostel/community.
- Department.
- Specific group.
- Trusted/favorite helpers.

Visibility must be enforced by backend policies.

Do not reveal exact location to everyone by default.

---

# 19. REQUEST DEADLINES

Every request should be able to expire.

Possible deadline types:

- 15 minutes.
- 30 minutes.
- 1 hour.
- Today.
- Specific date/time.
- Tomorrow.
- Scheduled.

When expired:

- No new offers.
- Notifications stop where appropriate.
- Status becomes `EXPIRED`.
- Existing incomplete workflows are handled according to business rules.

---

# 20. URGENCY

Support:

```text
NORMAL
URGENT
```

Urgent requests may:

- Be ranked higher.
- Trigger more immediate notifications.
- Have shorter expiry.
- Encourage higher rewards.

Prevent excessive push notification abuse.

---

# 21. REWARD SYSTEM

Every service request can include a monetary reward.

Two useful pricing views:

### Separate Cost + Reward

```text
Item price: ₹20
Helper reward: ₹10
Estimated total: ₹30
```

### Total Budget

```text
Total budget: ₹30
```

Make the UI clear about what is:

- Product cost.
- Service reward.
- Deposit.
- Total.

---

# 22. DYNAMIC REWARD ESCALATION

Support manual and optional automated reward increases.

Example:

```text
₹30
↓
No helper
↓
₹40
↓
No helper
↓
₹50
↓
Helper accepts
```

Features:

- Increase Reward button.
- Configurable automatic escalation.
- Maximum reward limit.
- Reward history.
- Notifications when reward changes.
- Prevent unauthorized changes once the task is locked or accepted.

Use server-side atomic updates.

---

# 23. HELPER DISCOVERY

Helpers can discover:

- Open requests.
- Nearby requests.
- Recommended requests.
- High-reward requests.
- Urgent requests.
- Ending-soon requests.

Filters:

- Category.
- Distance.
- Reward.
- Deadline.
- Urgency.
- Location.
- Request type.

Sorting:

- Recommended.
- Nearest.
- Highest reward.
- Ending soon.

---

# 24. MATCHING ALGORITHM

Build matching as an independent service/module.

Possible factors:

- Distance.
- Category match.
- Availability.
- Reward preference.
- Rating.
- Completion rate.
- Response history.
- Previous experience in category.
- Urgency.
- Service radius.

Conceptual score:

```text
Helper Score =
    Distance Score
  + Category Match
  + Availability
  + Rating
  + Completion Reliability
  + Reward Preference
  + Response History
  + Urgency Fit
```

Keep weights configurable.

Document the formula.

Do not make the matching system inseparable from the UI.

---

# 25. HELPER OFFERS AND BIDDING

Helpers can optionally:

- Accept listed reward.
- Submit a different price.
- Decline.

Example:

```text
Requester reward: ₹30

Aman   ₹30
Rohit  ₹35
Karan  ₹40
```

Requester chooses one.

Prevent:

- Duplicate offers.
- Offers on expired requests.
- Offers after acceptance.
- Multiple selected helpers.
- Race conditions.

Server/database remains authoritative.

---

# 26. REQUEST STATUS MACHINE

Use explicit statuses.

Recommended:

```text
OPEN
OFFERS_RECEIVED
HELPER_SELECTED
ACCEPTED
IN_PROGRESS
COMPLETED
PAYMENT_PENDING
PAID
RATED
```

Problem/terminal states:

```text
CANCELLED
EXPIRED
REJECTED
HELPER_WITHDREW
DISPUTED
```

Rules:

- Clients cannot arbitrarily jump between states.
- Allowed transitions should be defined centrally.
- Every significant transition should be validated.
- Store status history for important objects.

---

# 27. REQUEST ACCEPTANCE

When a requester selects a helper:

- Lock request against competing selection.
- Set selected helper.
- Mark selected offer.
- Invalidate other offers.
- Create helper/task association.
- Notify both users.
- Open request-specific chat.
- Start any relevant timers.

Use an atomic transaction or equivalent.

---

# 28. REQUEST CANCELLATION

Requester may cancel according to stage/rules.

Helper may withdraw according to stage/rules.

Rules can depend on:

- Whether work started.
- Whether money was already spent.
- Rental status.
- Payment status.
- Time remaining.

Possible outcomes:

- No penalty.
- Cancellation count increment.
- Reliability reduction.
- Refund.
- Admin review.

Document the policies.

---

# 29. REALTIME UPDATES

Use realtime capabilities for:

- New offers.
- Helper selection.
- Reward changes.
- Status changes.
- Chat messages.
- Payment-state updates.
- Rating events where useful.
- Rental status changes.

App should update important information without requiring constant refresh.

---

# 30. CHAT

Create request-specific chat between requester and selected helper.

Support at least:

- Text messages.
- Timestamp.
- Optional image attachment.
- Read state where practical.

Optional:

- Location sharing.
- Photos of completed item.
- Delivery confirmation.

Rules:

- Only request participants can access the conversation.
- Admin access should be role-controlled and auditable.
- Support block/report functionality.

---

# 31. LOCATION FEATURES

Use location for:

- Campus verification.
- Nearby requests.
- Approximate distance.
- Pickup/dropoff.
- Matching.
- Optional map display.

Privacy strategy:

- Show approximate location before acceptance.
- Reveal exact location only when required.
- Never expose room number publicly by default.
- Do not continuously track users in the background unless explicitly necessary.
- Respect platform permissions.

Use:

- Haversine for simple distance calculations.
- PostGIS for scalable geospatial queries.

---

# 32. NOTIFICATIONS

## Requester notifications

- New offer.
- Helper selected.
- Helper withdrew.
- Task started.
- Task completed.
- Payment update.
- Chat message.
- Reward changed.
- Request expiring.
- Dispute update.

## Helper notifications

- Matching request.
- Reward increased.
- Offer accepted.
- Request cancelled.
- Chat message.
- Deadline approaching.
- Payment completed.
- Rental return reminder.

Allow preferences for:

- Categories.
- Minimum reward.
- Maximum distance.
- Urgency.
- Push/in-app notifications.

---

# 33. AVAILABILITY AND PREFERENCES

Students can set:

```text
Available now
Busy
Available later
```

Optional:

- Time windows.
- Preferred categories.
- Maximum service radius.
- Minimum reward.

Use these preferences in matching and notifications.

---

# 34. COMPLETION FLOW

Typical flow:

```text
Helper completes work
↓
Helper marks completed
↓
Requester receives notification
↓
Requester confirms
↓
Payment status becomes relevant
↓
Payment is recorded/confirmed
↓
Ratings become available
```

Allow optional proof:

- Photo.
- Delivery evidence.
- Confirmation note.

If requester rejects completion:

- Open dispute/review flow.
- Do not automatically mark as paid.

---

# 35. PAYMENT MODEL

## MVP

Students can store:

- UPI ID.
- Payment QR.

When appropriate:

- Requester views helper QR.
- Requester pays using external UPI app.
- Requester returns to CampusBuddy.
- Payment state is recorded based on the designed flow.

Possible states:

```text
PAYMENT_PENDING
PAYMENT_INITIATED
PAYMENT_CLAIMED
PAYMENT_CONFIRMED
PAYMENT_DISPUTED
REFUNDED
```

Critical:

- Do not falsely claim that CampusBuddy verified a bank transaction unless a real payment integration confirms it.
- Make manual/external payment status explicit.

---

# 36. PAYMENT SERVICE ABSTRACTION

Create a `PaymentService` or equivalent abstraction.

Possible implementations:

- `QrPaymentService` for MVP.
- `GatewayPaymentService` for future real provider integration.
- `MockPaymentService` for automated tests/demo where needed.

This avoids hard-coding payment behavior into screens.

---

# 37. WALLET / ESCROW-STYLE FUTURE MODEL

Design for:

```text
Requester
↓
Money reserved
↓
Helper completes
↓
Requester confirms
↓
Money released
↓
Helper receives reward
```

For the final-semester project, this can be represented as a simulated transaction-state workflow unless a compliant payment provider is actually integrated.

Clearly distinguish:

- Project simulation.
- Real payment.

---

# 38. TWO-WAY RATINGS

After successful completion:

Requester rates helper.

Helper rates requester.

Possible dimensions:

## Helper

- On-time.
- Reliable.
- Communication.
- Quality.

## Requester

- Clear instructions.
- Easy communication.
- Payment reliability.
- Respectful behavior.

Support:

- 1–5 stars.
- Optional review text.

Prevent duplicate ratings.

---

# 39. REPUTATION SYSTEM

Profile can display:

- Average rating.
- Number of completed tasks.
- Completion rate.
- Cancellation rate.
- Response rate.
- Number of disputes.
- Successful transactions.

Example:

```text
Aman
★★★★★ 4.9

127 Tasks Completed
98% Completion
2% Cancellation
```

Reputation should influence trust and optionally matching.

---

# 40. RELIABILITY SCORE

Build a separate reliability score if useful.

Possible inputs:

- Average rating.
- Completion percentage.
- Cancellation frequency.
- Response time.
- Number of successful transactions.
- Disputes.
- Account age.

Keep the formula explainable.

Do not make it impossible for new users to participate.

---

# 41. BORROW / RENT SYSTEM

Students can list items they own.

Rental listing fields:

- Item ID.
- Owner.
- College.
- Item name.
- Category.
- Description.
- Photos.
- Condition.
- Rental price.
- Rental unit.
- Deposit.
- Availability.
- Pickup zone.
- Rules.
- Current status.

Statuses:

```text
AVAILABLE
RESERVED
RENTED
RETURN_PENDING
RETURNED
DISPUTED
```

---

# 42. RENTAL FLOW

Example:

```text
Aman lists Scientific Calculator
₹30/day
Deposit ₹200
↓
Rahul requests calculator
↓
Aman accepts
↓
Reservation created
↓
Pickup
↓
Rental ACTIVE
↓
Return
↓
Aman confirms return
↓
Rental COMPLETED
↓
Deposit handled according to rules
```

Track:

- Start date/time.
- Expected return.
- Actual return.
- Deposit.
- Damage/dispute.
- Confirmation.

---

# 43. STUDENT MARKETPLACE

Support:

- Buy.
- Sell.
- Rent.
- Borrow.
- Exchange.
- Give away.

Examples:

- Semester books.
- Lab coats.
- Electronics.
- Hostel items.
- Sports equipment.
- Stationery.
- Accessories.

Listing fields:

- Title.
- Description.
- Price.
- Category.
- Condition.
- Photos.
- Availability.
- Location zone.
- Seller.
- College.

---

# 44. ACADEMIC HELP MARKETPLACE

Requests can include:

- Notes.
- PDFs.
- PYQs.
- Placement questions.
- Interview material.
- Study resources.
- Topic explanations.
- Lab help.
- Subject-specific help.

Example:

```text
Need previous-year placement questions
Reward: ₹50
```

Support legitimate academic assistance.

Do not design features specifically intended to facilitate cheating or unauthorized examination misconduct.

---

# 45. PEER TUTORING

Students can list skills:

- SQL.
- Programming.
- Mathematics.
- Database systems.
- Networking.
- Interview preparation.
- Other subjects.

Tutoring request can specify:

- Topic.
- Duration.
- Reward.
- Online/offline.
- Preferred time.

Tutor profile can show:

- Skills.
- Rating.
- Sessions completed.
- Availability.

---

# 46. TECHNICAL HELP

Possible requests:

- Computer troubleshooting.
- Software installation.
- Development environment setup.
- Programming guidance.
- Device setup.
- Printing/file conversion.
- Project setup guidance.

These are student-to-student services, not unrestricted professional services.

---

# 47. SEARCH

Search across:

- Requests.
- Marketplace listings.
- Rentals.
- Skills/tutors.

Support:

- Keyword search.
- Category filter.
- Price/reward range.
- Distance.
- Availability.
- Condition.

Use indexed database fields for important queries.

---

# 48. SAVED/FAVORITE HELPERS

Allow users to favorite trusted students.

When creating requests, optionally:

- Invite favorite helpers.
- Restrict request to favorite helpers.
- Notify them first.

Do not expose private relationships to other users.

---

# 49. REPEAT REQUESTS

Allow users to duplicate prior requests.

Examples:

- Weekly tutoring.
- Regular printouts.
- Repeated food pickup.
- Recurring rentals.

Do not blindly duplicate old exact location/private data; require review before publishing.

---

# 50. SCHEDULED REQUESTS

Allow future requests.

Example:

```text
Bring printed notes tomorrow at 9:00 AM
```

System should:

- Store scheduled time.
- Notify potential helpers at an appropriate time.
- Avoid activating requests too early if not intended.
- Expire after the service window.

---

# 51. REQUEST BUNDLING — FUTURE

Advanced feature:

A helper may combine nearby tasks.

Example:

```text
Task A — collect printout
Task B — buy pen
Task C — pick up cold drink
```

Future routing system can optimize:

- Distance.
- Time.
- Reward.

Do not implement complex route optimization until the core marketplace works reliably.

---

# 52. CAMPUS HEAT MAP — FUTURE

Admin analytics can show aggregate:

- Request density.
- Popular locations.
- Peak times.
- Most requested categories.

Privacy:

- Use aggregated/anonymized information.
- Avoid exposing individual locations.

---

# 53. EXAM SEASON MODE — FUTURE

Based on configurable academic calendar, prioritize:

- Notes.
- PYQs.
- Academic help.
- Calculators.
- Stationery.
- Tutoring.

Do not hard-code specific exam behavior for only one college.

---

# 54. HOSTEL / DEPARTMENT COMMUNITIES

Users may optionally belong to:

- Hostel.
- Department.
- Year.
- Club/community.

Requests can target a community.

Examples:

```text
Hostel A
CSE 3rd Year
Mechanical Department
```

Privacy/authorization must remain enforced.

---

# 55. TRUSTED USERS

Optional trusted-helper concept:

- Favorite helper.
- Trusted student.
- Private request to specific student.

Do not create a system where trusted status bypasses all safety or payment controls.

---

# 56. EARNINGS DASHBOARD

Helpers can view:

- Total earned.
- Pending amount.
- Completed tasks.
- Average reward.
- Monthly earnings.
- Successful transactions.

Example:

```text
Total Earned: ₹4,850
Tasks Completed: 127
Average Reward: ₹38
```

---

# 57. REQUESTER DASHBOARD

Show:

- Active requests.
- Completed requests.
- Cancelled requests.
- Pending payments.
- Previous requests.
- Disputes.

Each request should show:

- Status.
- Helper.
- Reward.
- Deadline.
- Transaction.
- Ratings.

---

# 58. HELPER DASHBOARD

Show:

- Available requests.
- Recommended requests.
- Accepted tasks.
- Active tasks.
- Completed tasks.
- Earnings.
- Rating.
- Reliability.

---

# 59. ADMIN PANEL

Admin can:

- Manage users.
- Manage colleges.
- Manage categories.
- Review verification records.
- Suspend users.
- Review reports.
- Resolve disputes.
- Review suspicious activity.
- Manage marketplace/rental categories.
- View analytics.

Admin dashboard metrics:

- Registered students.
- Verified students.
- Active users.
- Requests created.
- Requests completed.
- Completion rate.
- Average reward.
- Average completion time.
- Cancellation rate.
- Dispute rate.
- Popular categories.
- Rental activity.

---

# 60. ROLE MODEL

Suggested roles:

```text
STUDENT
COLLEGE_ADMIN
PLATFORM_ADMIN
MODERATOR
```

Keep permissions explicit.

Examples:

- Student: create requests, offer help, rent, rate, report.
- Moderator: review reports/disputes.
- College admin: manage college-level settings.
- Platform admin: manage global settings.

---

# 61. REPORTING AND MODERATION

Users can report:

- User.
- Request.
- Listing.
- Message.
- Payment problem.
- Rental problem.

Report fields:

- Reporter.
- Target.
- Reason.
- Description.
- Evidence.
- Created time.
- Status.
- Resolution.

Statuses:

```text
OPEN
UNDER_REVIEW
RESOLVED
DISMISSED
ESCALATED
```

---

# 62. DISPUTES

Possible disputes:

- Item not delivered.
- Helper claims requester refused.
- Payment issue.
- Wrong item.
- Damaged rental.
- Rental not returned.
- Misleading marketplace listing.

Dispute flow:

```text
Transaction
↓
Dispute Created
↓
Evidence
↓
Admin Review
↓
Resolution
↓
Record outcome
```

Keep transaction history immutable where appropriate.

---

# 63. FRAUD AND ABUSE PREVENTION

Potential abuse:

- Fake accounts.
- Spam requests.
- Fake payment claims.
- Non-delivery.
- Fake completion.
- Manipulated reviews.
- Rental damage.
- Repeated cancellations.
- Harassment.

Mitigations:

- Verification.
- Rate limiting.
- Transaction history.
- State validation.
- Reputation.
- Reports.
- Admin moderation.
- Suspicious-activity indicators.
- Access controls.

---

# 64. PRIVACY

Minimize sensitive data.

Protect:

- Exact location.
- Phone number.
- Payment details.
- Private chats.
- Verification evidence.

Principles:

- Collect only what is needed.
- Use least-privilege access.
- Do not permanently track GPS unless required.
- Explain why location is needed.
- Let users disable optional features where possible.

---

# 65. DATABASE DESIGN

Suggested entities/tables:

```text
users
colleges
departments
hostels
verification_records
user_preferences
availability
categories
requests
request_offers
request_status_history
tasks
messages
message_attachments
notifications
notification_preferences
payments
transactions
transaction_events
ratings
reviews
listings
rental_items
rental_transactions
rental_events
reports
disputes
dispute_evidence
favorite_helpers
saved_requests
```

Add other entities only when justified.

---

# 66. DATABASE RELATIONSHIPS

### College

One college has many:

- Users.
- Departments.
- Requests.
- Listings.
- Rental items.

### User

One user can:

- Create many requests.
- Make many offers.
- Accept many tasks over time.
- Create many listings.
- Own many rental items.
- Send many messages.
- Receive many ratings.
- Give many ratings.

### Request

One request:

- Belongs to one requester.
- Can receive many offers.
- Can have one selected helper.
- Has one request lifecycle.
- Has a transaction association.
- Can result in two ratings.

### Rental Item

One item:

- Belongs to one owner.
- Can have many rental transactions over time.

---

# 67. DATABASE INTEGRITY

Use:

- Foreign keys.
- Unique constraints.
- Check constraints where useful.
- Indexes.
- Timestamps.
- Soft deletion where appropriate.
- Transactional updates for critical operations.

Critical consistency examples:

- One request cannot have two selected helpers.
- Offer cannot be accepted after request closes.
- Rating cannot be duplicated.
- Payment cannot be attached to another user's transaction.
- Rental item cannot be reserved by multiple users for overlapping periods.

---

# 68. SECURITY

Implement:

- Secure authentication.
- Secure sessions/tokens.
- Password hashing if passwords are used.
- Server-side validation.
- Authorization.
- Row Level Security.
- Input validation.
- Rate limiting.
- Secure file upload.
- Access control.
- Audit logging for sensitive admin actions.

Never trust the mobile client for:

- Price.
- Reward.
- College ownership.
- User role.
- Payment state.
- Request status.
- Selected helper.
- Admin privileges.

---

# 69. ROW LEVEL SECURITY / AUTHORIZATION

When using Supabase/PostgreSQL:

- Enable RLS on sensitive tables.
- Users can only access their own private records.
- Students can access same-college public requests.
- Request participants can access their chat.
- Users can only create offers as themselves.
- Ratings can only be created by transaction participants.
- Admin operations are role-restricted.
- Verification data must be protected.

Test security policies explicitly.

---

# 70. FILE STORAGE

Possible stored files:

- Profile photos.
- Listing images.
- Request attachments.
- Academic documents.
- Dispute evidence.

Rules:

- Use private buckets for sensitive files.
- Use signed URLs where appropriate.
- Restrict access by user/transaction.
- Validate file type.
- Restrict file size.
- Avoid arbitrary executable uploads.
- Sanitize filenames.

---

# 71. NOTIFICATION ARCHITECTURE

Create a notification service that supports:

- In-app notification records.
- Push delivery.
- Read/unread state.
- Category preferences.

Notification record example:

```text
id
user_id
type
title
body
data
created_at
read_at
```

Do not duplicate business logic across many screens.

---

# 72. EVENT-DRIVEN THINKING

Where useful, model events such as:

```text
REQUEST_CREATED
OFFER_CREATED
OFFER_ACCEPTED
HELPER_SELECTED
REWARD_CHANGED
TASK_STARTED
TASK_COMPLETED
PAYMENT_UPDATED
RATING_CREATED
DISPUTE_CREATED
RENTAL_STARTED
RENTAL_RETURNED
```

These can drive:

- Notifications.
- Analytics.
- Audit logs.
- State transitions.

---

# 73. ANALYTICS

## Student Analytics

- Completed tasks.
- Earnings.
- Average rating.
- Response rate.
- Reliability.
- Category performance.

## Platform Analytics

- Users.
- DAU/MAU if tracked.
- Requests/day.
- Completion rate.
- Average reward.
- Average completion time.
- Category distribution.
- Cancellation rate.
- Dispute rate.
- Rental utilization.

Respect privacy and avoid unnecessary personally identifiable analytics.

---

# 74. SMART RECOMMENDATIONS — FUTURE

Recommend requests based on:

- Past categories.
- Location.
- Availability.
- Reward preferences.
- Historical behavior.

Example:

A student who frequently fulfills food requests can receive more food requests.

Implement recommendation separately from the core request system.

---

# 75. AI FEATURES — FUTURE

Potential AI functionality:

## Natural Language Request Parsing

Input:

```text
Can someone bring me a cold drink from the canteen in the next
15 minutes? I'll pay ₹40.
```

AI extracts:

```text
Category: Quick Delivery
Item: Cold Drink
Location: Canteen
Deadline: 15 minutes
Reward: ₹40
Urgency: High
```

## Other AI ideas

- Request categorization.
- Spam detection.
- Suspicious behavior detection.
- Natural-language search.
- Reward recommendation.
- Helper recommendation.
- Summary generation for admins.

AI must never replace authorization/security rules.

---

# 76. REWARD RECOMMENDATION — FUTURE

Estimate suitable rewards using:

- Distance.
- Time.
- Urgency.
- Historical acceptance.
- Product cost.
- Campus demand.

Example:

```text
Suggested reward: ₹20–₹35
```

User can choose another amount.

---

# 77. GAMIFICATION — OPTIONAL

Badges:

- First Task.
- 10 Tasks.
- 50 Tasks.
- 100 Tasks.
- Highly Reliable.
- Academic Mentor.
- Top Helper.

Avoid making the platform overly competitive.

---

# 78. CAMPUS POINTS — OPTIONAL

A separate non-monetary point system may reward helpful behavior.

Do not confuse:

- Monetary balance.
- Reputation.
- Gamification points.

Keep these domains separate.

---

# 79. UI/UX REQUIREMENTS

The interface should feel:

- Modern.
- Clean.
- Student-friendly.
- Fast.
- Trustworthy.
- Easy to scan.
- Mobile-first.

Design priorities:

- Clear primary actions.
- Visible reward.
- Visible time remaining.
- Clear distance.
- Clear status.
- Clear verification badge.
- Clear rating.
- Clear cancellation/payment state.

Avoid clutter.

---

# 80. REQUEST CARD DESIGN

A request card should ideally show:

```text
Category
Title
Short description
Reward
Approximate distance
Time remaining
Urgency
Requester rating
```

Example:

```text
🍔 FOOD

Bring Maggie

From Campus Canteen
📍 350 m
⏱ 12 min
💰 ₹60 reward
⭐ 4.8 requester
```

Primary action:

```text
View / Offer
```

---

# 81. REQUEST DETAIL SCREEN

Show:

- Full description.
- Reward.
- Product cost where relevant.
- Deadline.
- Approximate location.
- Requester profile summary.
- Verification status.
- Offers if requester.
- Selected helper if accepted.
- Current status.
- Chat button if authorized.
- Cancel/dispute actions where allowed.

---

# 82. USER EXPERIENCE FOR CREATING A REQUEST

Minimize steps.

Ideal:

```text
Tap +
↓
Choose category
↓
Describe need
↓
Set reward
↓
Set location/deadline
↓
Publish
```

Optional advanced fields should not block simple requests.

---

# 83. ERROR HANDLING

Implement useful states:

- Loading.
- Empty state.
- Offline.
- Permission denied.
- Verification failed.
- Request expired.
- Offer no longer available.
- Payment pending.
- Transaction disputed.
- Rental conflict.
- Unauthorized.
- Server error.

Never leave users with a blank screen.

---

# 84. OFFLINE / NETWORK BEHAVIOR

At minimum:

- Show network error gracefully.
- Retry safe operations.
- Avoid duplicate submissions.
- Preserve unsent draft where useful.
- Use idempotency for critical operations where needed.

---

# 85. IDEMPOTENCY

Critical operations should protect against duplicate submissions:

- Creating requests.
- Creating offers.
- Selecting helper.
- Completing tasks.
- Recording payments.
- Creating ratings.

Use:

- Unique constraints.
- Idempotency keys where appropriate.
- Backend validation.

---

# 86. TIME HANDLING

Store timestamps in a consistent timezone representation such as UTC.

Convert to local timezone in UI.

Handle:

- Expiry.
- Scheduled requests.
- Rental return dates.
- Notification timing.

Test near-boundary times.

---

# 87. SEARCH AND PERFORMANCE

Add indexes for:

- College ID.
- Request status.
- Category.
- Created time.
- Deadline.
- Location/geospatial field.
- User ID.
- Offer/request relationships.

Use pagination.

Do not load entire request tables into mobile memory.

---

# 88. SECURITY OF ADMIN PANEL

Admin panel should:

- Require authenticated admin.
- Verify role server-side.
- Use protected routes.
- Restrict data by college if needed.
- Record sensitive actions.
- Provide logout/session management.

---

# 89. TESTING STRATEGY

Implement:

## Unit Tests

For:

- Reward calculation.
- Status transitions.
- Distance calculation.
- Matching score.
- Reliability score.
- Validation.

## Integration Tests

For:

- Authentication.
- College verification.
- Request creation.
- Offer creation.
- Helper selection.
- Completion.
- Payment state.
- Ratings.
- Rental lifecycle.

## Security Tests

For:

- College isolation.
- Unauthorized request access.
- Unauthorized chat access.
- Unauthorized payment modifications.
- Unauthorized admin actions.

## UI Tests

For critical flows:

- Registration.
- Verification.
- Create request.
- Accept/offer.
- Complete.
- Rate.

---

# 90. DEMO DATA

Create a development/demo seed script containing:

- Several colleges.
- Departments.
- 15–30 student users.
- Different ratings.
- Different categories.
- Open requests.
- Active tasks.
- Marketplace listings.
- Rental items.
- Sample reviews.

Use clearly fake/demo data.

Never insert real personal information into the repository.

---

# 91. DOCUMENTATION TO CREATE

Maintain at least:

```text
README.md
ARCHITECTURE.md
DATABASE.md
API.md
SECURITY.md
TESTING.md
DEPLOYMENT.md
PRODUCT_SPEC.md
```

Optional:

```text
docs/
  architecture/
  database/
  api/
  diagrams/
  screenshots/
```

README should contain:

- Project overview.
- Features.
- Tech stack.
- Setup.
- Environment variables.
- Database setup.
- Running instructions.
- Testing.
- Demo accounts if applicable.
- Known limitations.

---

# 92. ARCHITECTURE DOCUMENTATION

Document:

- High-level architecture.
- Mobile app architecture.
- Backend architecture.
- Database architecture.
- Realtime architecture.
- Notification flow.
- Payment flow.
- Geolocation flow.
- Matching flow.
- Security model.

Include diagrams where practical.

---

# 93. API DESIGN

If using REST/Edge Functions, document endpoints such as:

```text
/auth/*
/users/*
/colleges/*
/requests/*
/requests/:id/offers
/requests/:id/select-helper
/requests/:id/complete
/requests/:id/cancel
/messages/*
/payments/*
/ratings/*
/rentals/*
/listings/*
/reports/*
/disputes/*
/admin/*
```

Do not expose sensitive server logic directly to clients.

---

# 94. BUSINESS RULES

Centralize business rules.

Examples:

- Only verified users can create public requests.
- User must belong to request college.
- Request cannot accept offers after closing.
- Request can only have one selected helper.
- Only authorized participants can chat.
- Ratings are available only after valid completion.
- Users cannot rate themselves.
- Rental item cannot overlap with another active rental.
- Payment status cannot be changed arbitrarily by client.
- Admin-only actions require admin authorization.

---

# 95. IMPORTANT SECURITY RULE

Never trust user-submitted values for:

- College ID.
- Role.
- Reward.
- Payment amount.
- Status.
- Completion.
- Rating ownership.
- Helper ownership.
- Listing ownership.

The server must derive or validate these.

---

# 96. FINAL-SEMESTER MVP

The minimum polished version should include:

```text
Student Registration
↓
College Verification
  ├── College Email
  └── Campus Location
↓
Profile
↓
Create Request
↓
Request Feed
↓
Search/Filters
↓
Offer / Accept
↓
Request Lifecycle
↓
Realtime Notification
↓
Request Chat
↓
Task Completion
↓
QR/UPI Payment Workflow
↓
Two-Way Rating
↓
Reputation
```

The MVP must be stable before adding advanced modules.

---

# 97. ADVANCED VERSION

After MVP:

- Dynamic reward escalation.
- Intelligent helper matching.
- Nearby request discovery.
- Borrow/rent.
- Student marketplace.
- Academic help.
- Peer tutoring.
- Admin dashboard.
- Reports/disputes.
- Analytics.
- Availability.
- Scheduled requests.
- Favorite helpers.
- AI request parsing.
- Reward recommendation.
- Gamification.

---

# 98. RECOMMENDED DEVELOPMENT ORDER

Do not attempt to implement every feature at once.

Recommended order:

```text
1. Repository inspection
2. Architecture
3. Auth
4. College model
5. Verification
6. Profile
7. Request model
8. Request creation
9. Request feed
10. Offers
11. Selection
12. Status machine
13. Realtime
14. Chat
15. Completion
16. Payment workflow
17. Ratings
18. Reputation
19. Notifications
20. Dynamic reward
21. Matching
22. Rentals
23. Marketplace
24. Academic
25. Admin
26. Disputes
27. Analytics
28. Polish
29. Testing
30. Final documentation
```

---

# 99. VIVA / FINAL-SEMESTER TECHNICAL VALUE

The project should be capable of demonstrating:

- Authentication.
- Authorization.
- College verification.
- Geolocation.
- Geofencing.
- Realtime communication.
- Push notifications.
- Database design.
- Marketplace logic.
- Matching algorithm.
- Recommendation.
- Transaction lifecycle.
- Reputation.
- Payment workflow.
- Security.
- File storage.
- Search.
- Admin moderation.
- Analytics.

This is intentionally broader than a basic CRUD project.

---

# 100. COMPLETE EXAMPLE — FOOD REQUEST

Scenario:

Rahul needs a cold drink.

```text
Rahul creates:

Bring Cold Drink
Product cost: ₹20
Reward: ₹10
Total estimated budget: ₹30
Pickup: Campus Canteen
Delivery: Hostel A
Deadline: 20 min
```

System:

```text
Request OPEN
↓
Nearby eligible helpers found
↓
Notification sent
↓
Aman views request
↓
Aman accepts / offers ₹10
↓
Rahul selects Aman
↓
Request ACCEPTED
↓
Chat opens
↓
Aman buys drink
↓
Aman marks COMPLETED
↓
Rahul confirms
↓
Payment workflow
↓
PAID
↓
Both rate each other
↓
Aman's reputation updates
```

---

# 101. COMPLETE EXAMPLE — DYNAMIC REWARD

```text
11:00 PM
Bring Maggie
Reward ₹30
```

Nobody accepts.

```text
11:10 PM
Reward ₹40
```

Nobody accepts.

```text
11:20 PM
Reward ₹60
```

A nearby student accepts.

The app should:

- Update the reward.
- Notify interested helpers.
- Record reward history.
- Preserve request state.
- Prevent multiple helpers from claiming the final slot.

---

# 102. COMPLETE EXAMPLE — RENTAL

Aman lists:

```text
Scientific Calculator
₹30/day
Deposit ₹200
Available
```

Rahul requests.

```text
AVAILABLE
↓
RESERVED
↓
RENTED
↓
RETURN_PENDING
↓
RETURNED
```

Track:

- Rental duration.
- Deposit.
- Pickup.
- Return.
- Damage/dispute.
- Confirmation.

---

# 103. COMPLETE EXAMPLE — ACADEMIC HELP

Rahul creates:

```text
Need DBMS Notes
Reward ₹50
Deadline tonight
```

A student with relevant skills responds.

```text
Request
↓
Offer
↓
Selection
↓
Chat / resource sharing
↓
Completion
↓
Payment
↓
Rating
```

---

# 104. COMPLETE EXAMPLE — PEER TUTORING

```text
Need help with SQL JOINs
30 minutes
Reward ₹100
```

Tutor profile:

```text
SQL
★★★★★ 4.9
34 sessions
```

Rahul selects tutor.

They complete the session.

Then:

- Completion.
- Payment.
- Two-way rating.

---

# 105. RECOMMENDED UI SCREENS

At minimum design these screens:

### Authentication

- Splash.
- Welcome.
- Login.
- Register.
- College selection.
- Email verification.
- Location verification.

### Main App

- Home.
- Discover requests.
- Request detail.
- Create request.
- My requests.
- My tasks.
- Offer management.
- Task detail.
- Chat.
- Notifications.
- Profile.
- Edit profile.

### Marketplace

- Marketplace home.
- Listing details.
- Create listing.
- My listings.

### Rentals

- Rental discovery.
- Rental details.
- Create rental listing.
- Rental request.
- Active rentals.
- Rental return.

### Academic

- Academic requests.
- Tutor profile.
- Create academic request.

### Payments

- Payment details.
- QR display.
- Payment status.
- Transaction history.

### Trust

- Ratings.
- Reviews.
- Report.
- Dispute.

### Admin

- Admin dashboard.
- User management.
- College management.
- Reports.
- Disputes.
- Analytics.

---

# 106. UX DETAILS THAT MATTER

Every major screen should have:

- Loading state.
- Error state.
- Empty state.
- Retry behavior.
- Success feedback.
- Disabled state for invalid actions.

Buttons should reflect state:

```text
Accept
Offer
Selected
In Progress
Mark Completed
Confirm Completion
Pay
Paid
Rate
```

Do not show contradictory actions.

---

# 107. DESIGN SYSTEM

Create reusable components for:

- Buttons.
- Inputs.
- Cards.
- Chips.
- Avatars.
- Ratings.
- Badges.
- Status indicators.
- Location indicators.
- Reward display.
- Countdown/deadline.
- Confirmation dialogs.
- Bottom sheets.

Use consistent spacing, typography, and component states.

---

# 108. ACCESSIBILITY

Support:

- Sufficient contrast.
- Semantic labels.
- Large enough touch targets.
- Screen reader labels where practical.
- Error text that explains the problem.
- Do not rely only on color to communicate status.

---

# 109. LOCALIZATION

Architecture should make localization possible later.

Avoid hard-coding user-facing strings throughout business logic.

---

# 110. PERFORMANCE

Optimize for:

- Fast startup.
- Paginated feeds.
- Efficient images.
- Cached profile/listing images.
- Limited realtime subscriptions.
- Indexed database queries.
- Minimal unnecessary network requests.

Do not optimize prematurely before measuring.

---

# 111. OBSERVABILITY

Add useful development logging.

For production-style implementation:

- Error logging.
- Request IDs/correlation IDs if backend supports them.
- Admin audit events.
- Important state transition records.

Do not log:

- Passwords.
- Tokens.
- Private payment data.
- Unnecessary exact user locations.

---

# 112. ENVIRONMENT MANAGEMENT

Use environment variables for:

- Backend URL.
- API keys.
- Notification credentials.
- Maps credentials.
- Payment provider credentials.
- AI credentials.

Provide:

```text
.env.example
```

Never commit real secrets.

---

# 113. DEPLOYMENT

Document how to deploy:

- Database.
- Backend.
- Mobile app.
- Admin web app.
- Storage.
- Notification service.

Use separate development and production configuration.

---

# 114. DEVELOPMENT CONVENTIONS

Use:

- Strong typing.
- Small reusable functions.
- Clear naming.
- Feature-based folders.
- Consistent error handling.
- Dependency injection where useful.
- Service/repository separation where useful.
- No giant files if avoidable.

Avoid:

- Hard-coded IDs.
- Hard-coded mock responses in production paths.
- Business logic inside UI widgets.
- Duplicated API logic.
- Magic numbers without explanation.

---

# 115. GIT / VERSION CONTROL

Create logical commits where possible.

Examples:

```text
feat(auth): add student registration
feat(verification): add college email verification
feat(location): add campus geofence verification
feat(requests): add request lifecycle
feat(offers): add helper offers
feat(chat): add request chat
feat(payments): add QR payment workflow
feat(ratings): add two-way reviews
```

Do not commit secrets.

---

# 116. ACCEPTANCE CRITERIA — MVP

The project is MVP-complete only when all of these work end-to-end:

### Authentication

- User can register.
- User can login/logout.
- Unauthenticated user cannot access protected application features.

### Verification

- College email verification works or is clearly configured for demo.
- Geolocation campus verification works against configured college boundaries.
- Verification status is stored and enforced.

### Requests

- Verified user can create a request.
- Request appears only to authorized college users.
- Request can expire.
- Request can be cancelled under rules.

### Offers

- Helper can offer/accept.
- Requester can select one helper.
- Competing offers are closed correctly.

### Realtime

- Important request updates appear without manual refresh.

### Chat

- Only authorized participants can chat.

### Completion

- Helper can mark completed.
- Requester can confirm.
- Invalid users cannot alter status.

### Payments

- QR/UPI workflow is functional.
- Payment status is tracked honestly.

### Ratings

- Both sides can rate after valid completion.
- Duplicate/self-ratings are prevented.

### Security

- Cross-college unauthorized access is blocked.
- RLS/backend authorization is tested.

---

# 117. ADVANCED ACCEPTANCE CRITERIA

After MVP, each of these should have a tested end-to-end flow:

- Dynamic rewards.
- Matching.
- Availability preferences.
- Rentals.
- Marketplace.
- Academic help.
- Peer tutoring.
- Reports.
- Disputes.
- Admin dashboard.
- Analytics.

---

# 118. PROJECT PRESENTATION DEMO FLOW

The final demo should show one coherent story:

```text
1. Student registers
2. Student chooses college
3. Student verifies via college email or location
4. Student creates request
5. Matching finds nearby helpers
6. Helper receives notification
7. Helper sends offer
8. Requester selects helper
9. Realtime request status changes
10. Chat opens
11. Helper completes task
12. Requester confirms
13. Payment QR shown
14. Payment status recorded
15. Both rate each other
16. Reputation updates
17. Reward escalation demonstrated
18. Rental demonstrated
19. Academic-help request demonstrated
20. Admin dashboard shown
```

Do not demo features as disconnected mockups. Demonstrate a complete transaction.

---

# 119. FINAL PROJECT NARRATIVE

When presenting the project, describe it as:

> **CampusBuddy is a verified, college-restricted peer-to-peer marketplace where students can request and provide micro-services, assistance, rentals, academic resources, and other student-to-student support in exchange for rewards. The platform combines college identity verification, geolocation, realtime requests, matching, transaction workflows, reputation, and community trust into one campus ecosystem.**

---

# 120. WHAT MAKES CAMPUSBUDDY DISTINCT

The core differentiator is not simply:

> "Students can ask each other for help."

It is:

> **Every verified student can simultaneously be a customer, helper, seller, renter, borrower, tutor, and resource provider inside a trusted college-only marketplace.**

The system combines:

- Verification.
- Micro-services.
- Marketplace.
- Rentals.
- Academic support.
- Dynamic rewards.
- Realtime interaction.
- Matching.
- Reputation.
- Payment tracking.
- Moderation.

---

# 121. IMPORTANT IMPLEMENTATION PRIORITIES

When trade-offs are necessary, prioritize in this order:

1. Security.
2. Correctness.
3. Request lifecycle integrity.
4. College isolation.
5. Authentication/verification.
6. Reliable core UX.
7. Realtime functionality.
8. Payment state correctness.
9. Testing.
10. Advanced features.

Do not sacrifice security or data integrity just to add more screens.

---

# 122. WHAT NOT TO DO

Do not:

- Build only static UI screens.
- Use fake success messages for unfinished backend functionality.
- Let clients freely set payment state.
- Let clients freely set request status.
- Expose all college users' private data.
- Expose exact location unnecessarily.
- Claim QR scanning proves payment.
- Create fake AI functionality that does not actually process anything.
- Build a complicated recommendation engine before the core marketplace works.
- Overengineer the architecture without delivering working features.
- Leave core features undocumented.

---

# 123. CLAUDE CODE EXECUTION INSTRUCTIONS

Start by doing the following:

## Step 1 — Inspect

Inspect:

- All repository files.
- Package manifests.
- Existing app entry points.
- Existing routes.
- Existing database code.
- Existing configuration.
- Existing README.
- Existing environment files.

## Step 2 — Summarize Internally in Project Docs

Create/update:

```text
PROJECT_STATE.md
```

Include:

- Current stack.
- Current architecture.
- Existing modules.
- Planned changes.
- Risks/unknowns.

## Step 3 — Establish Foundation

Set up:

- Folder structure.
- Environment handling.
- Error handling.
- Logging.
- Backend connectivity.
- Database migrations.
- Authentication foundation.

## Step 4 — Implement Feature by Feature

Do not build all UI first.

For each feature:

```text
Database
↓
Backend/business logic
↓
Security rules
↓
API/realtime
↓
State management
↓
UI
↓
Tests
↓
Documentation
```

## Step 5 — Validate

After every major phase:

- Run formatter.
- Run linter.
- Run tests.
- Build the application.
- Fix errors.
- Update docs.

---

# 124. DEFINITION OF DONE

A feature is "done" only when:

- Database/schema is complete.
- Backend logic is implemented.
- Authorization is implemented.
- UI is implemented.
- Loading/error/empty states exist.
- Realtime behavior is implemented if required.
- Tests exist for critical logic.
- Integration has been tested.
- Documentation is updated.

---

# 125. WHEN SOMETHING IS UNCLEAR

Do not repeatedly stop and ask for confirmation for minor engineering choices.

Instead:

- Select the simplest robust option.
- Record the decision in `ARCHITECTURE.md`.
- Implement it cleanly.
- Continue.

Ask for clarification only when a user-specific requirement genuinely blocks safe implementation and cannot reasonably be inferred.

---

# 126. SCOPE MANAGEMENT

Because this is a final-semester project, avoid overbuilding.

**The current project is specifically for NIT Patna students at the Bihta Campus. Do not expand the MVP into a generic multi-college platform.**

Core MVP must be excellent.

Advanced features should be added only after:

- Auth works.
- Verification works.
- Requests work.
- Offers work.
- Realtime works.
- Completion works.
- Payment workflow works.
- Ratings work.
- Security is tested.

---

# 127. EXPECTED FINAL REPOSITORY SHAPE

Adapt to the actual chosen stack, but aim for a clear structure similar to:

```text
campusbuddy/
├── mobile/
│   ├── lib/
│   │   ├── core/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── verification/
│   │   │   ├── profile/
│   │   │   ├── requests/
│   │   │   ├── offers/
│   │   │   ├── chat/
│   │   │   ├── notifications/
│   │   │   ├── payments/
│   │   │   ├── ratings/
│   │   │   ├── rentals/
│   │   │   ├── marketplace/
│   │   │   ├── academic/
│   │   │   └── admin/
│   │   └── main.dart
│   └── test/
├── admin/
├── backend/
├── database/
│   ├── migrations/
│   └── seed/
├── docs/
├── .env.example
├── README.md
├── ARCHITECTURE.md
├── DATABASE.md
├── API.md
├── SECURITY.md
├── TESTING.md
├── DEPLOYMENT.md
├── PRODUCT_SPEC.md
└── PROJECT_STATE.md
```

Do not force this exact directory structure if the chosen framework has a better idiomatic organization.

---

# 128. FINAL QUALITY BAR

The final product should feel like a realistic student startup prototype rather than a collection of CRUD screens.

It should visibly demonstrate:

- A real problem.
- A coherent business model.
- A clear request lifecycle.
- Verified users.
- Meaningful matching.
- Realtime communication.
- Trust/reputation.
- Payment workflow.
- Geolocation.
- Strong data security.
- Extensible architecture.

The application's most important demo should be:

```text
Verified Student
    ↓
Creates Real Request
    ↓
Suitable Students See It
    ↓
Helper Offers
    ↓
Requester Selects
    ↓
Realtime Chat
    ↓
Task Completed
    ↓
Payment Tracked
    ↓
Both Rate
    ↓
Reputation Changes
```

---

# 129. FINAL INSTRUCTION TO CLAUDE

Build **CampusBuddy** as a complete, maintainable final-semester project from this specification.

Do not limit the work to generating examples.

Your goal is to leave the VS Code workspace with:

- A working application.
- A real database.
- Proper authentication.
- College verification.
- Geolocation verification.
- Request marketplace.
- Helper offers.
- Request lifecycle.
- Realtime notifications.
- Chat.
- Completion.
- Payment workflow.
- Ratings.
- Reputation.
- Rentals.
- Marketplace.
- Academic help.
- Admin/moderation foundation.
- Security policies.
- Tests.
- Documentation.
- Seed/demo data.
- Setup instructions.

When advanced features cannot be safely or realistically integrated yet, implement the architecture/interfaces needed for them and document the limitation rather than faking functionality.

Always optimize for a strong, demonstrable, secure, final-semester engineering project.

# END OF MASTER PROMPT
