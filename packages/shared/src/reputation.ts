import { bayesianRating } from './matching.js';

/**
 * Reputation and reliability (spec §39, §40).
 *
 * The formula is intentionally simple and explainable — a student should be able to
 * read their profile and understand exactly why their score is what it is, and a new
 * account must never be permanently disadvantaged.
 */

export interface ReputationInputs {
  averageRating: number;
  ratingCount: number;
  completedTasks: number;
  cancelledTasks: number;
  disputedTasks: number;
  /** Offers/requests responded to, 0..1. */
  responseRate: number;
  accountAgeDays: number;
}

export interface ReputationSummary {
  /** Rating shrunk toward the campus prior, 1..5. */
  adjustedRating: number;
  /** completed / (completed + cancelled), 0..1. Returns 1 for a brand-new account. */
  completionRate: number;
  /** cancelled / (completed + cancelled), 0..1. */
  cancellationRate: number;
  /** disputed / completed, 0..1. */
  disputeRate: number;
  /** Composite 0..100 score shown on the profile. */
  reliabilityScore: number;
  tier: 'NEW' | 'BRONZE' | 'SILVER' | 'GOLD';
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function computeReputation(input: ReputationInputs): ReputationSummary {
  const attempted = input.completedTasks + input.cancelledTasks;
  const completionRate = attempted === 0 ? 1 : input.completedTasks / attempted;
  const cancellationRate = attempted === 0 ? 0 : input.cancelledTasks / attempted;
  const disputeRate = input.completedTasks === 0 ? 0 : input.disputedTasks / input.completedTasks;
  const adjustedRating = bayesianRating(input.averageRating, input.ratingCount);

  // Experience saturates at 50 tasks so veterans do not become unbeatable.
  const experience = clamp01(input.completedTasks / 50);
  // Account age contributes a little trust, saturating at 90 days.
  const tenure = clamp01(input.accountAgeDays / 90);

  const raw =
    clamp01((adjustedRating - 1) / 4) * 0.4 +
    completionRate * 0.2 +
    clamp01(input.responseRate) * 0.1 +
    experience * 0.15 +
    tenure * 0.05 +
    (1 - clamp01(disputeRate)) * 0.1;

  const reliabilityScore = Math.round(clamp01(raw) * 100);

  let tier: ReputationSummary['tier'] = 'NEW';
  if (input.completedTasks >= 50 && reliabilityScore >= 85) tier = 'GOLD';
  else if (input.completedTasks >= 20 && reliabilityScore >= 70) tier = 'SILVER';
  else if (input.completedTasks >= 5) tier = 'BRONZE';

  return {
    adjustedRating: Math.round(adjustedRating * 100) / 100,
    completionRate: Math.round(completionRate * 1000) / 1000,
    cancellationRate: Math.round(cancellationRate * 1000) / 1000,
    disputeRate: Math.round(disputeRate * 1000) / 1000,
    reliabilityScore,
    tier,
  };
}

/** Percentage helper for the UI, e.g. 0.98 -> "98%". */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
