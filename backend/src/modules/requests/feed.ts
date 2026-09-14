import type { HelpRequest, Paginated, RequestFeedQuery } from '@campusbuddy/shared';
import { ACTIVE_REQUEST_STATUSES, REQUEST_STATUSES } from '@campusbuddy/shared';
import type { Queryable } from '../../db/client.js';
import { ApiError } from '../../core/errors.js';
import { REQUEST_SELECT } from './sql.js';
import { toHelpRequest, type RequestRow } from './serializer.js';
import type { ViewerContext } from './service.js';

/**
 * Request discovery (spec §17, §23, §47).
 *
 * Filtering and ranking happen in PostgreSQL against indexed columns, and results
 * are paginated — the client never receives the whole table (spec §87, §110).
 *
 * Visibility is *not* enforced here. RLS on `requests` already restricts the rows
 * this query can see at all; the clauses below are about relevance, not security.
 */

interface Cursor {
  offset: number;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor {
  if (!value) return { offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    const offset = Number(parsed.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) return { offset: 0 };
    return { offset };
  } catch {
    return { offset: 0 };
  }
}

/**
 * The "Recommended" ordering.
 *
 * A deliberately readable weighted sum rather than an opaque model: urgency and an
 * approaching deadline lift a request, closer requests rank higher, a bigger reward
 * helps, and freshness breaks ties so the feed keeps moving. It mirrors
 * `scoreRequestForHelper` in the shared package, which is what the API uses when it
 * ranks helpers for a request.
 */
const RECOMMENDED_SCORE = `(
    (CASE WHEN r.urgency = 'URGENT' THEN 0.25 ELSE 0 END)
  + (CASE
       WHEN r.deadline_at IS NULL THEN 0.05
       WHEN r.deadline_at <= now() THEN 0
       WHEN r.deadline_at <= now() + interval '30 minutes'
         THEN 0.25 * (1 - EXTRACT(EPOCH FROM (r.deadline_at - now())) / 1800)
       ELSE 0.05
     END)
  + (CASE
       WHEN $2::double precision IS NULL OR r.approx_lat IS NULL THEN 0.10
       ELSE 0.25 * greatest(0, 1 - haversine_metres($2::double precision, $3::double precision,
                                                    r.approx_lat, r.approx_lng) / 2000.0)
     END)
  + (0.20 * least(1.0, r.reward_paise / 10000.0))
  + (0.10 * greatest(0, 1 - EXTRACT(EPOCH FROM (now() - r.created_at)) / 7200))
)`;

export async function listRequests(
  tx: Queryable,
  viewer: ViewerContext,
  query: RequestFeedQuery,
): Promise<Paginated<HelpRequest>> {
  const conditions: string[] = [];
  // $1..$3 are reserved by REQUEST_SELECT for the viewer and their position.
  const params: unknown[] = [viewer.user.id, viewer.lat, viewer.lng];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  switch (query.scope) {
    case 'MINE':
      conditions.push(`r.requester_id = ${add(viewer.user.id)}`);
      break;
    case 'MY_TASKS':
      conditions.push(`r.selected_helper_id = ${add(viewer.user.id)}`);
      break;
    case 'NEARBY':
      conditions.push(`r.requester_id <> ${add(viewer.user.id)}`);
      conditions.push(`r.status IN ('OPEN','OFFERS_RECEIVED')`);
      conditions.push('r.approx_lat IS NOT NULL');
      break;
    case 'ENDING_SOON':
      conditions.push(`r.requester_id <> ${add(viewer.user.id)}`);
      conditions.push(`r.status IN ('OPEN','OFFERS_RECEIVED')`);
      conditions.push(`r.deadline_at IS NOT NULL AND r.deadline_at > now()`);
      break;
    case 'RECOMMENDED':
    case 'ALL':
    default:
      // The open marketplace: other students' requests that can still be taken.
      conditions.push(`r.requester_id <> ${add(viewer.user.id)}`);
      conditions.push(`r.status IN ('OPEN','OFFERS_RECEIVED')`);
      break;
  }

  // Scheduled requests stay out of the feed until their time arrives (spec §50).
  if (query.scope !== 'MINE') {
    conditions.push('(r.scheduled_for IS NULL OR r.scheduled_for <= now())');
  }
  if (query.scope !== 'MINE' && query.scope !== 'MY_TASKS') {
    conditions.push('NOT app_users_blocked($1::uuid, r.requester_id)');
  }

  if (query.status) {
    const statuses = query.status
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is (typeof REQUEST_STATUSES)[number] =>
        (REQUEST_STATUSES as readonly string[]).includes(s),
      );
    if (statuses.length === 0) throw ApiError.badRequest('Unknown status filter.');
    conditions.push(`r.status = ANY(${add(statuses)}::text[])`);
  } else if (query.scope === 'MINE' || query.scope === 'MY_TASKS') {
    conditions.push(`r.status = ANY(${add([...ACTIVE_REQUEST_STATUSES])}::text[])`);
  }

  if (query.categorySlug) conditions.push(`r.category_slug = ${add(query.categorySlug)}`);
  if (query.urgency) conditions.push(`r.urgency = ${add(query.urgency)}`);
  if (query.minRewardPaise !== undefined) {
    conditions.push(`r.reward_paise >= ${add(query.minRewardPaise)}`);
  }
  if (query.maxRewardPaise !== undefined) {
    conditions.push(`r.reward_paise <= ${add(query.maxRewardPaise)}`);
  }

  if (query.q) {
    // Full-text match on the GIN-indexed title+description, with a prefix fallback so
    // partial words ("cal" → "calculator") still find something.
    const term = add(query.q);
    conditions.push(
      `(to_tsvector('english', r.title || ' ' || r.description) @@ plainto_tsquery('english', ${term})
        OR r.title ILIKE '%' || ${term} || '%')`,
    );
  }

  if (query.maxDistanceMetres !== undefined && viewer.lat !== null && viewer.lng !== null) {
    conditions.push(
      `(r.approx_lat IS NOT NULL AND haversine_metres($2::double precision, $3::double precision,
         r.approx_lat, r.approx_lng) <= ${add(query.maxDistanceMetres)})`,
    );
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderBy = (() => {
    switch (query.sort) {
      case 'NEAREST':
        return viewer.lat === null
          ? 'r.created_at DESC'
          : `haversine_metres($2::double precision, $3::double precision, r.approx_lat, r.approx_lng) ASC NULLS LAST, r.created_at DESC`;
      case 'HIGHEST_REWARD':
        return 'r.reward_paise DESC, r.created_at DESC';
      case 'ENDING_SOON':
        return 'r.deadline_at ASC NULLS LAST, r.created_at DESC';
      case 'NEWEST':
        return 'r.created_at DESC';
      case 'RECOMMENDED':
      default:
        // Urgent first, then the composite score, so a genuinely urgent request is
        // never buried by a slightly better-scoring routine one.
        return `(r.urgency = 'URGENT') DESC, ${RECOMMENDED_SCORE} DESC, r.created_at DESC`;
    }
  })();

  const cursor = decodeCursor(query.cursor);
  const limitParam = add(query.limit + 1); // One extra row tells us whether more exist.
  const offsetParam = add(cursor.offset);

  const { rows } = await tx.query<RequestRow>(
    `${REQUEST_SELECT} ${where} ORDER BY ${orderBy} LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const isStaff = ['MODERATOR', 'CAMPUS_ADMIN', 'PLATFORM_ADMIN'].includes(viewer.user.role);

  return {
    items: page.map((row) => toHelpRequest(row, viewer.user.id, { isStaff })),
    nextCursor: hasMore ? encodeCursor({ offset: cursor.offset + query.limit }) : null,
    total: null,
  };
}
