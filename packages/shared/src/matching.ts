import { haversineMetres, type LatLng } from './geo.js';
import type { AvailabilityState, UrgencyLevel } from './constants.js';

/**
 * Helper matching.
 *
 * Deliberately kept as a pure, UI-independent module (spec §24) so it can be unit
 * tested, tuned, and later replaced without touching any screen or route.
 *
 *   Helper Score = distance + category match + availability + rating
 *                + completion reliability + reward preference + response history
 *                + urgency fit
 *
 * Every component returns 0..1 and is combined with a configurable weight, so the
 * final score is always 0..1 and is directly comparable across requests.
 */

export interface MatchingWeights {
  distance: number;
  categoryMatch: number;
  availability: number;
  rating: number;
  reliability: number;
  rewardPreference: number;
  responseHistory: number;
  urgencyFit: number;
}

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  distance: 0.25,
  categoryMatch: 0.15,
  availability: 0.15,
  rating: 0.15,
  reliability: 0.1,
  rewardPreference: 0.1,
  responseHistory: 0.05,
  urgencyFit: 0.05,
};

export interface HelperProfile {
  userId: string;
  location: LatLng | null;
  /** Category slugs the helper opted into. Empty means "open to anything". */
  preferredCategories: readonly string[];
  availability: AvailabilityState;
  /** 0 when the helper has no ratings yet. */
  averageRating: number;
  ratingCount: number;
  completedTasks: number;
  cancelledTasks: number;
  /** Fraction of offers the helper responded to, 0..1. */
  responseRate: number;
  /** Median minutes to first response; null when unknown. */
  medianResponseMinutes: number | null;
  minRewardPaise: number;
  maxDistanceMetres: number;
  /** How many tasks this helper already completed in the request's category. */
  categoryExperience: number;
}

export interface MatchingRequest {
  categorySlug: string;
  location: LatLng | null;
  rewardPaise: number;
  urgency: UrgencyLevel;
}

export interface ScoreBreakdown {
  distance: number;
  categoryMatch: number;
  availability: number;
  rating: number;
  reliability: number;
  rewardPreference: number;
  responseHistory: number;
  urgencyFit: number;
}

export interface MatchResult {
  userId: string;
  score: number;
  breakdown: ScoreBreakdown;
  distanceMetres: number | null;
  /** Reasons the helper was filtered out. Empty means eligible. */
  exclusions: string[];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Distance decays smoothly to 0 at `maxDistanceMetres`.
 * A helper with no known location gets a neutral 0.5 rather than being excluded,
 * because location sharing is optional and privacy-preserving by design.
 */
function scoreDistance(distanceMetres: number | null, maxDistanceMetres: number): number {
  if (distanceMetres === null) return 0.5;
  if (maxDistanceMetres <= 0) return 0;
  return clamp01(1 - distanceMetres / maxDistanceMetres);
}

function scoreCategory(helper: HelperProfile, categorySlug: string): number {
  const opted = helper.preferredCategories.length === 0 || helper.preferredCategories.includes(categorySlug);
  // Prior experience in the category is worth up to half the component, saturating at 10 tasks.
  const experience = clamp01(helper.categoryExperience / 10) * 0.5;
  return clamp01((opted ? 0.5 : 0) + experience);
}

function scoreAvailability(state: AvailabilityState): number {
  switch (state) {
    case 'AVAILABLE_NOW':
      return 1;
    case 'AVAILABLE_LATER':
      return 0.4;
    case 'BUSY':
      return 0;
  }
}

/**
 * Ratings are shrunk toward the 3.5-star campus prior using a Bayesian average, so a
 * single 5-star review does not outrank a long track record — and, equally important,
 * a brand-new student is not locked out of the marketplace (spec §40).
 */
export function bayesianRating(averageRating: number, ratingCount: number, prior = 3.5, weight = 5): number {
  if (ratingCount <= 0) return prior;
  return (prior * weight + averageRating * ratingCount) / (weight + ratingCount);
}

function scoreRating(helper: HelperProfile): number {
  return clamp01((bayesianRating(helper.averageRating, helper.ratingCount) - 1) / 4);
}

function scoreReliability(helper: HelperProfile): number {
  const total = helper.completedTasks + helper.cancelledTasks;
  if (total === 0) return 0.6; // Neutral-positive start so new helpers can win work.
  return clamp01(helper.completedTasks / total);
}

/** 1 when the reward comfortably clears the helper's floor, 0 when it is below it. */
function scoreRewardPreference(rewardPaise: number, minRewardPaise: number): number {
  if (minRewardPaise <= 0) return 1;
  if (rewardPaise < minRewardPaise) return 0;
  return clamp01(0.6 + 0.4 * clamp01((rewardPaise - minRewardPaise) / minRewardPaise));
}

function scoreResponseHistory(helper: HelperProfile): number {
  const rate = clamp01(helper.responseRate);
  if (helper.medianResponseMinutes === null) return rate * 0.8;
  // Responding within 5 minutes is ideal; beyond an hour adds nothing.
  const speed = clamp01(1 - (helper.medianResponseMinutes - 5) / 55);
  return clamp01(rate * 0.6 + speed * 0.4);
}

/** Urgent work should go to helpers who are both available now and genuinely close by. */
function scoreUrgencyFit(
  urgency: UrgencyLevel,
  helper: HelperProfile,
  distanceMetres: number | null,
): number {
  if (urgency === 'NORMAL') return 1;
  const availableNow = helper.availability === 'AVAILABLE_NOW' ? 0.6 : 0;
  const close = distanceMetres === null ? 0.2 : clamp01(1 - distanceMetres / 800) * 0.4;
  return clamp01(availableNow + close);
}

export function scoreHelper(
  request: MatchingRequest,
  helper: HelperProfile,
  weights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS,
): MatchResult {
  const distanceMetres =
    request.location && helper.location ? haversineMetres(request.location, helper.location) : null;

  const exclusions: string[] = [];
  if (helper.availability === 'BUSY') exclusions.push('HELPER_BUSY');
  if (helper.minRewardPaise > 0 && request.rewardPaise < helper.minRewardPaise) {
    exclusions.push('REWARD_BELOW_MINIMUM');
  }
  if (distanceMetres !== null && distanceMetres > helper.maxDistanceMetres) {
    exclusions.push('OUTSIDE_SERVICE_RADIUS');
  }

  const breakdown: ScoreBreakdown = {
    distance: scoreDistance(distanceMetres, helper.maxDistanceMetres),
    categoryMatch: scoreCategory(helper, request.categorySlug),
    availability: scoreAvailability(helper.availability),
    rating: scoreRating(helper),
    reliability: scoreReliability(helper),
    rewardPreference: scoreRewardPreference(request.rewardPaise, helper.minRewardPaise),
    responseHistory: scoreResponseHistory(helper),
    urgencyFit: scoreUrgencyFit(request.urgency, helper, distanceMetres),
  };

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0) || 1;
  const weighted = (Object.keys(breakdown) as (keyof ScoreBreakdown)[]).reduce(
    (sum, key) => sum + breakdown[key] * weights[key],
    0,
  );

  return {
    userId: helper.userId,
    score: clamp01(weighted / totalWeight),
    breakdown,
    distanceMetres,
    exclusions,
  };
}

/** Rank helpers best-first. Excluded helpers are dropped unless `includeExcluded` is set. */
export function rankHelpers(
  request: MatchingRequest,
  helpers: readonly HelperProfile[],
  options: { weights?: MatchingWeights; includeExcluded?: boolean; limit?: number } = {},
): MatchResult[] {
  const results = helpers
    .map((h) => scoreHelper(request, h, options.weights))
    .filter((r) => options.includeExcluded || r.exclusions.length === 0)
    .sort((a, b) => b.score - a.score);
  return options.limit ? results.slice(0, options.limit) : results;
}

/**
 * The mirror of `scoreHelper`: how well an open request suits a given helper.
 * Used to order the "Recommended" tab of the discover feed.
 */
export function scoreRequestForHelper(
  request: MatchingRequest & { createdAt: Date; deadlineAt: Date | null },
  helper: HelperProfile,
  now: Date = new Date(),
  weights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS,
): number {
  const base = scoreHelper(request, helper, weights).score;

  // Requests close to their deadline surface higher so they do not quietly expire.
  let urgencyBoost = 0;
  if (request.deadlineAt) {
    const minutesLeft = (request.deadlineAt.getTime() - now.getTime()) / 60_000;
    if (minutesLeft > 0 && minutesLeft < 30) urgencyBoost = 0.1 * (1 - minutesLeft / 30);
  }
  if (request.urgency === 'URGENT') urgencyBoost += 0.05;

  // Mild freshness bonus decaying over two hours, so the feed keeps moving.
  const ageMinutes = Math.max(0, (now.getTime() - request.createdAt.getTime()) / 60_000);
  const freshness = 0.05 * Math.max(0, 1 - ageMinutes / 120);

  return clamp01(base + urgencyBoost + freshness);
}
