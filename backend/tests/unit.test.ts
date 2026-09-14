import { describe, expect, it } from 'vitest';
import {
  assertRequestTransition,
  bayesianRating,
  canRequestTransition,
  computeReputation,
  formatDistance,
  formatINR,
  fuzzCoordinate,
  haversineMetres,
  InvalidTransitionError,
  isInsideGeofence,
  isValidCoordinate,
  nextRequestStatuses,
  rankHelpers,
  rupeesToPaise,
  scoreHelper,
  totalBudgetPaise,
  type HelperProfile,
} from '@campusbuddy/shared';
import { isWithinQuietHours } from '../src/modules/notifications/service.js';
import { computeUnits } from '../src/modules/rentals/routes.js';
import { isSameUpiId, parseUpiUri } from '@campusbuddy/shared';
import { signAttachmentUrl, verifyAttachmentSignature } from '../src/core/signed-urls.js';
import {
  MalformedImageError,
  stripJpegMetadata,
  stripPngMetadata,
} from '../src/modules/uploads/metadata.js';
import { jpegSegment, jpegWithMetadata, pngWithMetadata, TINY_PNG } from './fixtures.js';

/**
 * Unit tests for the pure business logic (spec §89).
 * No database, no HTTP — just the rules.
 */

describe('money', () => {
  it('keeps rupee amounts exact by working in integer paise', () => {
    // The float trap this design exists to avoid: 0.1 + 0.2 !== 0.3.
    expect(rupeesToPaise(0.1) + rupeesToPaise(0.2)).toBe(rupeesToPaise(0.3));
    expect(rupeesToPaise(20.5)).toBe(2050);
  });

  it('formats whole rupees without decimals and part-rupees with them', () => {
    expect(formatINR(3000)).toBe('₹30');
    expect(formatINR(3050)).toBe('₹30.50');
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(-2500)).toBe('-₹25');
  });

  it('groups thousands in the Indian style', () => {
    // 485000 paise = ₹4,850 — grouped as 4,850 not 485,0.
    expect(formatINR(485_000)).toBe('₹4,850');
    expect(formatINR(10_000_000)).toBe('₹1,00,000');
  });

  it('adds product cost and reward for the total budget', () => {
    expect(totalBudgetPaise(1000, 2000)).toBe(3000);
  });
});

describe('geo', () => {
  it('measures a known short distance accurately', () => {
    // One degree of latitude is ~111 km; a 0.001 degree step is ~111 m.
    const metres = haversineMetres({ lat: 25.5854, lng: 84.8514 }, { lat: 25.5864, lng: 84.8514 });
    expect(metres).toBeGreaterThan(105);
    expect(metres).toBeLessThan(115);
  });

  it('returns zero for identical points', () => {
    expect(haversineMetres({ lat: 25.5, lng: 84.8 }, { lat: 25.5, lng: 84.8 })).toBe(0);
  });

  it('decides geofence membership at the boundary', () => {
    const centre = { lat: 25.5854, lng: 84.8514 };
    expect(isInsideGeofence(centre, centre, 1500)).toBe(true);
    // ~1.1 km north is inside a 1.5 km fence; ~2.2 km is not.
    expect(isInsideGeofence({ lat: 25.5954, lng: 84.8514 }, centre, 1500)).toBe(true);
    expect(isInsideGeofence({ lat: 25.6054, lng: 84.8514 }, centre, 1500)).toBe(false);
  });

  it('rejects null island and out-of-range coordinates', () => {
    expect(isValidCoordinate({ lat: 0, lng: 0 })).toBe(false);
    expect(isValidCoordinate({ lat: 91, lng: 10 })).toBe(false);
    expect(isValidCoordinate({ lat: 25.5854, lng: 84.8514 })).toBe(true);
  });

  it('coarsens coordinates enough to hide an exact position', () => {
    const exact = { lat: 25.585432, lng: 84.851987 };
    const fuzzed = fuzzCoordinate(exact);
    expect(fuzzed.lat).toBe(25.585);
    expect(fuzzed.lng).toBe(84.852);
    // The published point should be at least tens of metres from the real one.
    expect(haversineMetres(exact, fuzzed)).toBeGreaterThan(1);
  });

  it('formats distances the way a request card shows them', () => {
    expect(formatDistance(347)).toBe('350 m');
    expect(formatDistance(1240)).toBe('1.2 km');
    expect(formatDistance(-1)).toBe('—');
  });
});

describe('request state machine', () => {
  it('follows the happy path from OPEN to RATED', () => {
    expect(canRequestTransition('OPEN', 'OFFERS_RECEIVED', 'SYSTEM')).toBe(true);
    expect(canRequestTransition('OFFERS_RECEIVED', 'HELPER_SELECTED', 'REQUESTER')).toBe(true);
    expect(canRequestTransition('HELPER_SELECTED', 'ACCEPTED', 'HELPER')).toBe(true);
    expect(canRequestTransition('ACCEPTED', 'IN_PROGRESS', 'HELPER')).toBe(true);
    expect(canRequestTransition('IN_PROGRESS', 'COMPLETED', 'HELPER')).toBe(true);
    expect(canRequestTransition('COMPLETED', 'PAYMENT_PENDING', 'REQUESTER')).toBe(true);
    expect(canRequestTransition('PAYMENT_PENDING', 'PAID', 'SYSTEM')).toBe(true);
    expect(canRequestTransition('PAID', 'RATED', 'SYSTEM')).toBe(true);
  });

  it('refuses to skip steps', () => {
    expect(canRequestTransition('OPEN', 'COMPLETED', 'HELPER')).toBe(false);
    expect(canRequestTransition('OPEN', 'PAID', 'REQUESTER')).toBe(false);
    expect(canRequestTransition('ACCEPTED', 'RATED', 'REQUESTER')).toBe(false);
  });

  it('refuses a legal transition attempted by the wrong party', () => {
    // A helper cannot confirm their own completion — that is the requester's call.
    expect(canRequestTransition('COMPLETED', 'PAYMENT_PENDING', 'HELPER')).toBe(false);
    // A requester cannot mark the task done on the helper's behalf.
    expect(canRequestTransition('IN_PROGRESS', 'COMPLETED', 'REQUESTER')).toBe(false);
    // A requester cannot cancel work already in progress; only an admin can.
    expect(canRequestTransition('IN_PROGRESS', 'CANCELLED', 'REQUESTER')).toBe(false);
    expect(canRequestTransition('IN_PROGRESS', 'CANCELLED', 'ADMIN')).toBe(true);
  });

  it('throws a specific error explaining which rule was broken', () => {
    expect(() => assertRequestTransition('OPEN', 'PAID', 'REQUESTER')).toThrow(InvalidTransitionError);
    try {
      assertRequestTransition('COMPLETED', 'PAYMENT_PENDING', 'HELPER');
    } catch (error) {
      expect((error as InvalidTransitionError).reason).toBe('ACTOR_NOT_ALLOWED');
    }
    try {
      assertRequestTransition('OPEN', 'PAID', 'REQUESTER');
    } catch (error) {
      expect((error as InvalidTransitionError).reason).toBe('NO_SUCH_TRANSITION');
    }
  });

  it('offers no moves out of a terminal state', () => {
    expect(nextRequestStatuses('RATED', 'REQUESTER')).toHaveLength(0);
    expect(nextRequestStatuses('CANCELLED', 'REQUESTER')).toHaveLength(0);
    expect(nextRequestStatuses('EXPIRED', 'HELPER')).toHaveLength(0);
  });

  it('lets a rejected completion be retried or escalated', () => {
    expect(canRequestTransition('REJECTED', 'IN_PROGRESS', 'HELPER')).toBe(true);
    expect(canRequestTransition('REJECTED', 'DISPUTED', 'REQUESTER')).toBe(true);
  });
});

describe('matching', () => {
  const baseHelper: HelperProfile = {
    userId: 'helper-1',
    location: { lat: 25.5854, lng: 84.8514 },
    preferredCategories: ['quick-delivery'],
    availability: 'AVAILABLE_NOW',
    averageRating: 4.8,
    ratingCount: 30,
    completedTasks: 40,
    cancelledTasks: 2,
    responseRate: 0.9,
    medianResponseMinutes: 4,
    minRewardPaise: 1000,
    maxDistanceMetres: 2000,
    categoryExperience: 8,
  };
  const request = {
    categorySlug: 'quick-delivery',
    location: { lat: 25.5854, lng: 84.8514 },
    rewardPaise: 3000,
    urgency: 'NORMAL' as const,
  };

  it('produces a normalised score between 0 and 1', () => {
    const result = scoreHelper(request, baseHelper);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.exclusions).toHaveLength(0);
  });

  it('ranks a closer, better-matched helper above a distant one', () => {
    const distant: HelperProfile = {
      ...baseHelper,
      userId: 'helper-2',
      location: { lat: 25.5954, lng: 84.8614 },
      categoryExperience: 0,
    };
    const ranked = rankHelpers(request, [distant, baseHelper]);
    expect(ranked[0].userId).toBe('helper-1');
  });

  it('excludes helpers who are busy, too far, or below their reward floor', () => {
    expect(scoreHelper(request, { ...baseHelper, availability: 'BUSY' }).exclusions).toContain(
      'HELPER_BUSY',
    );
    expect(
      scoreHelper(request, { ...baseHelper, minRewardPaise: 9000 }).exclusions,
    ).toContain('REWARD_BELOW_MINIMUM');
    expect(
      scoreHelper(
        { ...request, location: { lat: 25.65, lng: 84.9 } },
        { ...baseHelper, maxDistanceMetres: 500 },
      ).exclusions,
    ).toContain('OUTSIDE_SERVICE_RADIUS');
  });

  it('does not lock out a brand-new student with no history', () => {
    const newcomer: HelperProfile = {
      ...baseHelper,
      userId: 'newcomer',
      averageRating: 0,
      ratingCount: 0,
      completedTasks: 0,
      cancelledTasks: 0,
      categoryExperience: 0,
      responseRate: 0,
      medianResponseMinutes: null,
    };
    const result = scoreHelper(request, newcomer);
    expect(result.exclusions).toHaveLength(0);
    // Competitive enough to win work, without outranking a proven helper.
    expect(result.score).toBeGreaterThan(0.4);
    expect(result.score).toBeLessThan(scoreHelper(request, baseHelper).score);
  });

  it('gives a helper with no shared location a neutral distance score', () => {
    const result = scoreHelper(request, { ...baseHelper, location: null });
    expect(result.distanceMetres).toBeNull();
    expect(result.breakdown.distance).toBe(0.5);
  });
});

describe('reputation', () => {
  it('shrinks a single five-star review toward the campus prior', () => {
    // One perfect review must not read as a flawless track record.
    expect(bayesianRating(5, 1)).toBeLessThan(4.0);
    expect(bayesianRating(5, 100)).toBeGreaterThan(4.9);
    expect(bayesianRating(0, 0)).toBe(3.5);
  });

  it('summarises a strong helper as highly reliable', () => {
    const summary = computeReputation({
      averageRating: 4.9,
      ratingCount: 120,
      completedTasks: 127,
      cancelledTasks: 3,
      disputedTasks: 0,
      responseRate: 0.98,
      accountAgeDays: 400,
    });
    expect(summary.completionRate).toBeGreaterThan(0.97);
    expect(summary.reliabilityScore).toBeGreaterThan(85);
    expect(summary.tier).toBe('GOLD');
  });

  it('treats a fresh account as new rather than bad', () => {
    const summary = computeReputation({
      averageRating: 0,
      ratingCount: 0,
      completedTasks: 0,
      cancelledTasks: 0,
      disputedTasks: 0,
      responseRate: 1,
      accountAgeDays: 0,
    });
    expect(summary.completionRate).toBe(1);
    expect(summary.cancellationRate).toBe(0);
    expect(summary.tier).toBe('NEW');
    expect(summary.reliabilityScore).toBeGreaterThan(0);
  });

  it('penalises frequent cancellation', () => {
    const reliable = computeReputation({
      averageRating: 4.5, ratingCount: 20, completedTasks: 20, cancelledTasks: 0,
      disputedTasks: 0, responseRate: 1, accountAgeDays: 100,
    });
    const flaky = computeReputation({
      averageRating: 4.5, ratingCount: 20, completedTasks: 20, cancelledTasks: 15,
      disputedTasks: 0, responseRate: 1, accountAgeDays: 100,
    });
    expect(flaky.reliabilityScore).toBeLessThan(reliable.reliabilityScore);
    expect(flaky.cancellationRate).toBeGreaterThan(0.4);
  });
});

describe('quiet hours', () => {
  it('handles a window that crosses midnight', () => {
    // 22:00 to 07:00
    expect(isWithinQuietHours(23, 22, 7)).toBe(true);
    expect(isWithinQuietHours(3, 22, 7)).toBe(true);
    expect(isWithinQuietHours(12, 22, 7)).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(isWithinQuietHours(10, 9, 17)).toBe(true);
    expect(isWithinQuietHours(20, 9, 17)).toBe(false);
  });

  it('treats an unset or zero-length window as always allowed', () => {
    expect(isWithinQuietHours(3, null, null)).toBe(false);
    expect(isWithinQuietHours(3, 5, 5)).toBe(false);
  });
});

describe('rental billing', () => {
  it('rounds part periods up to whole units', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    expect(computeUnits(start, new Date('2026-01-01T11:30:00Z'), 'HOUR')).toBe(2);
    expect(computeUnits(start, new Date('2026-01-02T09:00:00Z'), 'DAY')).toBe(1);
    expect(computeUnits(start, new Date('2026-01-03T11:00:00Z'), 'DAY')).toBe(3);
    expect(computeUnits(start, new Date('2026-01-08T11:00:00Z'), 'WEEK')).toBe(2);
  });

  it('always bills at least one unit', () => {
    const start = new Date('2026-01-01T10:00:00Z');
    expect(computeUnits(start, new Date('2026-01-01T10:01:00Z'), 'DAY')).toBe(1);
  });
});

describe('UPI QR payloads', () => {
  it('reads the UPI ID and name from a standard payment link', () => {
    expect(parseUpiUri('upi://pay?pa=aman.singh@okaxis&pn=Aman%20Singh&cu=INR')).toEqual({
      vpa: 'aman.singh@okaxis',
      payeeName: 'Aman Singh',
    });
  });

  it('accepts an upper-case scheme and surrounding whitespace', () => {
    expect(parseUpiUri('  UPI://PAY?pa=Rahul@YBL  ')).toEqual({ vpa: 'rahul@ybl', payeeName: null });
  });

  it('rejects anything that is not a UPI payment link', () => {
    expect(parseUpiUri('https://example.com/pay?pa=aman@okaxis')).toBeNull();
    expect(parseUpiUri('upi://pay?pn=No%20Address')).toBeNull();
    expect(parseUpiUri('upi://pay?pa=not-an-address')).toBeNull();
    expect(parseUpiUri('upi://mandate?pa=aman@okaxis')).toBeNull();
    expect(parseUpiUri('')).toBeNull();
  });

  it('compares UPI IDs without regard to case or spacing', () => {
    expect(isSameUpiId('Aman@OKAXIS', ' aman@okaxis ')).toBe(true);
    expect(isSameUpiId('aman@okaxis', 'aman@ybl')).toBe(false);
  });
});

describe('signed file links', () => {
  const id = '1f0e4b1e-6c2a-4c1e-9b7a-2f3d4e5f6a7b';
  const parts = (url: string): { expires: number; signature: string } => {
    const parsed = new URL(url, 'http://localhost');
    return {
      expires: Number(parsed.searchParams.get('expires')),
      signature: parsed.searchParams.get('signature') ?? '',
    };
  };

  it('verifies a link it issued', () => {
    const { expires, signature } = parts(signAttachmentUrl(id));
    expect(verifyAttachmentSignature(id, expires, signature)).toBe(true);
  });

  it('rejects the signature for a different file, a later expiry, or an altered signature', () => {
    const { expires, signature } = parts(signAttachmentUrl(id));
    expect(verifyAttachmentSignature('2f0e4b1e-6c2a-4c1e-9b7a-2f3d4e5f6a7b', expires, signature)).toBe(false);
    expect(verifyAttachmentSignature(id, expires + 3600, signature)).toBe(false);
    const altered = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    expect(verifyAttachmentSignature(id, expires, altered)).toBe(false);
  });

  it('rejects a link once it has expired', () => {
    const { expires, signature } = parts(signAttachmentUrl(id, Date.now() - 3 * 3600 * 1000));
    expect(verifyAttachmentSignature(id, expires, signature)).toBe(false);
  });

  it('issues the same link throughout an hour, so browsers can cache the image', () => {
    const start = Date.UTC(2026, 0, 1, 10, 0, 5);
    expect(signAttachmentUrl(id, start)).toBe(signAttachmentUrl(id, start + 55 * 60 * 1000));
  });

  it('is always valid for at least an hour after it is issued', () => {
    const lateInWindow = Date.UTC(2026, 0, 1, 10, 59, 59);
    const { expires } = parts(signAttachmentUrl(id, lateInWindow));
    expect(expires * 1000 - lateInWindow).toBeGreaterThanOrEqual(3600 * 1000);
  });
});

describe('image metadata stripping', () => {
  it('removes EXIF, comments and appended data from a JPEG but keeps the image', () => {
    const cleaned = stripJpegMetadata(jpegWithMetadata());
    const text = cleaned.toString('latin1');
    expect(text).toContain('JFIF');
    expect(text).not.toContain('GPS-SECRET');
    expect(text).not.toContain('SECRET-COMMENT');
    expect(text).not.toContain('APPENDED-TRAILER');
    expect(cleaned.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(cleaned.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it('keeps byte stuffing and restart markers inside the compressed data intact', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xdb, Buffer.alloc(65, 1)),
      jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
      Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56, 0xff, 0xd9]),
    ]);
    expect(stripJpegMetadata(jpeg).equals(jpeg)).toBe(true);
  });

  it('removes text and EXIF chunks and appended data from a PNG', () => {
    const text = stripPngMetadata(pngWithMetadata()).toString('latin1');
    expect(text).not.toContain('SECRET-PNG');
    expect(text).not.toContain('APPENDED-PNG-TRAILER');
    expect(text).toContain('IHDR');
    expect(text).toContain('IEND');
  });

  it('leaves a clean PNG byte-for-byte unchanged', () => {
    expect(stripPngMetadata(TINY_PNG).equals(TINY_PNG)).toBe(true);
  });

  it('refuses a truncated file rather than guessing', () => {
    expect(() => stripJpegMetadata(jpegWithMetadata().subarray(0, 40))).toThrow(MalformedImageError);
    expect(() => stripPngMetadata(TINY_PNG.subarray(0, 30))).toThrow(MalformedImageError);
  });
});
