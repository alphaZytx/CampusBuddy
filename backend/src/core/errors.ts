/**
 * A single error type for everything the API can refuse to do.
 *
 * Every failure carries a stable machine-readable `code` that the clients switch on,
 * plus a message written for a student to read. Internal details never leak: an
 * unexpected exception becomes a generic 500 with a correlation id.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static validation(message: string, details?: unknown): ApiError {
    return new ApiError(422, 'VALIDATION_FAILED', message, details);
  }
  static unauthorized(message = 'Sign in to continue.'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this.'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, code = 'CONFLICT'): ApiError {
    return new ApiError(409, code, message);
  }
  static gone(message: string, code = 'GONE'): ApiError {
    return new ApiError(410, code, message);
  }
  static tooManyRequests(message: string, retryAfterSeconds?: number): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message, { retryAfterSeconds });
  }
  static payloadTooLarge(message: string): ApiError {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
  }
  static notVerified(): ApiError {
    return new ApiError(
      403,
      'NOT_VERIFIED',
      'Verify your student account before using this feature.',
    );
  }
  static suspended(reason?: string | null): ApiError {
    return new ApiError(
      403,
      'ACCOUNT_SUSPENDED',
      reason ? `Your account is suspended: ${reason}` : 'Your account is suspended.',
    );
  }
  static internal(message = 'Something went wrong on our side.'): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

/**
 * Translates a PostgreSQL error into the equivalent ApiError.
 *
 * Constraint names carry meaning here: the database is the last line of defence for
 * rules like "one offer per helper", so when it refuses, the user should be told what
 * actually happened rather than seeing a 500.
 */
export function mapDatabaseError(error: unknown): ApiError | null {
  const err = error as { code?: string; constraint?: string; message?: string };
  const constraint = err.constraint ?? '';
  const message = err.message ?? '';

  const constraintMessages: Record<string, [number, string, string]> = {
    request_offers_unique_helper: [409, 'OFFER_EXISTS', 'You have already made an offer on this request.'],
    request_offers_single_accepted: [409, 'HELPER_ALREADY_SELECTED', 'Another helper has already been selected for this request.'],
    ratings_request_unique: [409, 'ALREADY_RATED', 'You have already rated this task.'],
    ratings_rental_unique: [409, 'ALREADY_RATED', 'You have already rated this rental.'],
    ratings_no_self: [400, 'SELF_RATING', 'You cannot rate yourself.'],
    requests_no_self_help: [400, 'SELF_HELP', 'You cannot be the helper on your own request.'],
    rentals_no_self: [400, 'SELF_RENTAL', 'You cannot rent your own item.'],
    rentals_one_active_per_item: [409, 'ITEM_UNAVAILABLE', 'This item is already booked for that period.'],
    payments_request_key: [409, 'PAYMENT_EXISTS', 'A payment already exists for this request.'],
    payments_distinct_parties: [400, 'SELF_PAYMENT', 'You cannot pay yourself.'],
    users_campus_email_key: [409, 'EMAIL_TAKEN', 'An account already exists for this email address.'],
    reports_no_duplicate_open: [409, 'REPORT_EXISTS', 'You have already reported this and it is still being reviewed.'],
    disputes_one_open_per_subject: [409, 'DISPUTE_EXISTS', 'There is already an open dispute for this.'],
    verification_active_email_otp: [409, 'OTP_PENDING', 'A verification code was already sent. Check your email or wait to resend.'],
    favourite_helpers_user_id_helper_id_key: [409, 'ALREADY_FAVOURITE', 'This student is already in your favourites.'],
    requests_reward_within_cap: [400, 'REWARD_ABOVE_CAP', 'The reward cannot exceed the maximum you set.'],
    sessions_token_hash_key: [409, 'SESSION_CONFLICT', 'Please sign in again.'],
  };

  const mapped = constraintMessages[constraint];
  if (mapped) return new ApiError(mapped[0], mapped[1], mapped[2]);

  switch (err.code) {
    case '23505': // unique_violation
      return ApiError.conflict('That already exists.', 'DUPLICATE');
    case '23503': // foreign_key_violation
      return ApiError.badRequest('That referenced item does not exist.');
    case '23514': // check_violation
      return ApiError.badRequest('Those values are not allowed.');
    case '42501': // insufficient_privilege — an RLS policy refused the row
      return ApiError.forbidden('You do not have access to this.');
    default:
      break;
  }

  // A row that violates an RLS WITH CHECK clause is a policy refusal, not a bug.
  if (message.includes('row-level security policy')) {
    return ApiError.forbidden('You do not have permission to do that.');
  }
  // Messages raised by the immutability guard triggers are safe and specific.
  if (
    message.includes('cannot change') ||
    message.includes('cannot be modified') ||
    message.includes('can only be changed') ||
    message.includes('maintained by the server') ||
    message.includes('cannot be moved') ||
    message.includes('verification service only') ||
    message.includes('must be your own upload')
  ) {
    return ApiError.forbidden(message);
  }
  return null;
}
