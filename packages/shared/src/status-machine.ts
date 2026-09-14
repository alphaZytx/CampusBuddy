import type { RequestStatus, RentalStatus, PaymentStatus } from './constants.js';

/**
 * Who is attempting a transition. The server derives this from the authenticated
 * session and the row being modified — it is never taken from the request body.
 */
export type Actor = 'REQUESTER' | 'HELPER' | 'SYSTEM' | 'ADMIN';

export interface Transition<TStatus extends string> {
  from: TStatus;
  to: TStatus;
  /** Stable action name used by the API and recorded in status history. */
  action: string;
  /** Actors permitted to perform this transition. */
  actors: readonly Actor[];
  description: string;
}

/**
 * The canonical CampusBuddy request lifecycle.
 *
 *   OPEN → OFFERS_RECEIVED → HELPER_SELECTED → ACCEPTED → IN_PROGRESS
 *        → COMPLETED → PAYMENT_PENDING → PAID → RATED
 *
 * Every write path that changes `requests.status` goes through `assertRequestTransition`,
 * so a client can never invent a status or skip a step.
 */
export const REQUEST_TRANSITIONS: readonly Transition<RequestStatus>[] = [
  // --- Discovery ---------------------------------------------------------
  {
    from: 'OPEN',
    to: 'OFFERS_RECEIVED',
    action: 'offer_received',
    actors: ['SYSTEM'],
    description: 'First helper offer arrived',
  },
  {
    from: 'OFFERS_RECEIVED',
    to: 'OPEN',
    action: 'all_offers_withdrawn',
    actors: ['SYSTEM'],
    description: 'Every pending offer was withdrawn, so the request is open again',
  },

  // --- Selection ---------------------------------------------------------
  {
    from: 'OFFERS_RECEIVED',
    to: 'HELPER_SELECTED',
    action: 'select_helper',
    actors: ['REQUESTER'],
    description: 'Requester picked one helper; all other offers are declined',
  },
  {
    from: 'HELPER_SELECTED',
    to: 'ACCEPTED',
    action: 'helper_accept',
    actors: ['HELPER'],
    description: 'Selected helper confirmed they will do the task',
  },
  {
    from: 'HELPER_SELECTED',
    to: 'OPEN',
    action: 'helper_decline_selection',
    actors: ['HELPER'],
    description: 'Selected helper backed out before accepting; request reopens',
  },

  // --- Execution ---------------------------------------------------------
  {
    from: 'ACCEPTED',
    to: 'IN_PROGRESS',
    action: 'start_task',
    actors: ['HELPER'],
    description: 'Helper started working on the task',
  },
  {
    from: 'ACCEPTED',
    to: 'HELPER_WITHDREW',
    action: 'helper_withdraw',
    actors: ['HELPER'],
    description: 'Helper withdrew after accepting',
  },
  {
    from: 'IN_PROGRESS',
    to: 'HELPER_WITHDREW',
    action: 'helper_withdraw',
    actors: ['HELPER'],
    description: 'Helper withdrew mid-task; counts against their reliability',
  },
  {
    from: 'HELPER_WITHDREW',
    to: 'OPEN',
    action: 'reopen',
    actors: ['REQUESTER', 'SYSTEM'],
    description: 'Requester reopened the request to find another helper',
  },
  {
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    action: 'mark_completed',
    actors: ['HELPER'],
    description: 'Helper marked the task finished; awaiting requester confirmation',
  },

  // --- Confirmation ------------------------------------------------------
  {
    from: 'COMPLETED',
    to: 'PAYMENT_PENDING',
    action: 'confirm_completion',
    actors: ['REQUESTER'],
    description: 'Requester confirmed the work was done; payment is now due',
  },
  {
    from: 'COMPLETED',
    to: 'REJECTED',
    action: 'reject_completion',
    actors: ['REQUESTER'],
    description: 'Requester says the task was not actually completed',
  },
  {
    from: 'REJECTED',
    to: 'IN_PROGRESS',
    action: 'resume_task',
    actors: ['HELPER'],
    description: 'Helper is retrying after a rejected completion',
  },
  {
    from: 'REJECTED',
    to: 'DISPUTED',
    action: 'open_dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'Disagreement escalated to a dispute',
  },

  // --- Payment -----------------------------------------------------------
  {
    from: 'PAYMENT_PENDING',
    to: 'PAID',
    action: 'payment_confirmed',
    actors: ['SYSTEM'],
    description: 'Both sides confirmed the UPI transfer',
  },
  {
    from: 'PAYMENT_PENDING',
    to: 'DISPUTED',
    action: 'open_dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'Payment disagreement escalated to a dispute',
  },

  // --- Rating ------------------------------------------------------------
  {
    from: 'PAID',
    to: 'RATED',
    action: 'both_rated',
    actors: ['SYSTEM'],
    description: 'Both participants submitted their rating',
  },
  {
    from: 'PAID',
    to: 'DISPUTED',
    action: 'open_dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'A problem surfaced after payment',
  },

  // --- Cancellation & expiry --------------------------------------------
  {
    from: 'OPEN',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['REQUESTER', 'ADMIN'],
    description: 'Requester cancelled before any commitment',
  },
  {
    from: 'OFFERS_RECEIVED',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['REQUESTER', 'ADMIN'],
    description: 'Requester cancelled while offers were pending',
  },
  {
    from: 'HELPER_SELECTED',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['REQUESTER', 'ADMIN'],
    description: 'Requester cancelled after selecting a helper',
  },
  {
    from: 'ACCEPTED',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['REQUESTER', 'ADMIN'],
    description: 'Requester cancelled after the helper accepted',
  },
  {
    from: 'IN_PROGRESS',
    to: 'CANCELLED',
    action: 'cancel',
    actors: ['ADMIN'],
    description: 'Only an admin may cancel work already in progress',
  },
  {
    from: 'OPEN',
    to: 'EXPIRED',
    action: 'expire',
    actors: ['SYSTEM'],
    description: 'Deadline passed with no helper',
  },
  {
    from: 'OFFERS_RECEIVED',
    to: 'EXPIRED',
    action: 'expire',
    actors: ['SYSTEM'],
    description: 'Deadline passed without a helper being selected',
  },
  {
    from: 'HELPER_SELECTED',
    to: 'EXPIRED',
    action: 'expire',
    actors: ['SYSTEM'],
    description: 'Selected helper never accepted before the deadline',
  },

  // --- Disputes ----------------------------------------------------------
  {
    from: 'IN_PROGRESS',
    to: 'DISPUTED',
    action: 'open_dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'A problem was raised during the task',
  },
  {
    from: 'DISPUTED',
    to: 'PAYMENT_PENDING',
    action: 'resolve_for_helper',
    actors: ['ADMIN'],
    description: 'Admin ruled the helper should be paid',
  },
  {
    from: 'DISPUTED',
    to: 'CANCELLED',
    action: 'resolve_for_requester',
    actors: ['ADMIN'],
    description: 'Admin cancelled the request in the requester’s favour',
  },
  {
    from: 'DISPUTED',
    to: 'PAID',
    action: 'resolve_paid',
    actors: ['ADMIN'],
    description: 'Admin confirmed payment already happened',
  },
  // A dismissed dispute returns the request to where it was when the dispute was
  // opened. PAYMENT_PENDING and PAID are reached through the transitions above.
  {
    from: 'DISPUTED',
    to: 'IN_PROGRESS',
    action: 'dismiss_dispute',
    actors: ['ADMIN'],
    description: 'Admin dismissed a dispute raised during the task; work continues',
  },
  {
    from: 'DISPUTED',
    to: 'REJECTED',
    action: 'dismiss_dispute',
    actors: ['ADMIN'],
    description: 'Admin dismissed the dispute; the rejected completion stands',
  },
];

/** Rental lifecycle: AVAILABLE → RESERVED → RENTED → RETURN_PENDING → RETURNED → COMPLETED. */
export const RENTAL_TRANSITIONS: readonly Transition<RentalStatus>[] = [
  {
    from: 'REQUESTED',
    to: 'RESERVED',
    action: 'owner_accept',
    actors: ['REQUESTER', 'ADMIN'],
    description: 'Owner accepted the rental request and reserved the item',
  },
  {
    from: 'REQUESTED',
    to: 'DECLINED',
    action: 'owner_decline',
    actors: ['REQUESTER', 'ADMIN'],
    description: 'Owner declined the rental request',
  },
  {
    from: 'REQUESTED',
    to: 'CANCELLED',
    action: 'renter_cancel',
    actors: ['HELPER'],
    description: 'Renter withdrew the request before it was accepted',
  },
  {
    from: 'RESERVED',
    to: 'RENTED',
    action: 'confirm_pickup',
    actors: ['REQUESTER'],
    description: 'Owner confirmed handover; the rental clock starts',
  },
  {
    from: 'RESERVED',
    to: 'CANCELLED',
    action: 'cancel_reservation',
    actors: ['REQUESTER', 'HELPER', 'ADMIN'],
    description: 'Reservation cancelled before pickup',
  },
  {
    from: 'RENTED',
    to: 'RETURN_PENDING',
    action: 'mark_returned',
    actors: ['HELPER'],
    description: 'Renter says the item has been handed back',
  },
  {
    from: 'RENTED',
    to: 'DISPUTED',
    action: 'open_dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'Item not returned, damaged, or another problem',
  },
  {
    from: 'RETURN_PENDING',
    to: 'RETURNED',
    action: 'confirm_return',
    actors: ['REQUESTER'],
    description: 'Owner confirmed they received the item back',
  },
  {
    from: 'RETURN_PENDING',
    to: 'DISPUTED',
    action: 'dispute_return',
    actors: ['REQUESTER'],
    description: 'Owner disputes the condition or the return itself',
  },
  {
    from: 'RETURNED',
    to: 'COMPLETED',
    action: 'settle_deposit',
    actors: ['REQUESTER', 'SYSTEM'],
    description: 'Deposit settled; the rental is finished',
  },
  {
    from: 'DISPUTED',
    to: 'COMPLETED',
    action: 'resolve_dispute',
    actors: ['ADMIN'],
    description: 'Admin closed the rental dispute',
  },
];

/** Payment lifecycle for the manual UPI workflow. */
export const PAYMENT_TRANSITIONS: readonly Transition<PaymentStatus>[] = [
  {
    from: 'PAYMENT_PENDING',
    to: 'PAYMENT_INITIATED',
    action: 'mark_initiated',
    actors: ['REQUESTER'],
    description: 'Requester opened their UPI app to pay',
  },
  {
    from: 'PAYMENT_INITIATED',
    to: 'PAYMENT_CLAIMED',
    action: 'claim_sent',
    actors: ['REQUESTER'],
    description: 'Requester states the money was sent (unverified claim)',
  },
  {
    from: 'PAYMENT_PENDING',
    to: 'PAYMENT_CLAIMED',
    action: 'claim_sent',
    actors: ['REQUESTER'],
    description: 'Requester paid outside the app and reported it',
  },
  {
    from: 'PAYMENT_CLAIMED',
    to: 'PAYMENT_CONFIRMED',
    action: 'confirm_received',
    actors: ['HELPER'],
    description: 'Helper confirmed the money actually arrived — this is the only real proof',
  },
  {
    from: 'PAYMENT_CLAIMED',
    to: 'PAYMENT_DISPUTED',
    action: 'deny_received',
    actors: ['HELPER'],
    description: 'Helper says the money never arrived',
  },
  {
    from: 'PAYMENT_INITIATED',
    to: 'PAYMENT_DISPUTED',
    action: 'dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'Payment problem raised',
  },
  {
    from: 'PAYMENT_PENDING',
    to: 'PAYMENT_DISPUTED',
    action: 'dispute',
    actors: ['REQUESTER', 'HELPER'],
    description: 'Payment problem raised before any transfer',
  },
  {
    from: 'PAYMENT_DISPUTED',
    to: 'PAYMENT_CONFIRMED',
    action: 'admin_confirm',
    actors: ['ADMIN'],
    description: 'Admin ruled the payment did happen',
  },
  {
    from: 'PAYMENT_DISPUTED',
    to: 'REFUNDED',
    action: 'admin_refund',
    actors: ['ADMIN'],
    description: 'Admin ruled the requester should not pay',
  },
  {
    from: 'PAYMENT_CONFIRMED',
    to: 'REFUNDED',
    action: 'admin_refund',
    actors: ['ADMIN'],
    description: 'Admin reversed a confirmed payment after review',
  },
];

/** Thrown when a caller attempts a transition the machine forbids. */
export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
    readonly actor: Actor,
    readonly reason: 'NO_SUCH_TRANSITION' | 'ACTOR_NOT_ALLOWED',
  ) {
    super(
      reason === 'ACTOR_NOT_ALLOWED'
        ? `A ${actor.toLowerCase()} is not allowed to move this ${entity.toLowerCase()} from ${from} to ${to}.`
        : `A ${entity.toLowerCase()} cannot move from ${from} to ${to}.`,
    );
    this.name = 'InvalidTransitionError';
  }
}

function buildChecker<TStatus extends string>(
  entity: string,
  transitions: readonly Transition<TStatus>[],
) {
  const canTransition = (from: TStatus, to: TStatus, actor: Actor): boolean =>
    transitions.some((t) => t.from === from && t.to === to && t.actors.includes(actor));

  const findTransition = (
    from: TStatus,
    to: TStatus,
  ): Transition<TStatus> | undefined => transitions.find((t) => t.from === from && t.to === to);

  const assertTransition = (from: TStatus, to: TStatus, actor: Actor): Transition<TStatus> => {
    const transition = findTransition(from, to);
    if (!transition) throw new InvalidTransitionError(entity, from, to, actor, 'NO_SUCH_TRANSITION');
    if (!transition.actors.includes(actor)) {
      throw new InvalidTransitionError(entity, from, to, actor, 'ACTOR_NOT_ALLOWED');
    }
    return transition;
  };

  /** Every status reachable from `from` by `actor` — used to drive UI button state. */
  const nextStatuses = (from: TStatus, actor: Actor): TStatus[] =>
    transitions.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.to);

  return { canTransition, findTransition, assertTransition, nextStatuses };
}

const requestChecker = buildChecker<RequestStatus>('Request', REQUEST_TRANSITIONS);
export const canRequestTransition = requestChecker.canTransition;
export const assertRequestTransition = requestChecker.assertTransition;
export const nextRequestStatuses = requestChecker.nextStatuses;
export const findRequestTransition = requestChecker.findTransition;

const rentalChecker = buildChecker<RentalStatus>('Rental', RENTAL_TRANSITIONS);
export const canRentalTransition = rentalChecker.canTransition;
export const assertRentalTransition = rentalChecker.assertTransition;
export const nextRentalStatuses = rentalChecker.nextStatuses;

const paymentChecker = buildChecker<PaymentStatus>('Payment', PAYMENT_TRANSITIONS);
export const canPaymentTransition = paymentChecker.canTransition;
export const assertPaymentTransition = paymentChecker.assertTransition;
export const nextPaymentStatuses = paymentChecker.nextStatuses;
