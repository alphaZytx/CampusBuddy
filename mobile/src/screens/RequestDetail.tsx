import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { HelpRequest, RequestOffer } from '@campusbuddy/shared';
import { findCategory, formatINR, rupeesToPaise } from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRealtime } from '../lib/realtime';
import { countdown, formatDistance, relativeTime, ACTION_LABEL } from '../lib/format';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Screen } from '../components/Layout';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Field,
  RupeeInput,
  Sheet,
  StatusPill,
  Stars,
  Textarea,
  VerifiedBadge,
} from '../components/ui';
import { PaymentPanel } from './PaymentPanel';
import { RatingSheet } from './RatingSheet';

/**
 * Request detail (spec §81).
 *
 * The buttons shown here come straight from `availableActions`, which the server
 * derives from the state machine — so the UI can never offer something the API
 * would reject, and never hides something that is genuinely allowed.
 */
export function RequestDetail(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const state = useAsync<{ request: HelpRequest }>(
    (signal) => api.get<{ request: HelpRequest }>(`/requests/${id}`, signal),
    [id],
  );
  const request = state.data?.request;

  const [sheet, setSheet] = useState<null | 'offer' | 'reward' | 'cancel' | 'reject' | 'rate' | 'offers'>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Live updates for the two participants and anyone watching this request.
  useRealtime(() => state.reload(), { channel: `request:${id}` });

  async function act(path: string, body: unknown, successMessage: string): Promise<void> {
    setBusy(path);
    try {
      await api.post(`/requests/${id}/${path}`, body);
      toast.success(successMessage);
      setSheet(null);
      state.reload();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'That did not work. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (state.loading && !request) {
    return (
      <Screen title="Request" back>
        <div className="skeleton" style={{ height: 220 }} />
      </Screen>
    );
  }
  if (state.error || !request) {
    return (
      <Screen title="Request" back>
        <ErrorState message={state.error ?? 'This request is not available.'} onRetry={state.reload} />
      </Screen>
    );
  }

  const category = findCategory(request.categorySlug);
  const deadline = countdown(request.deadlineAt);
  const isRequester = request.requester.id === user?.id;
  const isHelper = request.selectedHelper?.id === user?.id;
  const can = (action: string): boolean => request.availableActions.includes(action);

  return (
    <Screen title={category?.name ?? 'Request'} back>
      <div className="stack">
        {/* --- Header ---------------------------------------------------- */}
        <div className="card stack">
          <div className="row row--between row--wrap" style={{ gap: 'var(--sp-2)' }}>
            <StatusPill status={request.status} />
            {request.urgency === 'URGENT' && <span className="badge badge--warning">Urgent</span>}
          </div>

          <h1>{request.title}</h1>
          {request.description && <p className="muted">{request.description}</p>}

          {request.attachments.length > 0 && (
            <div className="request-photo-grid" aria-label="Request photos">
              {request.attachments.map((attachment) => (
                <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                  <img src={attachment.url} alt={attachment.fileName} />
                </a>
              ))}
            </div>
          )}

          <div className="row row--between row--wrap">
            <div>
              <div className="reward" style={{ fontSize: 26 }}>
                {formatINR(request.rewardPaise)}
              </div>
              <div className="tiny muted">Helper reward</div>
            </div>
            {request.productCostPaise > 0 && (
              <div>
                <div className="strong" style={{ fontSize: 18 }}>
                  {formatINR(request.productCostPaise)}
                </div>
                <div className="tiny muted">Item cost</div>
              </div>
            )}
            <div>
              <div className="strong" style={{ fontSize: 18 }}>
                {formatINR(request.totalBudgetPaise)}
              </div>
              <div className="tiny muted">Total</div>
            </div>
          </div>

          <div className="divider" style={{ margin: 0 }} />

          <div className="stack stack--sm small">
            {request.pickupLocation && (
              <div className="row">
                <span aria-hidden="true">📍</span>
                <span className="muted">Pick up from</span>
                <span className="spacer" />
                <span className="strong">{request.pickupLocation.label}</span>
              </div>
            )}
            {request.deliveryLocation && (
              <div className="row">
                <span aria-hidden="true">🏁</span>
                <span className="muted">Deliver to</span>
                <span className="spacer" />
                <span className="strong">{request.deliveryLocation.label}</span>
              </div>
            )}
            {request.distanceMetres !== null && (
              <div className="row">
                <span aria-hidden="true">↔</span>
                <span className="muted">Distance</span>
                <span className="spacer" />
                <span className="strong">{formatDistance(request.distanceMetres)}</span>
              </div>
            )}
            <div className="row">
              <span aria-hidden="true">⏱</span>
              <span className="muted">Deadline</span>
              <span className="spacer" />
              <span className={`strong${deadline.urgent ? ' ' : ''}`} style={deadline.urgent ? { color: 'var(--warning-text)' } : undefined}>
                {deadline.text}
              </span>
            </div>
            <div className="row">
              <span aria-hidden="true">🕐</span>
              <span className="muted">Posted</span>
              <span className="spacer" />
              <span>{relativeTime(request.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* --- Requester ------------------------------------------------- */}
        <Link to={`/users/${request.requester.id}`} className="card card-link">
          <div className="row">
            <Avatar user={request.requester} />
            <div className="body" style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                <span className="strong truncate">{request.requester.fullName}</span>
                {request.requester.isVerified && <VerifiedBadge method={request.requester.verificationMethod} />}
              </div>
              <Stars value={request.requester.averageRating} count={request.requester.ratingCount} />
              <div className="tiny muted mt-2">
                {request.requester.departmentCode ?? 'Student'}
                {request.requester.yearOfStudy ? ` · Year ${request.requester.yearOfStudy}` : ''}
                {' · '}
                {request.requester.completedTasks} tasks completed
              </div>
            </div>
            <span className="chevron subtle">›</span>
          </div>
        </Link>

        {/* --- Selected helper ------------------------------------------- */}
        {request.selectedHelper && (
          <div className="card">
            <div className="small muted mb-3">Helper</div>
            <Link to={`/users/${request.selectedHelper.id}`} className="row" style={{ color: 'inherit' }}>
              <Avatar user={request.selectedHelper} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="strong truncate">{request.selectedHelper.fullName}</div>
                <Stars value={request.selectedHelper.averageRating} count={request.selectedHelper.ratingCount} />
              </div>
              <span className="chevron subtle">›</span>
            </Link>
          </div>
        )}

        {/* --- Completion note ------------------------------------------ */}
        {request.completionNote && (
          <Alert tone="info" title="Note from the helper">
            {request.completionNote}
          </Alert>
        )}
        {request.cancellationReason && (
          <Alert tone="error" title="Cancelled">
            {request.cancellationReason}
          </Alert>
        )}

        {/* --- Payment --------------------------------------------------- */}
        {request.payment && (isRequester || isHelper) && (
          <PaymentPanel
            payment={request.payment}
            isPayer={request.payment.payerId === user?.id}
            onChanged={state.reload}
          />
        )}

        {/* --- Offers (requester's view) --------------------------------- */}
        {isRequester && request.offerCount > 0 && ['OPEN', 'OFFERS_RECEIVED'].includes(request.status) && (
          // Keyed on the count so a newly arrived (or withdrawn) offer is fetched, not
          // just counted: the list otherwise loads once and goes stale.
          <OfferList key={request.offerCount} requestId={request.id} onSelected={state.reload} />
        )}

        {/* --- Actions --------------------------------------------------- */}
        <div className="stack stack--sm">
          {can('make_offer') && (
            <Button size="lg" block onClick={() => setSheet('offer')}>
              {ACTION_LABEL.make_offer} · {formatINR(request.rewardPaise)}
            </Button>
          )}
          {can('withdraw_offer') && request.myOffer && (
            <Button
              variant="secondary"
              block
              loading={busy === 'withdraw-offer'}
              onClick={() => {
                setBusy('withdraw-offer');
                api
                  .post(`/requests/${id}/offers/${request.myOffer!.id}/withdraw`, {})
                  .then(() => {
                    toast.success('Offer withdrawn.');
                    state.reload();
                  })
                  .catch((cause: unknown) =>
                    toast.error(cause instanceof ApiError ? cause.message : 'Could not withdraw.'),
                  )
                  .finally(() => setBusy(null));
              }}
            >
              {ACTION_LABEL.withdraw_offer}
            </Button>
          )}

          {can('accept') && (
            <Button size="lg" block loading={busy === 'accept'} onClick={() => void act('accept', {}, 'Task accepted.')}>
              {ACTION_LABEL.accept}
            </Button>
          )}
          {can('start') && (
            <Button size="lg" block loading={busy === 'start'} onClick={() => void act('start', {}, 'Task started.')}>
              {ACTION_LABEL.start}
            </Button>
          )}
          {can('complete') && (
            <Button
              size="lg"
              block
              variant="success"
              loading={busy === 'complete'}
              onClick={() => void act('complete', {}, 'Marked as completed. Waiting for confirmation.')}
            >
              {ACTION_LABEL.complete}
            </Button>
          )}
          {can('confirm_completion') && (
            <Button
              size="lg"
              block
              variant="success"
              loading={busy === 'confirm'}
              onClick={() => void act('confirm', {}, 'Confirmed. You can now pay the helper.')}
            >
              {ACTION_LABEL.confirm_completion}
            </Button>
          )}
          {can('reject_completion') && (
            <Button variant="secondary" block onClick={() => setSheet('reject')}>
              {ACTION_LABEL.reject_completion}
            </Button>
          )}
          {can('resume') && (
            <Button block loading={busy === 'resume'} onClick={() => void act('resume', {}, 'Back in progress.')}>
              {ACTION_LABEL.resume}
            </Button>
          )}
          {can('rate') && (
            <Button size="lg" block onClick={() => setSheet('rate')}>
              {ACTION_LABEL.rate}
            </Button>
          )}
          {can('open_chat') && (
            <Button variant="secondary" block onClick={() => navigate(`/chat/request/${request.id}`)}>
              💬 {ACTION_LABEL.open_chat}
            </Button>
          )}
          {can('increase_reward') && (
            <Button variant="secondary" block onClick={() => setSheet('reward')}>
              {ACTION_LABEL.increase_reward}
            </Button>
          )}
          {can('decline_selection') && (
            <Button
              variant="secondary"
              block
              loading={busy === 'decline-selection'}
              onClick={() => void act('decline-selection', {}, 'You declined this task.')}
            >
              {ACTION_LABEL.decline_selection}
            </Button>
          )}
          {can('withdraw') && (
            <Button
              variant="danger"
              block
              loading={busy === 'withdraw'}
              onClick={() => void act('withdraw', {}, 'You withdrew from this task.')}
            >
              {ACTION_LABEL.withdraw}
            </Button>
          )}
          {can('reopen') && (
            <Button block loading={busy === 'reopen'} onClick={() => void act('reopen', {}, 'Request reopened.')}>
              {ACTION_LABEL.reopen}
            </Button>
          )}
          {can('cancel') && (
            <Button variant="ghost" block onClick={() => setSheet('cancel')}>
              {ACTION_LABEL.cancel}
            </Button>
          )}
          {can('open_dispute') && (
            <Button
              variant="ghost"
              block
              onClick={() => navigate(`/disputes/new?subjectType=REQUEST&subjectId=${request.id}`)}
            >
              {ACTION_LABEL.open_dispute}
            </Button>
          )}
        </div>

        {request.availableActions.length === 0 && (
          <p className="small muted center">No actions are available at this stage.</p>
        )}
      </div>

      {/* --- Sheets ------------------------------------------------------ */}
      {/* Keyed on the reward so the suggested amounts follow it when it changes. */}
      <OfferSheet
        key={`offer-${request.rewardPaise}`}
        open={sheet === 'offer'}
        onClose={() => setSheet(null)}
        listedRewardPaise={request.rewardPaise}
        busy={busy === 'offers'}
        onSubmit={(rewardPaise, message, etaMinutes) =>
          act('offers', { offeredRewardPaise: rewardPaise, message, etaMinutes }, 'Offer sent.')
        }
      />

      <ReasonSheet
        open={sheet === 'cancel'}
        onClose={() => setSheet(null)}
        title="Cancel this request"
        description="The other student will be told why."
        confirmLabel="Cancel request"
        danger
        busy={busy === 'cancel'}
        onSubmit={(reason) => act('cancel', { reason }, 'Request cancelled.')}
      />

      <ReasonSheet
        open={sheet === 'reject'}
        onClose={() => setSheet(null)}
        title="Task not completed"
        description="Tell the helper what is missing. They can try again, or either of you can open a dispute."
        confirmLabel="Send"
        busy={busy === 'reject'}
        onSubmit={(reason) => act('reject', { reason }, 'The helper has been told.')}
      />

      <RewardSheet
        open={sheet === 'reward'}
        onClose={() => setSheet(null)}
        currentPaise={request.rewardPaise}
        maxPaise={request.maxRewardPaise}
        busy={busy === 'reward'}
        onSubmit={(rewardPaise) => act('reward', { rewardPaise }, 'Reward increased.')}
      />

      <RatingSheet
        open={sheet === 'rate'}
        onClose={() => setSheet(null)}
        requestId={request.id}
        ratingHelper={isRequester}
        counterpartyName={
          (isRequester ? request.selectedHelper?.fullName : request.requester.fullName) ?? 'the other student'
        }
        onDone={() => {
          setSheet(null);
          state.reload();
        }}
      />
    </Screen>
  );
}

/** Offers on your own request, ranked with the best match first (spec §25). */
function OfferList({ requestId, onSelected }: { requestId: string; onSelected: () => void }): JSX.Element {
  const toast = useToast();
  const [choosing, setChoosing] = useState<string | null>(null);
  const state = useAsync<{ offers: RequestOffer[] }>(
    (signal) => api.get<{ offers: RequestOffer[] }>(`/requests/${requestId}/offers`, signal),
    [requestId],
  );

  async function select(offerId: string): Promise<void> {
    setChoosing(offerId);
    try {
      await api.post(`/requests/${requestId}/select-helper`, { offerId });
      toast.success('Helper selected. Your chat is now open.');
      onSelected();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not select that helper.');
    } finally {
      setChoosing(null);
    }
  }

  const offers = state.data?.offers.filter((offer) => offer.status === 'PENDING') ?? [];
  if (state.loading) return <div className="skeleton" style={{ height: 100 }} />;
  if (offers.length === 0) {
    return <EmptyState emoji="⏳" title="No offers yet" message="Students nearby have been notified." />;
  }

  return (
    <div className="card card--pad-0">
      <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-2)' }}>
        <h2>{offers.length} offer{offers.length === 1 ? '' : 's'}</h2>
        <p className="small muted mt-2">Choose one. The others are told automatically.</p>
      </div>
      <div className="list">
        {offers.map((offer) => (
          <div key={offer.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <Avatar user={offer.helper} />
            <div className="body">
              <Link to={`/users/${offer.helper.id}`} className="strong" style={{ color: 'inherit' }}>
                {offer.helper.fullName}
              </Link>
              <Stars value={offer.helper.averageRating} count={offer.helper.ratingCount} />
              <div className="tiny muted mt-2">
                {offer.helper.completedTasks} tasks
                {offer.etaMinutes ? ` · about ${offer.etaMinutes} min away` : ''}
                {offer.distanceMetres !== null ? ` · ${formatDistance(offer.distanceMetres)}` : ''}
              </div>
              {offer.message && <p className="small mt-2">“{offer.message}”</p>}
              <div className="row mt-3">
                <span className="reward" style={{ fontSize: 16 }}>
                  {formatINR(offer.offeredRewardPaise)}
                </span>
                <span className="spacer" />
                <Button size="sm" loading={choosing === offer.id} onClick={() => void select(offer.id)}>
                  Choose
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OfferSheet({
  open,
  onClose,
  listedRewardPaise,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  listedRewardPaise: number;
  busy: boolean;
  onSubmit: (rewardPaise: number, message: string | null, etaMinutes: number | null) => void;
}): JSX.Element {
  const [amount, setAmount] = useState(String(Math.round(listedRewardPaise / 100)));
  const [message, setMessage] = useState('');
  const [eta, setEta] = useState('');

  return (
    <Sheet open={open} onClose={onClose} title="Offer to help">
      <Field label="Your price" hint={`The student asked for ${formatINR(listedRewardPaise)}. You can accept that or propose another amount.`}>
        <RupeeInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="How long will you take? (optional)">
        <div className="chip-scroller">
          {[5, 10, 15, 30, 60].map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={`chip${eta === String(minutes) ? ' active' : ''}`}
              onClick={() => setEta(String(minutes))}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </Field>
      <Field label="Message (optional)">
        <Textarea
          placeholder="I am already heading to the canteen."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={500}
        />
      </Field>
      <Button
        size="lg"
        block
        loading={busy}
        disabled={!amount || Number(amount) < 1}
        onClick={() => onSubmit(rupeesToPaise(Number(amount)), message.trim() || null, eta ? Number(eta) : null)}
      >
        Send offer
      </Button>
    </Sheet>
  );
}

function RewardSheet({
  open,
  onClose,
  currentPaise,
  maxPaise,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  currentPaise: number;
  maxPaise: number | null;
  busy: boolean;
  onSubmit: (rewardPaise: number) => void;
}): JSX.Element {
  const suggestions = [10, 20, 30].map((step) => currentPaise + step * 100);
  const [amount, setAmount] = useState(String(Math.round(suggestions[0] / 100)));

  return (
    <Sheet open={open} onClose={onClose} title="Increase the reward">
      <p className="small muted mb-4">
        Currently {formatINR(currentPaise)}. Everyone who already offered will be told it went up.
        {maxPaise !== null && ` Your maximum is ${formatINR(maxPaise)}.`}
      </p>
      <div className="chip-scroller mb-4">
        {suggestions.map((value) => (
          <button
            key={value}
            type="button"
            className={`chip${amount === String(Math.round(value / 100)) ? ' active' : ''}`}
            onClick={() => setAmount(String(Math.round(value / 100)))}
            disabled={maxPaise !== null && value > maxPaise}
          >
            {formatINR(value)}
          </button>
        ))}
      </div>
      <Field label="New reward">
        <RupeeInput value={amount} onChange={setAmount} />
      </Field>
      <Button
        size="lg"
        block
        loading={busy}
        disabled={!amount || rupeesToPaise(Number(amount)) <= currentPaise}
        onClick={() => onSubmit(rupeesToPaise(Number(amount)))}
      >
        Increase to ₹{amount || '0'}
      </Button>
    </Sheet>
  );
}

function ReasonSheet({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onSubmit: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="small muted mb-4">{description}</p>
      <Field label="Reason">
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </Field>
      <Button
        size="lg"
        block
        variant={danger ? 'danger' : 'primary'}
        loading={busy}
        disabled={reason.trim().length < 3}
        onClick={() => onSubmit(reason.trim())}
      >
        {confirmLabel}
      </Button>
    </Sheet>
  );
}
