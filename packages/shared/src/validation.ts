import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  AVAILABILITY_STATES,
  CATEGORY_SLUGS,
  DISPUTE_STATUSES,
  DISPUTE_SUBJECT_TYPES,
  ITEM_CONDITIONS,
  LISTING_TYPES,
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_CLAIM_STATUSES,
  LOST_FOUND_POST_TYPES,
  RENTAL_UNITS,
  REPORT_TARGET_TYPES,
  URGENCY_LEVELS,
  USER_ROLES,
  VISIBILITY_SCOPES,
} from './constants.js';
import {
  MAX_DEPOSIT_PAISE,
  MAX_PRODUCT_COST_PAISE,
  MAX_REWARD_PAISE,
  MIN_REWARD_PAISE,
} from './money.js';
import { UPI_ID_PATTERN } from './upi.js';

/**
 * Shared request validation.
 *
 * The API validates every payload with these schemas, and the web app reuses them
 * for form validation, so client and server can never disagree about what is valid.
 */

export const uuidSchema = z.string().uuid('Must be a valid identifier');

export const paiseSchema = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .int('Amount must be a whole number of paise')
  .nonnegative('Amount cannot be negative');

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const coordinateSchema = z.object({ lat: latitudeSchema, lng: longitudeSchema });

/**
 * Password policy: length is the dominant factor in real-world strength, so we require
 * 10+ characters and a mix, rather than a thicket of rules students will work around.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password is too long')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), 'Include an upper and a lower case letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional(),
  departmentId: uuidSchema.optional(),
  hostelId: uuidSchema.optional(),
  yearOfStudy: z.number().int().min(1).max(5).optional(),
  semester: z.number().int().min(1).max(10).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const requestEmailOtpSchema = z.object({ email: emailSchema.optional() });

export const verifyEmailOtpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const verifyLocationSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
  accuracyMetres: z.number().nonnegative().max(10_000).optional(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.nullish(),
  departmentId: uuidSchema.nullish(),
  hostelId: uuidSchema.nullish(),
  yearOfStudy: z.number().int().min(1).max(5).nullish(),
  semester: z.number().int().min(1).max(10).nullish(),
  bio: z.string().trim().max(500).nullish(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  // The profile photo is set by uploading a file to /users/me/avatar. It is never an
  // arbitrary address, which would let a student make every viewer's browser fetch
  // an external tracking image.
});

export const updatePaymentDetailsSchema = z.object({
  upiId: z.string().trim().regex(UPI_ID_PATTERN, 'Enter a valid UPI ID, e.g. name@bank').nullish(),
  // The payment QR code is uploaded as an image to /users/me/payment-qr.
});

export const updatePreferencesSchema = z.object({
  availability: z.enum(AVAILABILITY_STATES).optional(),
  preferredCategories: z.array(z.enum(CATEGORY_SLUGS as [string, ...string[]])).max(20).optional(),
  minRewardPaise: paiseSchema.max(MAX_REWARD_PAISE).optional(),
  maxDistanceMetres: z.number().int().min(50).max(20_000).optional(),
  availableUntil: z.string().datetime().nullish(),
});

export const notificationPreferencesSchema = z.object({
  newMatchingRequests: z.boolean().optional(),
  offers: z.boolean().optional(),
  chat: z.boolean().optional(),
  payments: z.boolean().optional(),
  ratings: z.boolean().optional(),
  rentals: z.boolean().optional(),
  reminders: z.boolean().optional(),
  lostFound: z.boolean().optional(),
  minRewardPaise: paiseSchema.max(MAX_REWARD_PAISE).optional(),
  maxDistanceMetres: z.number().int().min(50).max(20_000).optional(),
  urgentOnly: z.boolean().optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullish(),
  quietHoursEnd: z.number().int().min(0).max(23).nullish(),
});

const locationInputSchema = z.object({
  label: z.string().trim().min(1, 'Add a location name').max(120),
  lat: latitudeSchema.nullish(),
  lng: longitudeSchema.nullish(),
});

export const createRequestSchema = z
  .object({
    title: z.string().trim().min(4, 'Give your request a clear title').max(120),
    description: z.string().trim().max(2000).default(''),
    categorySlug: z.enum(CATEGORY_SLUGS as [string, ...string[]]),
    subcategory: z.string().trim().max(60).nullish(),
    rewardPaise: paiseSchema
      .min(MIN_REWARD_PAISE, 'Reward must be at least ₹1')
      .max(MAX_REWARD_PAISE, 'Reward is above the platform limit'),
    productCostPaise: paiseSchema.max(MAX_PRODUCT_COST_PAISE).default(0),
    maxRewardPaise: paiseSchema.max(MAX_REWARD_PAISE).nullish(),
    autoEscalate: z.boolean().default(false),
    pickupLocation: locationInputSchema.nullish(),
    deliveryLocation: locationInputSchema.nullish(),
    lat: latitudeSchema.nullish(),
    lng: longitudeSchema.nullish(),
    deadlineAt: z.string().datetime({ message: 'Deadline must be a valid date' }).nullish(),
    scheduledFor: z.string().datetime().nullish(),
    urgency: z.enum(URGENCY_LEVELS).default('NORMAL'),
    visibility: z.enum(VISIBILITY_SCOPES).default('CAMPUS'),
    attachmentIds: z.array(uuidSchema).max(5).default([]),
    invitedHelperIds: z.array(uuidSchema).max(20).default([]),
  })
  .refine((v) => !v.maxRewardPaise || v.maxRewardPaise >= v.rewardPaise, {
    message: 'Maximum reward must be at least the starting reward',
    path: ['maxRewardPaise'],
  })
  .refine((v) => !v.autoEscalate || v.maxRewardPaise != null, {
    message: 'Set a maximum reward before enabling automatic escalation',
    path: ['maxRewardPaise'],
  })
  .refine(
    (v) => !v.scheduledFor || !v.deadlineAt || new Date(v.scheduledFor) < new Date(v.deadlineAt),
    { message: 'The deadline must be after the scheduled time', path: ['deadlineAt'] },
  );

export const updateRequestSchema = z.object({
  title: z.string().trim().min(4).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  subcategory: z.string().trim().max(60).nullish(),
  pickupLocation: locationInputSchema.nullish(),
  deliveryLocation: locationInputSchema.nullish(),
  deadlineAt: z.string().datetime().nullish(),
  urgency: z.enum(URGENCY_LEVELS).optional(),
  visibility: z.enum(VISIBILITY_SCOPES).optional(),
});

export const increaseRewardSchema = z.object({
  rewardPaise: paiseSchema.min(MIN_REWARD_PAISE).max(MAX_REWARD_PAISE),
});

export const cancelRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Tell the other student why').max(500),
});

export const createOfferSchema = z.object({
  offeredRewardPaise: paiseSchema.min(MIN_REWARD_PAISE).max(MAX_REWARD_PAISE).optional(),
  message: z.string().trim().max(500).nullish(),
  etaMinutes: z.number().int().min(1).max(1440).nullish(),
});

export const selectHelperSchema = z.object({ offerId: uuidSchema });

export const completeTaskSchema = z.object({
  note: z.string().trim().max(500).nullish(),
  proofAttachmentId: uuidSchema.nullish(),
});

export const rejectCompletionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const requestFeedQuerySchema = z.object({
  categorySlug: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  minRewardPaise: z.coerce.number().int().nonnegative().optional(),
  maxRewardPaise: z.coerce.number().int().nonnegative().optional(),
  maxDistanceMetres: z.coerce.number().int().min(50).max(50_000).optional(),
  urgency: z.enum(URGENCY_LEVELS).optional(),
  status: z.string().optional(),
  scope: z.enum(['ALL', 'MINE', 'MY_TASKS', 'RECOMMENDED', 'NEARBY', 'ENDING_SOON']).default('ALL'),
  sort: z.enum(['RECOMMENDED', 'NEAREST', 'HIGHEST_REWARD', 'ENDING_SOON', 'NEWEST']).default('RECOMMENDED'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(2000).nullish(),
    attachmentId: uuidSchema.nullish(),
    sharedLat: latitudeSchema.nullish(),
    sharedLng: longitudeSchema.nullish(),
  })
  .refine((v) => v.body || v.attachmentId || (v.sharedLat != null && v.sharedLng != null), {
    message: 'Write a message, attach a file, or share your location',
  });

const starSchema = z.number().int().min(1, 'Choose 1–5 stars').max(5);
const optionalStarSchema = starSchema.nullish();

export const createRatingSchema = z.object({
  stars: starSchema,
  review: z.string().trim().max(1000).nullish(),
  punctuality: optionalStarSchema,
  reliability: optionalStarSchema,
  communication: optionalStarSchema,
  quality: optionalStarSchema,
  clearInstructions: optionalStarSchema,
  paymentReliability: optionalStarSchema,
  respectfulness: optionalStarSchema,
});

export const paymentActionSchema = z.object({
  action: z.enum(['mark_initiated', 'claim_sent', 'confirm_received', 'deny_received', 'dispute']),
  note: z.string().trim().max(500).nullish(),
  transactionReference: z.string().trim().min(4).max(100).nullish(),
  receiptAttachmentId: uuidSchema.nullish(),
});

export const safetyControlSchema = z
  .object({
    blocked: z.boolean().default(false),
    muted: z.boolean().default(false),
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((value) => value.blocked || value.muted, { message: 'Choose block or mute' });

export const pushDeviceSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  deviceName: z.string().trim().max(120).nullish(),
  appVersion: z.string().trim().max(40).nullish(),
});

export const consentSchema = z.object({
  documentType: z.enum(['PRIVACY', 'TERMS', 'COMMUNITY']),
  version: z.string().trim().min(1).max(40),
  accepted: z.literal(true),
});

export const deactivateAccountSchema = z.object({ confirmation: z.literal('DEACTIVATE') });
export const deleteAccountSchema = z.object({ confirmation: z.literal('DELETE MY ACCOUNT') });
export const moderationAppealSchema = z.object({
  moderationActionId: uuidSchema,
  statement: z.string().trim().min(10).max(3000),
});

export const createListingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).default(''),
  categorySlug: z.enum(CATEGORY_SLUGS as [string, ...string[]]),
  listingType: z.enum(LISTING_TYPES),
  pricePaise: paiseSchema.max(MAX_PRODUCT_COST_PAISE).default(0),
  condition: z.enum(ITEM_CONDITIONS),
  pickupZone: z.string().trim().max(120).nullish(),
  imageIds: z.array(uuidSchema).max(6).default([]),
});

export const createLostFoundPostSchema = z.object({
  postType: z.enum(LOST_FOUND_POST_TYPES),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(2000),
  category: z.enum(LOST_FOUND_CATEGORIES),
  color: z.string().trim().max(60).nullish(),
  brand: z.string().trim().max(80).nullish(),
  approximateLocation: z.string().trim().min(2).max(160),
  occurredAt: z.string().datetime(),
  verificationQuestion: z.string().trim().max(300).nullish(),
  imageIds: z.array(uuidSchema).max(5).default([]),
});

export const updateLostFoundPostSchema = createLostFoundPostSchema.partial().omit({ postType: true, imageIds: true });

export const createLostFoundClaimSchema = z.object({
  message: z.string().trim().min(5).max(1000),
  verificationAnswer: z.string().trim().min(2).max(1000),
});

export const updateLostFoundClaimSchema = z.object({
  status: z.enum(LOST_FOUND_CLAIM_STATUSES),
});

export const createRentalItemSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).default(''),
  categorySlug: z.enum(CATEGORY_SLUGS as [string, ...string[]]),
  condition: z.enum(ITEM_CONDITIONS),
  pricePaise: paiseSchema.min(0).max(MAX_PRODUCT_COST_PAISE),
  rentalUnit: z.enum(RENTAL_UNITS),
  depositPaise: paiseSchema.max(MAX_DEPOSIT_PAISE).default(0),
  pickupZone: z.string().trim().max(120).nullish(),
  rules: z.string().trim().max(1000).nullish(),
  imageIds: z.array(uuidSchema).max(6).default([]),
});

export const createRentalRequestSchema = z
  .object({
    itemId: uuidSchema,
    startAt: z.string().datetime(),
    expectedReturnAt: z.string().datetime(),
    message: z.string().trim().max(500).nullish(),
  })
  .refine((v) => new Date(v.expectedReturnAt) > new Date(v.startAt), {
    message: 'The return time must be after the start time',
    path: ['expectedReturnAt'],
  });

export const confirmReturnSchema = z.object({
  depositReturnedPaise: paiseSchema.max(MAX_DEPOSIT_PAISE).optional(),
  damageNote: z.string().trim().max(500).nullish(),
});

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: uuidSchema,
  reason: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).nullish(),
});

export const createDisputeSchema = z.object({
  subjectType: z.enum(DISPUTE_SUBJECT_TYPES),
  subjectId: uuidSchema,
  reason: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10, 'Explain what went wrong').max(2000),
});

export const addDisputeEvidenceSchema = z
  .object({
    note: z.string().trim().max(1000).nullish(),
    attachmentId: uuidSchema.nullish(),
  })
  .refine((v) => v.note || v.attachmentId, { message: 'Add a note or an attachment' });

export const resolveDisputeSchema = z.object({
  status: z.enum(DISPUTE_STATUSES),
  resolution: z.string().trim().min(3).max(2000),
});

export const updateReportSchema = z.object({
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ESCALATED']),
  resolution: z.string().trim().max(2000).nullish(),
});

export const adminUpdateUserSchema = z.object({
  accountStatus: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
  suspensionReason: z.string().trim().max(500).nullish(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type RequestFeedQuery = z.infer<typeof requestFeedQuerySchema>;
export type CreateRatingInput = z.infer<typeof createRatingSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type CreateLostFoundPostInput = z.infer<typeof createLostFoundPostSchema>;
export type CreateLostFoundClaimInput = z.infer<typeof createLostFoundClaimSchema>;
export type CreateRentalItemInput = z.infer<typeof createRentalItemSchema>;
export type CreateRentalRequestInput = z.infer<typeof createRentalRequestSchema>;
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
