import type { HelpRequest, RequestStatus } from '@campusbuddy/shared';
import {
  ACTIVE_REQUEST_STATUSES,
  nextRequestStatuses,
  OFFERABLE_REQUEST_STATUSES,
  type Actor,
} from '@campusbuddy/shared';
import {
  asJson,
  publicCoordinates,
  toAttachmentFromJson,
  toAttachmentsFromJson,
  toIso,
  toIsoOrNull,
  toNumber,
  toOffer,
  toPayment,
  toPublicUserFromJson,
  type OfferRow,
  type PaymentRow,
} from '../../core/serializers.js';

/** A row produced by `REQUEST_SELECT`. */
export interface RequestRow {
  id: string;
  campus_id: string;
  title: string;
  description: string;
  category_slug: string;
  subcategory: string | null;
  reward_paise: number | string;
  product_cost_paise: number | string;
  total_budget_paise: number | string;
  max_reward_paise: number | string | null;
  auto_escalate: boolean;
  pickup_label: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  delivery_label: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  exact_lat: number | null;
  exact_lng: number | null;
  approx_lat: number | null;
  approx_lng: number | null;
  deadline_at: Date | string | null;
  scheduled_for: Date | string | null;
  urgency: HelpRequest['urgency'];
  visibility: HelpRequest['visibility'];
  status: RequestStatus;
  requester_id: string;
  selected_helper_id: string | null;
  offer_count: number | string;
  completion_note: string | null;
  cancellation_reason: string | null;
  rejection_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  confirmed_at: Date | string | null;
  requester: unknown;
  selected_helper: unknown;
  distance_metres: number | string | null;
  my_offer: unknown;
  payment: unknown;
  attachments: unknown;
  completion_proof: unknown;
  my_rating_submitted: boolean;
}

/** Which side of the transaction the viewer is on. Decides both privacy and actions. */
export function actorFor(row: RequestRow, viewerId: string, isStaff: boolean): Actor | null {
  if (row.requester_id === viewerId) return 'REQUESTER';
  if (row.selected_helper_id === viewerId) return 'HELPER';
  if (isStaff) return 'ADMIN';
  return null;
}

/**
 * Everything the viewer may do with this request right now.
 *
 * Derived from the same state machine the server enforces, so a button is never
 * shown for an action that would be rejected — and never hidden for one that is
 * genuinely available (spec §106).
 */
export function availableActionsFor(
  row: RequestRow,
  viewerId: string,
  isStaff: boolean,
  hasMyOffer: boolean,
  myOfferStatus: string | null,
): string[] {
  const actor = actorFor(row, viewerId, isStaff);
  const actions = new Set<string>();

  if (actor) {
    // Transitions the machine permits for this actor from the current status.
    for (const next of nextRequestStatuses(row.status, actor)) {
      const transition = TRANSITION_ACTION_LOOKUP[`${row.status}->${next}`];
      if (transition) actions.add(transition);
    }
  }

  if (actor === 'REQUESTER') {
    if (OFFERABLE_REQUEST_STATUSES.includes(row.status)) {
      actions.add('increase_reward');
      if (Number(row.offer_count) > 0) actions.add('view_offers');
      actions.add('edit');
    }
    if (row.status === 'PAYMENT_PENDING') actions.add('pay');
  }

  if (actor === 'HELPER' && row.status === 'PAYMENT_PENDING') {
    actions.add('await_payment');
  }

  // Anyone else on campus may offer, provided the request is still taking offers.
  if (!actor && OFFERABLE_REQUEST_STATUSES.includes(row.status)) {
    if (hasMyOffer && myOfferStatus === 'PENDING') actions.add('withdraw_offer');
    // A withdrawn offer can be renewed, and so can one that was passed over before
    // the request reopened because the chosen helper backed out.
    else if (!hasMyOffer || ['WITHDRAWN', 'DECLINED', 'EXPIRED'].includes(myOfferStatus ?? '')) {
      actions.add('make_offer');
    }
  }

  // Chat opens once a helper is committed, and only for the two participants.
  if (
    (actor === 'REQUESTER' || actor === 'HELPER') &&
    !['OPEN', 'OFFERS_RECEIVED'].includes(row.status)
  ) {
    actions.add('open_chat');
  }

  // Rating unlocks after payment is settled, once each.
  if ((actor === 'REQUESTER' || actor === 'HELPER') && ['PAID', 'RATED'].includes(row.status)) {
    if (!row.my_rating_submitted) actions.add('rate');
  }

  if (actor && ACTIVE_REQUEST_STATUSES.includes(row.status)) actions.add('report');

  return [...actions];
}

/** Maps a `from->to` status pair to the action name the API accepts. */
const TRANSITION_ACTION_LOOKUP: Record<string, string> = {
  'OFFERS_RECEIVED->HELPER_SELECTED': 'select_helper',
  'HELPER_SELECTED->ACCEPTED': 'accept',
  'HELPER_SELECTED->OPEN': 'decline_selection',
  'ACCEPTED->IN_PROGRESS': 'start',
  'ACCEPTED->HELPER_WITHDREW': 'withdraw',
  'IN_PROGRESS->HELPER_WITHDREW': 'withdraw',
  'IN_PROGRESS->COMPLETED': 'complete',
  'IN_PROGRESS->DISPUTED': 'open_dispute',
  'COMPLETED->PAYMENT_PENDING': 'confirm_completion',
  'COMPLETED->REJECTED': 'reject_completion',
  'REJECTED->IN_PROGRESS': 'resume',
  'REJECTED->DISPUTED': 'open_dispute',
  'PAYMENT_PENDING->DISPUTED': 'open_dispute',
  'PAID->DISPUTED': 'open_dispute',
  'HELPER_WITHDREW->OPEN': 'reopen',
  'OPEN->CANCELLED': 'cancel',
  'OFFERS_RECEIVED->CANCELLED': 'cancel',
  'HELPER_SELECTED->CANCELLED': 'cancel',
  'ACCEPTED->CANCELLED': 'cancel',
  'IN_PROGRESS->CANCELLED': 'cancel',
};

export function toHelpRequest(
  row: RequestRow,
  viewerId: string,
  options: { isStaff?: boolean } = {},
): HelpRequest {
  const isStaff = options.isStaff ?? false;
  const actor = actorFor(row, viewerId, isStaff);
  // Exact coordinates are for the two participants only; everyone else sees the
  // coarsened position (spec §23).
  const isParticipant = actor === 'REQUESTER' || actor === 'HELPER';
  const approx = publicCoordinates(row.approx_lat, row.approx_lng);

  const myOfferRow = asJson<OfferRow | null>(row.my_offer, null);
  const myOffer = myOfferRow && myOfferRow.id ? toOffer(myOfferRow) : null;

  const paymentRow = asJson<PaymentRow | null>(row.payment, null);
  const payment = paymentRow && paymentRow.id ? toPayment(paymentRow, viewerId) : null;

  const requester = toPublicUserFromJson(row.requester);
  if (!requester) throw new Error('Request row is missing its requester profile');

  return {
    id: row.id,
    campusId: row.campus_id,
    requester,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    subcategory: row.subcategory,
    rewardPaise: toNumber(row.reward_paise),
    productCostPaise: toNumber(row.product_cost_paise),
    totalBudgetPaise: toNumber(row.total_budget_paise),
    maxRewardPaise: row.max_reward_paise === null ? null : toNumber(row.max_reward_paise),
    autoEscalate: row.auto_escalate,
    pickupLocation: row.pickup_label
      ? { label: row.pickup_label, lat: row.pickup_lat, lng: row.pickup_lng }
      : null,
    deliveryLocation: row.delivery_label
      ? { label: row.delivery_label, lat: row.delivery_lat, lng: row.delivery_lng }
      : null,
    approximateLat: approx.lat,
    approximateLng: approx.lng,
    exactLat: isParticipant ? row.exact_lat : null,
    exactLng: isParticipant ? row.exact_lng : null,
    distanceMetres: row.distance_metres === null ? null : toNumber(row.distance_metres),
    deadlineAt: toIsoOrNull(row.deadline_at),
    scheduledFor: toIsoOrNull(row.scheduled_for),
    urgency: row.urgency,
    visibility: row.visibility,
    status: row.status,
    selectedHelper: toPublicUserFromJson(row.selected_helper),
    offerCount: toNumber(row.offer_count),
    myOffer,
    attachments: toAttachmentsFromJson(row.attachments),
    completionNote: row.completion_note,
    // Signed like every other file link, so the requester can actually open it.
    completionProofUrl: toAttachmentFromJson(row.completion_proof)?.url ?? null,
    cancellationReason: row.cancellation_reason,
    payment,
    myRatingSubmitted: row.my_rating_submitted,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: toIsoOrNull(row.completed_at),
    availableActions: availableActionsFor(
      row,
      viewerId,
      isStaff,
      myOffer !== null,
      myOffer?.status ?? null,
    ),
  };
}
