import type {
  AccountStatus,
  AvailabilityState,
  DisputeStatus,
  DisputeSubjectType,
  DomainEvent,
  ItemCondition,
  ListingStatus,
  ListingType,
  LostFoundCategory,
  LostFoundClaimStatus,
  LostFoundPostType,
  LostFoundStatus,
  OfferStatus,
  PaymentMethod,
  PaymentStatus,
  RatingDirection,
  RentalItemStatus,
  RentalStatus,
  RentalUnit,
  ReportStatus,
  ReportTargetType,
  RequestStatus,
  UrgencyLevel,
  UserRole,
  VerificationMethod,
  VisibilityScope,
} from './constants.js';

/** Timestamps cross the wire as ISO-8601 UTC strings and are localised in the UI. */
export type IsoDateString = string;

export interface Campus {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  city: string;
  centreLat: number;
  centreLng: number;
  geofenceRadiusMetres: number;
  emailDomains: string[];
}

export interface Department {
  id: string;
  campusId: string;
  code: string;
  name: string;
}

export interface Hostel {
  id: string;
  campusId: string;
  name: string;
}

/** The public face of a student — safe to show to any other verified student on campus. */
export interface PublicUser {
  id: string;
  fullName: string;
  /** Short-lived signed link to the profile photo, or null for initials. */
  avatarUrl: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  yearOfStudy: number | null;
  isVerified: boolean;
  verificationMethod: VerificationMethod | null;
  averageRating: number;
  ratingCount: number;
  completedTasks: number;
  completionRate: number;
  cancellationRate: number;
  responseRate: number;
  reliabilityScore: number;
  tier: 'NEW' | 'BRONZE' | 'SILVER' | 'GOLD';
  availability: AvailabilityState;
  skills: string[];
  badges: string[];
  memberSince: IsoDateString;
}

/** Everything the signed-in student may see about themselves, including private fields. */
export interface SelfUser extends PublicUser {
  email: string;
  phone: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  campusId: string;
  departmentId: string | null;
  hostelId: string | null;
  hostelName: string | null;
  upiId: string | null;
  /** Short-lived signed link to the student's own payment QR code. */
  upiQrUrl: string | null;
  preferredCategories: string[];
  minRewardPaise: number;
  maxDistanceMetres: number;
  notificationPreferences: NotificationPreferences;
  totalEarnedPaise: number;
  pendingEarningsPaise: number;
}

export interface NotificationPreferences {
  newMatchingRequests: boolean;
  offers: boolean;
  chat: boolean;
  payments: boolean;
  ratings: boolean;
  rentals: boolean;
  reminders: boolean;
  lostFound: boolean;
  minRewardPaise: number;
  maxDistanceMetres: number;
  urgentOnly: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export interface RequestLocation {
  label: string;
  lat: number | null;
  lng: number | null;
}

export interface HelpRequest {
  id: string;
  campusId: string;
  requester: PublicUser;
  title: string;
  description: string;
  categorySlug: string;
  subcategory: string | null;
  rewardPaise: number;
  productCostPaise: number;
  totalBudgetPaise: number;
  maxRewardPaise: number | null;
  autoEscalate: boolean;
  pickupLocation: RequestLocation | null;
  deliveryLocation: RequestLocation | null;
  /** Coarsened to ~110 m for anyone who is not a participant. */
  approximateLat: number | null;
  approximateLng: number | null;
  /** Present only for the requester and the selected helper. */
  exactLat: number | null;
  exactLng: number | null;
  distanceMetres: number | null;
  deadlineAt: IsoDateString | null;
  scheduledFor: IsoDateString | null;
  urgency: UrgencyLevel;
  visibility: VisibilityScope;
  status: RequestStatus;
  selectedHelper: PublicUser | null;
  offerCount: number;
  /** The viewer's own offer on this request, when they have made one. */
  myOffer: RequestOffer | null;
  attachments: Attachment[];
  completionNote: string | null;
  completionProofUrl: string | null;
  cancellationReason: string | null;
  payment: Payment | null;
  myRatingSubmitted: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  completedAt: IsoDateString | null;
  /** Actions the viewer may take right now, derived server-side from the state machine. */
  availableActions: string[];
}

export interface RequestOffer {
  id: string;
  requestId: string;
  helper: PublicUser;
  offeredRewardPaise: number;
  message: string | null;
  status: OfferStatus;
  etaMinutes: number | null;
  distanceMetres: number | null;
  matchScore: number | null;
  createdAt: IsoDateString;
}

export interface RewardChange {
  id: string;
  requestId: string;
  fromPaise: number;
  toPaise: number;
  reason: 'MANUAL' | 'AUTO_ESCALATION';
  createdAt: IsoDateString;
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  action: string;
  actorRole: string;
  actorId: string | null;
  note: string | null;
  createdAt: IsoDateString;
}

export interface Attachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}

export interface Conversation {
  id: string;
  requestId: string | null;
  rentalId: string | null;
  subject: string;
  participants: PublicUser[];
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: IsoDateString;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: PublicUser;
  body: string | null;
  attachment: Attachment | null;
  sharedLat: number | null;
  sharedLng: number | null;
  createdAt: IsoDateString;
  readAt: IsoDateString | null;
}

export interface Payment {
  id: string;
  requestId: string | null;
  rentalId: string | null;
  payerId: string;
  payeeId: string;
  amountPaise: number;
  method: PaymentMethod;
  status: PaymentStatus;
  /** UPI deep link built from the payee's VPA — the app never touches money itself. */
  upiUri: string | null;
  payeeUpiId: string | null;
  payeeUpiQrUrl: string | null;
  referenceNote: string | null;
  transactionReference: string | null;
  receipt: Attachment | null;
  expiresAt: IsoDateString | null;
  claimedAt: IsoDateString | null;
  confirmedAt: IsoDateString | null;
  createdAt: IsoDateString;
  availableActions: string[];
}

export interface SafetyControl {
  user: PublicUser;
  blocked: boolean;
  muted: boolean;
  reason: string | null;
  updatedAt: IsoDateString;
}

export interface LegalDocument {
  documentType: 'PRIVACY' | 'TERMS' | 'COMMUNITY';
  version: string;
  title: string;
  content: string;
  effectiveAt: IsoDateString;
  acceptedAt: IsoDateString | null;
}

export interface ModerationAction {
  id: string;
  actionType: 'WARNING' | 'STRIKE' | 'SUSPENSION' | 'RESTRICTION' | 'NOTE';
  reason: string;
  points: number;
  expiresAt: IsoDateString | null;
  createdAt: IsoDateString;
  appealed: boolean;
}

export interface Rating {
  id: string;
  requestId: string | null;
  rentalId: string | null;
  rater: PublicUser;
  rateeId: string;
  direction: RatingDirection;
  stars: number;
  punctuality: number | null;
  reliability: number | null;
  communication: number | null;
  quality: number | null;
  clearInstructions: number | null;
  paymentReliability: number | null;
  respectfulness: number | null;
  review: string | null;
  createdAt: IsoDateString;
}

export interface Listing {
  id: string;
  campusId: string;
  seller: PublicUser;
  title: string;
  description: string;
  categorySlug: string;
  listingType: ListingType;
  pricePaise: number;
  condition: ItemCondition;
  status: ListingStatus;
  pickupZone: string | null;
  images: Attachment[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface LostFoundClaim {
  id: string;
  postId: string;
  claimant: PublicUser;
  message: string;
  verificationAnswer: string;
  status: LostFoundClaimStatus;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface LostFoundPost {
  id: string;
  campusId: string;
  author: PublicUser;
  postType: LostFoundPostType;
  title: string;
  description: string;
  category: LostFoundCategory;
  color: string | null;
  brand: string | null;
  approximateLocation: string;
  occurredAt: IsoDateString;
  verificationQuestion: string | null;
  status: LostFoundStatus;
  expiresAt: IsoDateString;
  images: Attachment[];
  myClaim: LostFoundClaim | null;
  claims: LostFoundClaim[];
  possibleMatches: LostFoundPost[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  availableActions: string[];
}

export interface RentalItem {
  id: string;
  campusId: string;
  owner: PublicUser;
  name: string;
  description: string;
  categorySlug: string;
  condition: ItemCondition;
  pricePaise: number;
  rentalUnit: RentalUnit;
  depositPaise: number;
  status: RentalItemStatus;
  pickupZone: string | null;
  rules: string | null;
  images: Attachment[];
  createdAt: IsoDateString;
}

export interface Rental {
  id: string;
  item: RentalItem;
  renter: PublicUser;
  owner: PublicUser;
  status: RentalStatus;
  startAt: IsoDateString | null;
  expectedReturnAt: IsoDateString;
  actualReturnAt: IsoDateString | null;
  units: number;
  rentalFeePaise: number;
  depositPaise: number;
  depositReturnedPaise: number | null;
  damageNote: string | null;
  payment: Payment | null;
  createdAt: IsoDateString;
  availableActions: string[];
}

export interface Notification {
  id: string;
  type: DomainEvent;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: IsoDateString | null;
  createdAt: IsoDateString;
}

export interface Report {
  id: string;
  reporter: PublicUser | null;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  description: string | null;
  status: ReportStatus;
  resolution: string | null;
  createdAt: IsoDateString;
}

export interface Dispute {
  id: string;
  subjectType: DisputeSubjectType;
  subjectId: string;
  openedBy: PublicUser;
  against: PublicUser | null;
  reason: string;
  description: string;
  status: DisputeStatus;
  resolution: string | null;
  evidence: DisputeEvidence[];
  createdAt: IsoDateString;
  resolvedAt: IsoDateString | null;
}

export interface DisputeEvidence {
  id: string;
  submittedBy: PublicUser;
  note: string | null;
  attachment: Attachment | null;
  createdAt: IsoDateString;
}

export interface Paginated<T> {
  items: T[];
  /** Opaque cursor for the next page; null when the list is exhausted. */
  nextCursor: string | null;
  total: number | null;
}

/** Envelope for every realtime frame pushed over the WebSocket. */
export interface RealtimeEvent<T = unknown> {
  event: DomainEvent | 'CONNECTED' | 'PONG' | 'SUBSCRIBED';
  channel: string;
  payload: T;
  at: IsoDateString;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSession extends AuthTokens {
  user: SelfUser;
}

export interface EarningsSummary {
  totalEarnedPaise: number;
  pendingPaise: number;
  completedTasks: number;
  averageRewardPaise: number;
  thisMonthPaise: number;
  byMonth: { month: string; earnedPaise: number; tasks: number }[];
}

export interface PlatformAnalytics {
  registeredStudents: number;
  verifiedStudents: number;
  activeUsers7d: number;
  requestsCreated: number;
  requestsCompleted: number;
  completionRate: number;
  averageRewardPaise: number;
  averageCompletionMinutes: number | null;
  cancellationRate: number;
  disputeRate: number;
  openReports: number;
  openDisputes: number;
  popularCategories: { categorySlug: string; count: number }[];
  rentalsActive: number;
  rentalsCompleted: number;
  requestsByDay: { day: string; count: number }[];
}
