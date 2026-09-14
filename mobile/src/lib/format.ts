import { formatDistance, formatINR } from '@campusbuddy/shared';
import type { RequestStatus } from '@campusbuddy/shared';

export { formatINR, formatDistance };

/** "in 12 min", "2 h ago" — short enough for a request card. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diffMs = new Date(iso).getTime() - Date.now();
  const future = diffMs > 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  if (minutes < 1) return future ? 'now' : 'just now';
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours} h` : `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return future ? `in ${days} d` : `${days} d ago`;

  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Time remaining before a deadline, or a clear note that it has passed. */
export function countdown(iso: string | null | undefined): { text: string; urgent: boolean; expired: boolean } {
  if (!iso) return { text: 'No deadline', urgent: false, expired: false };
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return { text: 'Deadline passed', urgent: false, expired: true };

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return { text: `${minutes} min left`, urgent: minutes <= 15, expired: false };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { text: `${hours} h left`, urgent: false, expired: false };

  return { text: `${Math.floor(hours / 24)} d left`, urgent: false, expired: false };
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return 'Today';
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Human wording and colour for each lifecycle status (spec §106). */
export const STATUS_META: Record<RequestStatus, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'info' },
  OFFERS_RECEIVED: { label: 'Offers received', tone: 'info' },
  HELPER_SELECTED: { label: 'Helper selected', tone: 'accent' },
  ACCEPTED: { label: 'Accepted', tone: 'accent' },
  IN_PROGRESS: { label: 'In progress', tone: 'accent' },
  COMPLETED: { label: 'Awaiting your confirmation', tone: 'warning' },
  REJECTED: { label: 'Completion rejected', tone: 'danger' },
  PAYMENT_PENDING: { label: 'Payment due', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  RATED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  HELPER_WITHDREW: { label: 'Helper withdrew', tone: 'danger' },
  DISPUTED: { label: 'Disputed', tone: 'danger' },
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PAYMENT_PENDING: 'Payment due',
  PAYMENT_INITIATED: 'Payment started',
  PAYMENT_CLAIMED: 'Marked as sent — awaiting confirmation',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  PAYMENT_DISPUTED: 'Payment disputed',
  REFUNDED: 'Refunded',
};

/** Wording for each action button, matching what the server will actually allow. */
export const ACTION_LABEL: Record<string, string> = {
  make_offer: 'Offer to help',
  withdraw_offer: 'Withdraw offer',
  select_helper: 'Choose helper',
  view_offers: 'View offers',
  accept: 'Accept task',
  decline_selection: 'Decline',
  start: 'Start task',
  complete: 'Mark completed',
  confirm_completion: 'Confirm completion',
  reject_completion: 'Not done',
  resume: 'Try again',
  withdraw: 'Withdraw',
  reopen: 'Reopen request',
  cancel: 'Cancel request',
  increase_reward: 'Increase reward',
  open_chat: 'Chat',
  pay: 'Pay now',
  await_payment: 'Awaiting payment',
  rate: 'Leave a rating',
  report: 'Report',
  open_dispute: 'Open a dispute',
  edit: 'Edit',
};
