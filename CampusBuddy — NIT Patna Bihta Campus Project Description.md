# CampusBuddy

## 1. Project Overview

- **CampusBuddy** is a campus-restricted peer-to-peer platform developed specifically for **students of NIT Patna at the Bihta Campus**.
- The application connects students who **need small services, assistance, resources, or temporary access to items** with other NIT Patna Bihta Campus students who are willing to help in exchange for a monetary reward.
- The platform creates a **student-to-student micro-service marketplace within the NIT Patna Bihta Campus community**.
- The application is not intended to be a general public marketplace.
- Only verified NIT Patna Bihta Campus students should be able to participate.
- Examples of use cases include:
  - Getting chocolates, cold drinks, Maggie, snacks, or food from a canteen/shop.
  - Buying and delivering a pen, notebook, copy, stationery, printout, or other small item.
  - Collecting or delivering an item somewhere within the campus.
  - Borrowing or renting a scientific calculator, charger, power bank, HDMI cable, books, camera, tripod, etc.
  - Sharing class notes, PDFs, previous-year questions, placement preparation material, or other academic resources.
  - Providing peer tutoring or explaining difficult topics.
  - Helping another student with small hostel or campus-related tasks.
  - Selling, buying, exchanging, renting, or giving away used student items.
- A student who fulfills a request receives a monetary reward.
- The same student can act as both:
  - A person seeking help.
  - A person providing help.
- CampusBuddy combines:
  - Student-to-student services.
  - Micro-gigs.
  - Student rentals.
  - Student marketplace.
  - Academic help.
  - Peer tutoring.
  - Realtime communication.
  - Location-based discovery.
  - Reputation and ratings.
  - Payment tracking.

---

# 2. Current Project Scope

- The current version of CampusBuddy is specifically for:
  - **Institution:** National Institute of Technology Patna (NIT Patna)
  - **Campus:** Bihta Campus
  - **Users:** NIT Patna students associated with the Bihta Campus
- The current MVP should operate as a **single-campus community**.
- Do not build a generic onboarding system where arbitrary colleges can register themselves.
- Do not expose Bihta Campus requests to students from other colleges.
- All services, rentals, academic requests, marketplace activity, chats, and ratings should remain inside the NIT Patna Bihta Campus ecosystem.
- The underlying architecture may keep institution/campus identifiers so that the application can be expanded in the future.
- Multi-college support, however, is **future scope**, not a core MVP requirement.

---

# 3. Main Objective

- Create a trusted digital ecosystem for **NIT Patna Bihta Campus students** where students can:
  - Request help.
  - Provide help.
  - Earn money through small tasks.
  - Rent out items.
  - Borrow items.
  - Share academic resources.
  - Provide peer tutoring.
  - Buy and sell used items.
- Reduce the inconvenience associated with small everyday student needs.
- Make it easy to find another student who is:
  - Nearby.
  - Available.
  - Willing to help.
- Provide an incentive for students to help each other.
- Build trust through:
  - Student verification.
  - Ratings.
  - Reviews.
  - Reliability.
  - Transaction history.
  - Reporting and moderation.

---

# 4. Target Users

- NIT Patna students at the Bihta Campus who need:
  - Small services.
  - Deliveries.
  - Academic material.
  - Peer assistance.
  - Temporary access to equipment.
  - Used goods.
- NIT Patna students who want:
  - Small earning opportunities.
  - Flexible micro-gigs.
  - To monetize their spare time.
  - To rent out items they own.
  - To provide academic assistance.
  - To sell unused items.
- Potential community groups inside Bihta Campus:
  - Departments.
  - Years.
  - Hostels.
  - Student clubs.
  - Other authorized campus communities.

---

# 5. Core Concept

- A student creates a request.
- The request contains:
  - What they need.
  - Reward.
  - Deadline.
  - Location.
  - Category.
- Other verified Bihta Campus students can discover the request.
- Interested students can:
  - Accept the reward.
  - Make an offer.
- The requester selects a helper.
- The helper performs the task.
- The requester confirms completion.
- Payment is completed or recorded.
- Both users rate one another.
- Their reputation is updated.

Core flow:

```text
Need
↓
Create Request
↓
Eligible Bihta Campus Students Discover Request
↓
Offer / Accept
↓
Requester Selects Helper
↓
Chat / Coordination
↓
Task Completed
↓
Requester Confirms
↓
Payment
↓
Two-Way Rating
↓
Reputation Update
```

---

# 6. Example Everyday Services

- Bring a cold drink from the canteen.
- Bring chocolates from a nearby shop.
- Buy Maggie late at night.
- Bring a pen.
- Bring a copy/notebook.
- Get a printout.
- Pick up an item from another campus location.
- Deliver food or stationery inside the campus.
- Help carry something to a hostel.
- Stand in a queue.
- Find a particular item or location.
- Help another student collect something.

---

# 7. Borrow and Rental Examples

- Scientific calculator.
- Laptop charger.
- Phone charger.
- Power bank.
- Type-C cable.
- HDMI cable.
- USB accessories.
- Books.
- Camera.
- Tripod.
- Speakers.
- Projector.
- Sports equipment.
- Other student-owned gadgets or useful items.

Example:

```text
Scientific Calculator
₹30/day
Deposit: ₹200
Available
```

---

# 8. Academic Help Examples

- Class notes.
- Handwritten notes.
- PDF resources.
- Previous-year questions.
- Placement preparation material.
- Placement test questions shared legitimately.
- Interview preparation.
- Subject resources.
- Lab resources.
- Topic explanation.
- Peer tutoring.
- Programming help.
- SQL help.
- Database help.
- Mathematics assistance.

Example:

```text
Need DBMS notes
Reward: ₹50
Deadline: Tonight
```

---

# 9. Student Marketplace

- CampusBuddy can include a small marketplace restricted to NIT Patna Bihta Campus students.
- Students can:
  - Buy.
  - Sell.
  - Rent.
  - Borrow.
  - Exchange.
  - Give away.
- Examples:
  - Semester books.
  - Lab coats.
  - Electronics.
  - Hostel items.
  - Accessories.
  - Sports equipment.
  - Stationery.
- Physical handover is practical because participants are within the same campus community.

---

# 10. Student Verification

## Verification Goal

- Ensure that participants are genuine NIT Patna students associated with the Bihta Campus.
- A verified identity creates more trust than an unrestricted public marketplace.

## Method 1 — NIT Patna College Email

Flow:

```text
Register
↓
Enter NIT Patna Student Email
↓
Send OTP / Verification Link
↓
Verify
↓
CampusBuddy Verified
```

- The official NIT Patna student email domain should be configurable in the project backend/environment.
- Do not hard-code or invent an email domain without verifying the correct domain.
- Email verification should:
  - Expire.
  - Be rate-limited.
  - Prevent OTP abuse.
  - Store verification metadata.

Profile example:

```text
CampusBuddy Verified ✓
Verified via College Email
```

## Method 2 — Bihta Campus Geolocation

Flow:

```text
Register
↓
Select Bihta Campus Verification
↓
Allow Location
↓
Read Current GPS Coordinates
↓
Compare with Bihta Campus Geofence
↓
Inside Campus?
├── Yes → Verified
└── No → Verification Failed
```

- Store Bihta Campus:
  - Latitude.
  - Longitude.
  - Geofence radius or polygon.
- MVP can use:
  - Center coordinates + radius.
- Advanced version can use:
  - Polygon/geofence boundary.
- Location should be collected only when needed.
- The app should not continuously track students in the background just for verification.
- GPS should be treated as one verification signal, not perfect proof of enrollment.

---

# 11. Home Screen

The home screen should be designed specifically for Bihta Campus students.

Possible sections:

- Create Request.
- Nearby Requests.
- Recommended Requests.
- My Requests.
- My Tasks.
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

---

# 12. Request Creation

A student can quickly create a request.

Fields:

- Title.
- Description.
- Category.
- Reward.
- Product cost if applicable.
- Total estimated amount.
- Pickup location.
- Delivery location.
- Approximate location.
- Deadline.
- Urgency.
- Visibility.
- Attachments/photos.
- Additional instructions.

Example:

```text
Bring Cold Drink

Product cost: ₹20
Reward: ₹10
Total estimated amount: ₹30

Pickup:
Campus Canteen

Delivery:
Hostel

Deadline:
20 minutes
```

---

# 13. Request Categories

## Quick Delivery

- Food.
- Cold drinks.
- Chocolates.
- Snacks.
- Grocery.
- Stationery.
- Printouts.
- Small purchases.

## Campus Assistance

- Collection.
- Delivery.
- Queue assistance.
- Hostel help.
- Carrying/moving.
- Finding something.
- Small campus tasks.

## Academic Help

- Notes.
- PDFs.
- PYQs.
- Placement material.
- Interview preparation.
- Study resources.
- Topic explanations.
- Peer tutoring.
- Lab resources.

## Borrow/Rent

- Calculator.
- Charger.
- Power bank.
- Cable.
- HDMI.
- Books.
- Camera.
- Tripod.
- Speakers.
- Projector.
- Sports equipment.

## Technical Help

- Computer troubleshooting.
- Software setup.
- Programming guidance.
- Project guidance.
- Device setup.
- Printing/file assistance.

## Marketplace

- Buy.
- Sell.
- Rent.
- Borrow.
- Exchange.
- Give away.

---

# 14. Request Visibility

Because CampusBuddy currently serves only NIT Patna Bihta Campus:

- Everyone in Bihta Campus.
- Nearby students.
- Hostel/community.
- Department.
- Specific year/group.
- Trusted/favorite helpers.

Rules:

- All visible requests remain inside the authorized Bihta Campus community.
- Exact personal location should not be public by default.
- Backend authorization must enforce access.

---

# 15. Reward System

- The requester chooses the reward.
- The reward is the compensation for the student providing the service.
- Product cost and reward should be displayed separately where relevant.

Example:

```text
Product cost: ₹20
Helper reward: ₹10
Total estimated cost: ₹30
```

For other tasks:

```text
Need DBMS Notes
Reward: ₹50
```

---

# 16. Dynamic Reward Escalation

- If nobody accepts the request, the requester can increase the reward.

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

- Increase Reward.
- Reward history.
- Optional automatic escalation.
- Maximum reward limit.
- Notifications when reward increases.

---

# 17. Helper Discovery

Verified NIT Patna Bihta Campus students can discover:

- Open requests.
- Nearby requests.
- High-reward requests.
- Urgent requests.
- Ending-soon requests.
- Recommended requests.

Filters:

- Category.
- Distance.
- Reward.
- Deadline.
- Urgency.
- Location.

Sort:

- Recommended.
- Nearest.
- Highest reward.
- Ending soon.

---

# 18. Intelligent Helper Matching

CampusBuddy can rank suitable helpers using:

- Distance.
- Category interest.
- Availability.
- Minimum reward preference.
- Rating.
- Completion rate.
- Response speed.
- Previous experience.
- Urgency.

Conceptual formula:

```text
Helper Score =
Distance
+ Category Match
+ Availability
+ Rating
+ Reliability
+ Reward Preference
+ Response History
+ Urgency Fit
```

The matching module should be independent from the UI.

---

# 19. Offers / Bidding

Instead of simply accepting a request, helpers can optionally make offers.

Example:

```text
Requester:
Bring Cold Drink
Reward: ₹30

Aman: ₹30
Rohit: ₹35
Karan: ₹40
```

The requester can choose the preferred helper.

Prevent:

- Duplicate offers.
- Offers after expiry.
- Offers after selection.
- Multiple selected helpers.
- Concurrent selection conflicts.

---

# 20. Request Lifecycle

Recommended statuses:

```text
OPEN
↓
OFFERS_RECEIVED
↓
HELPER_SELECTED
↓
ACCEPTED
↓
IN_PROGRESS
↓
COMPLETED
↓
PAYMENT_PENDING
↓
PAID
↓
RATED
```

Other statuses:

```text
CANCELLED
EXPIRED
REJECTED
HELPER_WITHDREW
DISPUTED
```

- All transitions must be validated by the backend.
- Users must not be able to arbitrarily set statuses.
- Store important status changes.

---

# 21. Real-Time Updates

Realtime functionality should cover:

- New offers.
- Helper selection.
- Reward changes.
- Request cancellation.
- Request completion.
- Payment status.
- Chat messages.
- Rental updates.
- Other important request events.

Possible technologies:

- Supabase Realtime.
- WebSockets.
- Firebase Realtime capabilities.

---

# 22. Chat

- Provide request-specific chat between requester and selected helper.
- Support:
  - Text.
  - Images.
  - Timestamps.
  - Read state where practical.
- Optional:
  - Location sharing.
  - Delivery proof.

Only authorized participants can access the chat.

---

# 23. Location Features

Location can be used for:

- Bihta Campus verification.
- Nearby request discovery.
- Approximate distance.
- Pickup/drop-off.
- Matching.
- Optional maps.

Privacy strategy:

```text
Before selection:
Approximate location

After helper selection:
More precise location when necessary
```

Do not expose room number or exact personal location publicly.

---

# 24. Urgent Requests

Allow:

```text
NORMAL
URGENT
```

Urgent requests may:

- Receive higher ranking.
- Trigger quicker notification.
- Have shorter expiration.
- Encourage higher rewards.

---

# 25. Notifications

## Requester

Notify when:

- Offer received.
- Helper selected.
- Helper withdraws.
- Task started.
- Task completed.
- Reward changed.
- Chat message received.
- Payment status changes.
- Request expires.
- Dispute changes.

## Helper

Notify when:

- Relevant request appears.
- Reward increases.
- Offer accepted.
- Request cancelled.
- Chat message arrives.
- Deadline approaches.
- Payment is recorded/completed.
- Rental return is approaching.

Users should be able to control notification preferences.

---

# 26. Availability

Students can set:

```text
Available Now
Busy
Available Later
```

Optional:

- Time windows.
- Preferred categories.
- Maximum distance.
- Minimum reward.

Matching should use availability.

---

# 27. Payment System

For the initial project:

- Students can add:
  - UPI ID.
  - Payment QR.
- Requester can view the helper's QR at the appropriate stage.
- Payment happens through the external UPI application.
- CampusBuddy records the payment state.

Possible states:

```text
PAYMENT_PENDING
PAYMENT_INITIATED
PAYMENT_CLAIMED
PAYMENT_CONFIRMED
PAYMENT_DISPUTED
REFUNDED
```

Important:

- QR scanning itself does not prove that money was successfully transferred.
- Do not falsely claim automatic bank verification without a real payment integration.
- The project can use manual confirmation for the MVP.

---

# 28. Wallet / Escrow-Style Future Design

Potential future flow:

```text
Requester
↓
Money Reserved
↓
Helper Completes Task
↓
Requester Confirms
↓
Money Released
↓
Helper Receives Reward
```

For the semester project, this can be represented through transaction states if a real escrow/payment provider is not available.

---

# 29. Completion and Confirmation

- Helper marks task completed.
- Requester receives notification.
- Requester confirms completion.
- If requester disagrees:
  - Dispute can be opened.
- Payment proceeds according to the transaction workflow.
- Rating becomes available after valid completion.

Optional proof:

- Photo.
- Delivery confirmation.
- Completion note.

---

# 30. Rating System

After completion:

- Requester rates helper.
- Helper rates requester.

Possible helper rating dimensions:

- Punctuality.
- Reliability.
- Communication.
- Service quality.

Possible requester rating dimensions:

- Clear instructions.
- Communication.
- Payment reliability.
- Respectful behavior.

Use:

- 1–5 stars.
- Optional written review.

Prevent:

- Self-rating.
- Duplicate rating.
- Rating before completion.

---

# 31. Reputation System

Profile can show:

```text
Aman
★★★★★ 4.9

127 Tasks Completed
98% Completion Rate
2% Cancellation Rate
```

Reputation factors can include:

- Average rating.
- Tasks completed.
- Completion rate.
- Cancellation rate.
- Response rate.
- Disputes.
- Successful transactions.

---

# 32. Borrow/Rent System

Students can list items.

Listing fields:

- Item name.
- Description.
- Photos.
- Condition.
- Rental price.
- Duration.
- Deposit.
- Availability.
- Pickup zone.
- Rules.

Example:

```text
Scientific Calculator
₹30/day
Deposit ₹200
Available
```

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

# 33. Rental Flow

```text
Student lists item
↓
Another student requests rental
↓
Owner accepts
↓
Item reserved
↓
Pickup
↓
Rental active
↓
Item returned
↓
Owner confirms
↓
Deposit handled
↓
Rental completed
```

Track:

- Start time.
- Expected return.
- Actual return.
- Deposit.
- Damage.
- Disputes.

---

# 34. Marketplace

A Bihta Campus student marketplace can support:

- Used books.
- Electronics.
- Hostel items.
- Lab coats.
- Accessories.
- Sports equipment.
- Stationery.
- Other useful student products.

Listings contain:

- Title.
- Description.
- Price.
- Condition.
- Category.
- Photos.
- Availability.
- Seller.
- Pickup zone.

All marketplace activity remains inside the authorized NIT Patna Bihta Campus community.

---

# 35. Academic Help

Students can request:

- Notes.
- PDFs.
- PYQs.
- Placement material.
- Subject guidance.
- Topic explanation.
- Peer tutoring.
- Lab material.
- Interview preparation.

The application should support legitimate academic help and must not intentionally facilitate cheating or unauthorized exam misconduct.

---

# 36. Peer Tutoring

Students can offer:

- Programming tutoring.
- SQL.
- DBMS.
- Mathematics.
- Networks.
- Interview preparation.
- Other subjects.

Tutor profile can display:

- Skills.
- Rating.
- Sessions completed.
- Availability.

Request:

```text
Need help with SQL JOINs
30 minutes
Reward: ₹100
```

---

# 37. Technical Help

Examples:

- Computer troubleshooting.
- Software setup.
- Programming guidance.
- Project setup.
- Device configuration.
- Printing/file assistance.

---

# 38. Favorite Helpers

Students can mark reliable helpers as favorites.

Possible use:

- Invite favorite helpers.
- Send requests directly to trusted helpers.
- Notify them first.
- Restrict a request to trusted helpers.

---

# 39. Repeat Requests

Allow users to recreate earlier requests.

Examples:

- Weekly tutoring.
- Repeated printouts.
- Frequent food pickup.
- Repeated rentals.

Always allow the requester to review old information before republishing.

---

# 40. Scheduled Requests

Example:

```text
Bring printed notes tomorrow at 9:00 AM
```

The system can:

- Store scheduled time.
- Activate request appropriately.
- Notify eligible helpers.
- Expire after service window.

---

# 41. Student Earnings Dashboard

Helpers can see:

```text
Total Earned: ₹4,850
Tasks Completed: 127
Average Reward: ₹38
```

Include:

- Total earnings.
- Pending rewards.
- Completed tasks.
- Monthly earnings.
- Average reward.

---

# 42. Requester Dashboard

Show:

- Active requests.
- Completed requests.
- Cancelled requests.
- Pending payments.
- Transaction history.
- Disputes.

---

# 43. Helper Dashboard

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

# 44. Admin Panel

The administrator for the NIT Patna Bihta Campus deployment can:

- Manage users.
- Manage departments.
- Manage campus configuration.
- Manage categories.
- Review verification issues.
- Review reports.
- Resolve disputes.
- Suspend users.
- Remove inappropriate listings.
- View platform statistics.

Admin analytics:

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

# 45. Campus Communities

Optional restricted groups within Bihta Campus:

- Department.
- Year.
- Hostel.
- Club/community.

Examples:

```text
CSE
3rd Year
Hostel A
```

A request can optionally be restricted to one of these groups.

---

# 46. Reports and Moderation

Users should be able to report:

- Users.
- Requests.
- Marketplace listings.
- Messages.
- Payment problems.
- Rental problems.

Report statuses:

```text
OPEN
UNDER_REVIEW
RESOLVED
DISMISSED
ESCALATED
```

---

# 47. Dispute System

Possible disputes:

- Item not delivered.
- Incorrect item.
- Payment disagreement.
- Requester refused payment.
- Rental item damaged.
- Rental item not returned.
- Marketplace problem.

Flow:

```text
Transaction
↓
Dispute Created
↓
Evidence Submitted
↓
Admin Review
↓
Resolution
↓
Outcome Recorded
```

---

# 48. Fraud and Abuse Prevention

Potential abuse:

- Fake accounts.
- Spam requests.
- Fake payment claims.
- Fake completion.
- Rating manipulation.
- Non-return of rented items.
- Harassment.
- Repeated cancellations.

Mitigations:

- Verification.
- Rate limiting.
- Transaction history.
- Reputation.
- Reports.
- Admin moderation.
- State validation.
- Suspicious activity indicators.

---

# 49. Privacy

Protect:

- Exact location.
- Phone number.
- Payment details.
- Private chats.
- Verification information.

Rules:

- Collect only required information.
- Use least-privilege access.
- Do not continuously track GPS unnecessarily.
- Do not expose room numbers publicly.
- Protect private files.
- Restrict payment information to appropriate transaction stages.

---

# 50. Database Entities

Recommended entities:

```text
users
institutions
campuses
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

For the current deployment:

- `institution` should represent NIT Patna.
- `campus` should represent Bihta Campus.
- Do not create unnecessary records for unrelated colleges.

---

# 51. Important Database Rules

- Every student belongs to:
  - NIT Patna.
  - Bihta Campus.
- Requests belong to the Bihta Campus.
- Marketplace listings belong to the Bihta Campus.
- Rentals belong to the Bihta Campus.
- Cross-campus access must be prevented at database/backend level.
- Important relationships should use foreign keys.
- Use unique constraints where appropriate.
- Use indexes for frequent queries.
- Store timestamps consistently.

---

# 52. Core Security Requirements

Never trust the mobile client for:

- User role.
- College/campus ownership.
- Reward.
- Payment state.
- Request status.
- Completion.
- Rating ownership.
- Listing ownership.

The backend must validate all of them.

Use:

- Authentication.
- Authorization.
- RLS where applicable.
- Server-side validation.
- Rate limiting.
- Secure storage.
- Secure file access.
- Audit logs for admin actions.

---

# 53. Suggested UI Screens

## Authentication

- Splash.
- Welcome.
- Login.
- Register.
- NIT Patna verification.
- Email verification.
- Bihta Campus location verification.

## Core

- Home.
- Discover.
- Create request.
- Request details.
- My requests.
- My tasks.
- Offers.
- Chat.
- Notifications.
- Profile.

## Marketplace

- Marketplace.
- Listing details.
- Create listing.
- My listings.

## Rentals

- Rentals.
- Rental details.
- Create rental listing.
- Rental request.
- Active rentals.
- Return flow.

## Academic

- Academic requests.
- Tutor profiles.
- Create academic request.

## Payment

- Payment details.
- QR display.
- Payment state.
- Transaction history.

## Trust

- Reviews.
- Ratings.
- Report.
- Dispute.

## Admin

- Dashboard.
- Users.
- Reports.
- Disputes.
- Analytics.
- Bihta Campus configuration.

---

# 54. Recommended MVP

The first polished version should include:

```text
NIT Patna Student Registration
↓
Bihta Campus Verification
  ├── Official Student Email
  └── Campus Geolocation
↓
Profile
↓
Create Request
↓
Bihta Campus Request Feed
↓
Search / Filters
↓
Offer / Accept
↓
Helper Selection
↓
Request Lifecycle
↓
Realtime Notifications
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

---

# 55. Advanced Features

After the MVP is stable:

- Dynamic reward escalation.
- Intelligent helper matching.
- Nearby request ranking.
- Availability preferences.
- Rentals.
- Marketplace.
- Academic help.
- Peer tutoring.
- Admin dashboard.
- Disputes.
- Analytics.
- Favorite helpers.
- Scheduled requests.
- AI request parsing.
- AI reward recommendations.
- Gamification.

---

# 56. AI Future Features

Potential AI features:

### Natural-Language Request Parsing

Input:

```text
Can someone bring me a cold drink from the canteen
within 15 minutes? I will pay ₹40.
```

Extract:

```text
Category: Food Delivery
Item: Cold Drink
Pickup: Canteen
Deadline: 15 minutes
Reward: ₹40
Urgency: High
```

Other possible AI features:

- Request categorization.
- Natural-language search.
- Spam detection.
- Suspicious activity detection.
- Reward recommendations.
- Helper recommendations.
- Admin summaries.

AI must never bypass security or authorization.

---

# 57. Future Expansion

The current project should remain focused on **NIT Patna Bihta Campus**.

Future expansion could support:

- Other NIT Patna campuses/locations.
- Other colleges.
- Multiple universities.
- Inter-campus communities.

However:

> **Do not make multi-college functionality a priority for the current final-semester MVP.**

The goal is to make CampusBuddy excellent for one real campus rather than mediocre for many hypothetical campuses.

---

# 58. Example Complete Food Request

```text
Rahul
↓
Creates request

Bring Cold Drink
Product cost: ₹20
Reward: ₹10
Total: ₹30
Pickup: Campus Canteen
Delivery: Hostel
Deadline: 20 minutes
↓
Nearby Bihta Campus students receive notification
↓
Aman opens request
↓
Aman accepts ₹10
↓
Rahul selects Aman
↓
Request becomes ACCEPTED
↓
Chat opens
↓
Aman buys cold drink
↓
Aman delivers it
↓
Aman marks COMPLETED
↓
Rahul confirms
↓
Payment recorded
↓
Both rate each other
↓
Aman's reputation updates
```

---

# 59. Example Dynamic Reward

```text
Request:
Bring Maggie

11:00 PM
Reward ₹30
↓
No helper
↓
₹40
↓
No helper
↓
₹50
↓
Student accepts
```

The system records the complete reward history.

---

# 60. Example Rental

```text
Aman
↓
Lists Scientific Calculator
₹30/day
Deposit ₹200
↓
Rahul requests
↓
Aman accepts
↓
Reserved
↓
Picked up
↓
Rental Active
↓
Returned
↓
Owner confirms
↓
Deposit handled
↓
Rental Completed
```

---

# 61. Example Academic Request

```text
Rahul
↓
Need DBMS notes
Reward ₹50
Deadline: Tonight
↓
Relevant student receives request
↓
Student accepts
↓
Notes shared
↓
Rahul confirms
↓
Payment
↓
Rating
```

---

# 62. Example Peer Tutoring

```text
Need help with SQL JOINs
30 minutes
Reward ₹100
↓
Tutor responds
↓
Requester selects tutor
↓
Session completed
↓
Payment
↓
Two-way rating
```

---

# 63. Technical Value

CampusBuddy is suitable as a final-semester engineering project because it combines:

- Authentication.
- Student verification.
- Geofencing.
- Geolocation.
- Database design.
- Realtime communication.
- Push notifications.
- Marketplace logic.
- Matching algorithms.
- Request state machines.
- Payment workflows.
- Ratings.
- Reputation.
- File storage.
- Search.
- Security.
- Admin moderation.
- Analytics.

---

# 64. Final-Semester Project Positioning

The project should be presented as:

> **CampusBuddy is a verified, NIT Patna Bihta Campus-restricted peer-to-peer marketplace that enables students to request and provide small services, assistance, rentals, academic resources, and other student-to-student support in exchange for rewards. It combines campus verification, geolocation, realtime requests, matching, communication, transaction tracking, and reputation into a single campus ecosystem.**

---

# 65. Core USP

The main differentiator is:

> **Every verified NIT Patna Bihta Campus student can simultaneously be a customer, helper, seller, renter, borrower, tutor, and resource provider within a trusted campus-only marketplace.**

CampusBuddy transforms the existing student community into a **peer-powered service network** where one student's small need can become another student's small earning opportunity.

---

# 66. Final Project Goal

The final goal is not merely to create an app where students post requests.

The goal is to build a working ecosystem where:

```text
Verified NIT Patna Student
        ↓
Creates a Need
        ↓
CampusBuddy Finds / Shows Suitable Students
        ↓
Another Student Accepts or Offers
        ↓
Requester Selects Helper
        ↓
Task Happens
        ↓
Completion Confirmed
        ↓
Payment
        ↓
Rating
        ↓
Reputation
        ↓
More Trust for Future Transactions
```

The project should be implemented first as a **high-quality, secure, working solution for NIT Patna's Bihta Campus**, with future expansion kept as an architectural possibility rather than an MVP requirement.