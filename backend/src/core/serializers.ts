import type {
  Attachment,
  Message,
  Notification,
  Payment,
  PublicUser,
  Rating,
  RequestOffer,
  SelfUser,
} from '@campusbuddy/shared';
import { fuzzCoordinate } from '@campusbuddy/shared';
import { signAttachmentUrl, signedUrlOrNull } from './signed-urls.js';

/**
 * Row → DTO mapping.
 *
 * This is where privacy decisions are made concrete (spec §23, §49): exact
 * coordinates, phone numbers and UPI details are only ever attached to a response
 * when the viewer is entitled to them, and the rule lives in one place rather than
 * being re-decided in every route.
 */

const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

/** Coerce whatever the driver returned for a jsonb column into an object. */
export function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export interface PublicUserRow {
  id: string;
  full_name: string;
  avatar_attachment_id: string | null;
  bio?: string | null;
  department_code: string | null;
  department_name: string | null;
  year_of_study: number | null;
  is_verified: boolean;
  verification_method: PublicUser['verificationMethod'];
  average_rating: number | string;
  rating_count: number;
  completed_tasks: number;
  completion_rate: number | string;
  cancellation_rate: number | string;
  response_rate: number | string;
  reliability_score: number;
  tier: PublicUser['tier'];
  availability: PublicUser['availability'];
  skills: string[] | null;
  badges: string[] | null;
  member_since: Date | string;
}

export function toPublicUser(row: PublicUserRow): PublicUser {
  return {
    id: row.id,
    fullName: row.full_name,
    // A signed link, because an <img> tag cannot present a bearer token.
    avatarUrl: signedUrlOrNull(row.avatar_attachment_id),
    departmentCode: row.department_code,
    departmentName: row.department_name,
    yearOfStudy: row.year_of_study,
    isVerified: row.is_verified,
    verificationMethod: row.verification_method,
    averageRating: num(row.average_rating),
    ratingCount: num(row.rating_count),
    completedTasks: num(row.completed_tasks),
    completionRate: num(row.completion_rate),
    cancellationRate: num(row.cancellation_rate),
    responseRate: num(row.response_rate),
    reliabilityScore: num(row.reliability_score),
    tier: row.tier,
    availability: row.availability,
    skills: row.skills ?? [],
    badges: row.badges ?? [],
    memberSince: iso(row.member_since),
  };
}

/** Parses a `to_jsonb(public_user_profiles)` column into a PublicUser. */
export function toPublicUserFromJson(value: unknown): PublicUser | null {
  const parsed = asJson<PublicUserRow | null>(value, null);
  return parsed ? toPublicUser(parsed) : null;
}

export interface SelfUserRow extends PublicUserRow {
  email: string;
  phone: string | null;
  role: SelfUser['role'];
  account_status: SelfUser['accountStatus'];
  campus_id: string;
  department_id: string | null;
  hostel_id: string | null;
  hostel_name: string | null;
  upi_id: string | null;
  upi_qr_attachment_id: string | null;
  preferred_categories: string[] | null;
  min_reward_paise: number | string;
  max_distance_metres: number | string;
  total_earned_paise: number | string;
  pending_earnings_paise?: number | string;
  notification_preferences?: unknown;
}

export function toSelfUser(row: SelfUserRow): SelfUser {
  const notif = asJson<Record<string, unknown>>(row.notification_preferences, {});
  return {
    ...toPublicUser(row),
    email: row.email,
    phone: row.phone,
    role: row.role,
    accountStatus: row.account_status,
    campusId: row.campus_id,
    departmentId: row.department_id,
    hostelId: row.hostel_id,
    hostelName: row.hostel_name,
    upiId: row.upi_id,
    upiQrUrl: signedUrlOrNull(row.upi_qr_attachment_id),
    preferredCategories: row.preferred_categories ?? [],
    minRewardPaise: num(row.min_reward_paise),
    maxDistanceMetres: num(row.max_distance_metres),
    totalEarnedPaise: num(row.total_earned_paise),
    pendingEarningsPaise: num(row.pending_earnings_paise ?? 0),
    notificationPreferences: {
      newMatchingRequests: notif.new_matching_requests !== false,
      offers: notif.offers !== false,
      chat: notif.chat !== false,
      payments: notif.payments !== false,
      ratings: notif.ratings !== false,
      rentals: notif.rentals !== false,
      reminders: notif.reminders !== false,
      lostFound: notif.lost_found !== false,
      minRewardPaise: num(notif.min_reward_paise ?? 0),
      maxDistanceMetres: num(notif.max_distance_metres ?? 2000),
      urgentOnly: notif.urgent_only === true,
      quietHoursStart: notif.quiet_hours_start === null || notif.quiet_hours_start === undefined
        ? null
        : num(notif.quiet_hours_start),
      quietHoursEnd: notif.quiet_hours_end === null || notif.quiet_hours_end === undefined
        ? null
        : num(notif.quiet_hours_end),
    },
  };
}

export interface AttachmentRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | string;
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    // Signed, so an <img> or a download link works without a bearer token. A row
    // only reaches this point when the viewer's RLS let them see the file at all.
    url: signAttachmentUrl(row.id),
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: num(row.size_bytes),
  };
}

export function toAttachmentFromJson(value: unknown): Attachment | null {
  const parsed = asJson<AttachmentRow | null>(value, null);
  return parsed && parsed.id ? toAttachment(parsed) : null;
}

export function toAttachmentsFromJson(value: unknown): Attachment[] {
  const parsed = asJson<AttachmentRow[]>(value, []);
  return Array.isArray(parsed) ? parsed.filter((a) => a && a.id).map(toAttachment) : [];
}

export interface OfferRow {
  id: string;
  request_id: string;
  helper: unknown;
  offered_reward_paise: number | string;
  message: string | null;
  status: RequestOffer['status'];
  eta_minutes: number | null;
  distance_metres: number | string | null;
  match_score: number | string | null;
  created_at: Date | string;
}

export function toOffer(row: OfferRow): RequestOffer {
  const helper = toPublicUserFromJson(row.helper);
  if (!helper) throw new Error('Offer row is missing its helper profile');
  return {
    id: row.id,
    requestId: row.request_id,
    helper,
    offeredRewardPaise: num(row.offered_reward_paise),
    message: row.message,
    status: row.status,
    etaMinutes: row.eta_minutes,
    distanceMetres: row.distance_metres === null ? null : num(row.distance_metres),
    matchScore: row.match_score === null ? null : num(row.match_score),
    createdAt: iso(row.created_at),
  };
}

export interface PaymentRow {
  id: string;
  request_id: string | null;
  rental_id: string | null;
  payer_id: string;
  payee_id: string;
  amount_paise: number | string;
  method: Payment['method'];
  status: Payment['status'];
  reference_note: string | null;
  transaction_reference?: string | null;
  expires_at?: Date | string | null;
  receipt_attachment?: unknown;
  claimed_at: Date | string | null;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  payee_upi_id?: string | null;
  payee_upi_qr_attachment_id?: string | null;
  payee_name?: string | null;
}

/**
 * Builds a UPI deep link (`upi://pay?...`).
 *
 * This only *opens* the payer's UPI app with the fields pre-filled. CampusBuddy has
 * no visibility into whether the transfer succeeds — which is exactly why the payee
 * must confirm receipt before a payment is treated as complete.
 */
export function buildUpiUri(
  vpa: string | null | undefined,
  payeeName: string | null | undefined,
  amountPaise: number,
  note: string,
): string | null {
  if (!vpa) return null;
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName ?? 'CampusBuddy student',
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: note.slice(0, 50),
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * Payment details are only revealed to the two parties, and the payee's UPI handle
 * only to the person who actually has to pay them (spec §49).
 */
export function toPayment(
  row: PaymentRow,
  viewerId: string,
  availableActions: string[] = [],
): Payment {
  const amount = num(row.amount_paise);
  const isPayer = row.payer_id === viewerId;
  const showPayeeDetails = isPayer && row.status !== 'PAYMENT_CONFIRMED';

  return {
    id: row.id,
    requestId: row.request_id,
    rentalId: row.rental_id,
    payerId: row.payer_id,
    payeeId: row.payee_id,
    amountPaise: amount,
    method: row.method,
    status: row.status,
    payeeUpiId: showPayeeDetails ? (row.payee_upi_id ?? null) : null,
    payeeUpiQrUrl: showPayeeDetails ? signedUrlOrNull(row.payee_upi_qr_attachment_id) : null,
    upiUri: showPayeeDetails
      ? buildUpiUri(row.payee_upi_id, row.payee_name, amount, `CampusBuddy ${row.id.slice(0, 8)}`)
      : null,
    referenceNote: row.reference_note,
    transactionReference: row.transaction_reference ?? null,
    receipt: toAttachmentFromJson(row.receipt_attachment),
    expiresAt: isoOrNull(row.expires_at),
    claimedAt: isoOrNull(row.claimed_at),
    confirmedAt: isoOrNull(row.confirmed_at),
    createdAt: iso(row.created_at),
    availableActions,
  };
}

export interface RatingRow {
  id: string;
  request_id: string | null;
  rental_id: string | null;
  rater: unknown;
  ratee_id: string;
  direction: Rating['direction'];
  stars: number;
  punctuality: number | null;
  reliability: number | null;
  communication: number | null;
  quality: number | null;
  clear_instructions: number | null;
  payment_reliability: number | null;
  respectfulness: number | null;
  review: string | null;
  created_at: Date | string;
}

export function toRating(row: RatingRow): Rating {
  const rater = toPublicUserFromJson(row.rater);
  if (!rater) throw new Error('Rating row is missing its rater profile');
  return {
    id: row.id,
    requestId: row.request_id,
    rentalId: row.rental_id,
    rater,
    rateeId: row.ratee_id,
    direction: row.direction,
    stars: num(row.stars),
    punctuality: row.punctuality,
    reliability: row.reliability,
    communication: row.communication,
    quality: row.quality,
    clearInstructions: row.clear_instructions,
    paymentReliability: row.payment_reliability,
    respectfulness: row.respectfulness,
    review: row.review,
    createdAt: iso(row.created_at),
  };
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender: unknown;
  body: string | null;
  attachment: unknown;
  shared_lat: number | null;
  shared_lng: number | null;
  created_at: Date | string;
  read_at?: Date | string | null;
}

export function toMessage(row: MessageRow): Message {
  const sender = toPublicUserFromJson(row.sender);
  if (!sender) throw new Error('Message row is missing its sender profile');
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender,
    body: row.body,
    attachment: toAttachmentFromJson(row.attachment),
    sharedLat: row.shared_lat,
    sharedLng: row.shared_lng,
    createdAt: iso(row.created_at),
    readAt: isoOrNull(row.read_at ?? null),
  };
}

export interface NotificationRow {
  id: string;
  type: Notification['type'];
  title: string;
  body: string;
  data: unknown;
  read_at: Date | string | null;
  created_at: Date | string;
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: asJson<Record<string, unknown>>(row.data, {}),
    readAt: isoOrNull(row.read_at),
    createdAt: iso(row.created_at),
  };
}

/** Public coordinates are coarsened to a ~110 m grid before they leave the server. */
export function publicCoordinates(
  lat: number | null,
  lng: number | null,
): { lat: number | null; lng: number | null } {
  if (lat === null || lng === null) return { lat: null, lng: null };
  const fuzzed = fuzzCoordinate({ lat, lng });
  return { lat: fuzzed.lat, lng: fuzzed.lng };
}

export { iso as toIso, isoOrNull as toIsoOrNull, num as toNumber };
