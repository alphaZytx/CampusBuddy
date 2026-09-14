import { Link } from 'react-router-dom';
import type { HelpRequest } from '@campusbuddy/shared';
import { findCategory } from '@campusbuddy/shared';
import { countdown, formatDistance, formatINR, relativeTime } from '../lib/format';
import { Avatar, StatusPill, Stars } from './ui';

/**
 * The request card (spec §80).
 *
 * Everything a helper needs to decide in one glance: what, how much, how far,
 * how long is left, and who is asking.
 */
export function RequestCard({
  request,
  showStatus = false,
}: {
  request: HelpRequest;
  showStatus?: boolean;
}): JSX.Element {
  const category = findCategory(request.categorySlug);
  const deadline = countdown(request.deadlineAt);
  const isUrgent = request.urgency === 'URGENT';

  return (
    <Link
      to={`/requests/${request.id}`}
      className={`card card-link request-card${isUrgent ? ' urgent-stripe' : ''}`}
    >
      <div className="row row--between" style={{ gap: 'var(--sp-2)' }}>
        <span className="badge badge--accent">
          {category?.icon} {category?.name ?? request.categorySlug}
        </span>
        {isUrgent && <span className="badge badge--warning">Urgent</span>}
        {showStatus && <StatusPill status={request.status} />}
      </div>

      <div>
        <h3 className="clamp-2">{request.title}</h3>
        {request.description && (
          <p className="small muted clamp-2 mt-2">{request.description}</p>
        )}
      </div>

      <div className="row row--between">
        <span className="reward">
          {formatINR(request.rewardPaise)}
          {request.productCostPaise > 0 && <small>+ {formatINR(request.productCostPaise)} cost</small>}
        </span>
        {request.offerCount > 0 && (
          <span className="badge">
            {request.offerCount} offer{request.offerCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="meta">
        {request.pickupLocation && <span>📍 {request.pickupLocation.label}</span>}
        {request.distanceMetres !== null && <span>↔ {formatDistance(request.distanceMetres)}</span>}
        {request.deadlineAt && (
          <span style={deadline.urgent ? { color: 'var(--warning-text)', fontWeight: 600 } : undefined}>
            ⏱ {deadline.text}
          </span>
        )}
        {!request.deadlineAt && <span>⏱ {relativeTime(request.createdAt)}</span>}
      </div>

      <div className="divider" style={{ margin: 0 }} />

      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <Avatar user={request.requester} size="sm" />
        <div className="body" style={{ minWidth: 0, flex: 1 }}>
          <div className="small strong truncate">{request.requester.fullName}</div>
          <Stars value={request.requester.averageRating} count={request.requester.ratingCount} />
        </div>
        {request.myOffer && request.myOffer.status === 'PENDING' && (
          <span className="badge badge--info">Offer sent</span>
        )}
      </div>
    </Link>
  );
}
