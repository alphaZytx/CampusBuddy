/** Domain enumerations shared by the API, the student app and the admin panel. */

export const USER_ROLES = ['STUDENT', 'MODERATOR', 'CAMPUS_ADMIN', 'PLATFORM_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles allowed into the admin panel. */
export const ADMIN_ROLES: readonly UserRole[] = ['MODERATOR', 'CAMPUS_ADMIN', 'PLATFORM_ADMIN'];

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const VERIFICATION_METHODS = ['COLLEGE_EMAIL', 'CAMPUS_LOCATION', 'MANUAL_REVIEW'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'FAILED', 'EXPIRED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const REQUEST_STATUSES = [
  'OPEN',
  'OFFERS_RECEIVED',
  'HELPER_SELECTED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'PAYMENT_PENDING',
  'PAID',
  'RATED',
  'CANCELLED',
  'EXPIRED',
  'HELPER_WITHDREW',
  'DISPUTED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses in which a request is still live and should appear in dashboards as "active". */
export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = [
  'OPEN',
  'OFFERS_RECEIVED',
  'HELPER_SELECTED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
  'PAYMENT_PENDING',
];

/** Statuses in which a request still accepts new offers from helpers. */
export const OFFERABLE_REQUEST_STATUSES: readonly RequestStatus[] = ['OPEN', 'OFFERS_RECEIVED'];

/** Statuses from which nothing further can happen. */
export const TERMINAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'RATED',
  'CANCELLED',
  'EXPIRED',
];

export const OFFER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'WITHDRAWN',
  'EXPIRED',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const URGENCY_LEVELS = ['NORMAL', 'URGENT'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const VISIBILITY_SCOPES = [
  'CAMPUS',
  'NEARBY',
  'HOSTEL',
  'DEPARTMENT',
  'YEAR',
  'FAVOURITES',
] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

export const AVAILABILITY_STATES = ['AVAILABLE_NOW', 'BUSY', 'AVAILABLE_LATER'] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export const PAYMENT_STATUSES = [
  'PAYMENT_PENDING',
  'PAYMENT_INITIATED',
  'PAYMENT_CLAIMED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_DISPUTED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['UPI_QR', 'UPI_ID', 'CASH', 'SIMULATED'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const LISTING_TYPES = ['SELL', 'RENT', 'EXCHANGE', 'GIVEAWAY'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_STATUSES = ['DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'REMOVED'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LOST_FOUND_POST_TYPES = ['LOST', 'FOUND'] as const;
export type LostFoundPostType = (typeof LOST_FOUND_POST_TYPES)[number];

export const LOST_FOUND_STATUSES = ['OPEN', 'MATCHED', 'RETURNED', 'CLOSED', 'EXPIRED'] as const;
export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const LOST_FOUND_CLAIM_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const;
export type LostFoundClaimStatus = (typeof LOST_FOUND_CLAIM_STATUSES)[number];

export const LOST_FOUND_CATEGORIES = [
  'ID_AND_CARDS', 'ELECTRONICS', 'KEYS', 'BOOKS_AND_NOTES', 'BAGS',
  'CLOTHING', 'ACCESSORIES', 'SPORTS', 'OTHER',
] as const;
export type LostFoundCategory = (typeof LOST_FOUND_CATEGORIES)[number];

export const ITEM_CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const RENTAL_ITEM_STATUSES = ['AVAILABLE', 'RESERVED', 'RENTED', 'UNLISTED'] as const;
export type RentalItemStatus = (typeof RENTAL_ITEM_STATUSES)[number];

export const RENTAL_STATUSES = [
  'REQUESTED',
  'RESERVED',
  'RENTED',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
  'CANCELLED',
  'DECLINED',
  'DISPUTED',
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_UNITS = ['HOUR', 'DAY', 'WEEK'] as const;
export type RentalUnit = (typeof RENTAL_UNITS)[number];

export const REPORT_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'DISMISSED',
  'ESCALATED',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TARGET_TYPES = [
  'USER',
  'REQUEST',
  'LISTING',
  'RENTAL_ITEM',
  'MESSAGE',
  'PAYMENT',
  'LOST_FOUND',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const DISPUTE_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_REQUESTER',
  'RESOLVED_HELPER',
  'RESOLVED_SPLIT',
  'DISMISSED',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_SUBJECT_TYPES = ['REQUEST', 'RENTAL', 'LISTING'] as const;
export type DisputeSubjectType = (typeof DISPUTE_SUBJECT_TYPES)[number];

export const RATING_DIRECTIONS = ['REQUESTER_TO_HELPER', 'HELPER_TO_REQUESTER'] as const;
export type RatingDirection = (typeof RATING_DIRECTIONS)[number];

/** Domain events. These drive notifications, realtime pushes and the audit trail. */
export const DOMAIN_EVENTS = [
  'REQUEST_CREATED',
  'REQUEST_UPDATED',
  'REQUEST_CANCELLED',
  'REQUEST_EXPIRED',
  'OFFER_CREATED',
  'OFFER_WITHDRAWN',
  'OFFER_ACCEPTED',
  'OFFER_DECLINED',
  'HELPER_SELECTED',
  'HELPER_WITHDREW',
  'REWARD_CHANGED',
  'TASK_STARTED',
  'TASK_COMPLETED',
  'COMPLETION_CONFIRMED',
  'COMPLETION_REJECTED',
  'PAYMENT_UPDATED',
  'RATING_CREATED',
  'MESSAGE_CREATED',
  'DISPUTE_CREATED',
  'DISPUTE_RESOLVED',
  'RENTAL_REQUESTED',
  'RENTAL_ACCEPTED',
  'RENTAL_STARTED',
  'RENTAL_RETURNED',
  'RENTAL_COMPLETED',
  'REPORT_CREATED',
  'LOST_FOUND_POST_CREATED',
  'LOST_FOUND_POSSIBLE_MATCH',
  'LOST_FOUND_CLAIM_CREATED',
  'LOST_FOUND_CLAIM_UPDATED',
  'LOST_FOUND_RETURNED',
  'LOST_FOUND_EXPIRED',
] as const;
export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

/** Category tree. Seeded into the `categories` table; slugs are the stable identifiers. */
export interface CategoryDefinition {
  slug: string;
  name: string;
  icon: string;
  subcategories: readonly string[];
}

export const CATEGORIES: readonly CategoryDefinition[] = [
  {
    slug: 'quick-delivery',
    name: 'Quick Delivery',
    icon: '🍔',
    subcategories: [
      'Food',
      'Cold Drinks',
      'Chocolates',
      'Snacks',
      'Grocery',
      'Stationery',
      'Printouts',
      'Small Purchase',
    ],
  },
  {
    slug: 'campus-assistance',
    name: 'Campus Assistance',
    icon: '🎒',
    subcategories: [
      'Collection',
      'Delivery',
      'Queue Assistance',
      'Hostel Help',
      'Carrying / Moving',
      'Finding Something',
      'Small Campus Task',
    ],
  },
  {
    slug: 'academic-help',
    name: 'Academic Help',
    icon: '📚',
    subcategories: [
      'Notes',
      'PDFs',
      'Previous Year Questions',
      'Placement Material',
      'Interview Preparation',
      'Study Resources',
      'Topic Explanation',
      'Peer Tutoring',
      'Lab Resources',
    ],
  },
  {
    slug: 'borrow-rent',
    name: 'Borrow / Rent',
    icon: '🔌',
    subcategories: [
      'Scientific Calculator',
      'Laptop Charger',
      'Phone Charger',
      'Power Bank',
      'Cable',
      'HDMI',
      'Books',
      'Camera',
      'Tripod',
      'Speakers',
      'Projector',
      'Sports Equipment',
    ],
  },
  {
    slug: 'technical-help',
    name: 'Technical Help',
    icon: '💻',
    subcategories: [
      'Computer Troubleshooting',
      'Software Setup',
      'Programming Guidance',
      'Project Guidance',
      'Device Setup',
      'Printing / File Help',
    ],
  },
  {
    slug: 'marketplace',
    name: 'Marketplace',
    icon: '🛍️',
    subcategories: ['Buy', 'Sell', 'Rent', 'Borrow', 'Exchange', 'Give Away'],
  },
] as const;

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

export function findCategory(slug: string): CategoryDefinition | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/** Deadline presets offered in the create-request UI. */
export const DEADLINE_PRESETS = [
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '3 hours', minutes: 180 },
  { label: 'Today', minutes: 12 * 60 },
  { label: 'Tomorrow', minutes: 24 * 60 },
] as const;

export const BADGES = [
  { slug: 'first-task', name: 'First Task', description: 'Completed your first task', threshold: 1 },
  { slug: 'ten-tasks', name: '10 Tasks', description: 'Completed 10 tasks', threshold: 10 },
  { slug: 'fifty-tasks', name: '50 Tasks', description: 'Completed 50 tasks', threshold: 50 },
  { slug: 'century', name: '100 Tasks', description: 'Completed 100 tasks', threshold: 100 },
] as const;
