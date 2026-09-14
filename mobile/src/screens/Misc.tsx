import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Attachment, Dispute, EarningsSummary, Notification, PublicUser } from '@campusbuddy/shared';
import { formatINR } from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRealtime } from '../lib/realtime';
import { relativeTime } from '../lib/format';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Screen, useAppBack } from '../components/Layout';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Stars,
  Textarea,
  Input,
} from '../components/ui';

/** In-app notification centre (spec §32). */
export function Notifications(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const state = useAsync<{ notifications: Notification[]; unreadCount: number }>(
    (signal) => api.get<{ notifications: Notification[]; unreadCount: number }>('/notifications', signal),
    [],
  );

  useRealtime(() => state.reload(), { channel: user ? `user:${user.id}` : undefined });

  function open(notification: Notification): void {
    void api.post(`/notifications/${notification.id}/read`, {}).catch(() => undefined);
    const data = notification.data as { requestId?: string; conversationId?: string; rentalId?: string };
    if (data.conversationId) navigate(`/chat/${data.conversationId}`);
    else if (data.requestId) navigate(`/requests/${data.requestId}`);
    else if (data.rentalId) navigate(`/rentals/${data.rentalId}`);
  }

  return (
    <Screen
      title="Notifications"
      back
      actions={
        state.data && state.data.unreadCount > 0 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              api
                .post('/notifications/read-all', {})
                .then(() => state.reload())
                .catch(() => undefined);
            }}
          >
            Mark all read
          </button>
        ) : undefined
      }
    >
      {state.loading && !state.data ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.notifications.length > 0 ? (
        <div className="card card--pad-0">
          <div className="list">
            {state.data.notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                className={`list-row${notification.readAt ? '' : ' unread'}`}
                onClick={() => open(notification)}
                style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left' }}
              >
                <div className="body">
                  <div className="row row--between">
                    <span className="strong truncate">{notification.title}</span>
                    <span className="tiny subtle">{relativeTime(notification.createdAt)}</span>
                  </div>
                  <div className="small muted">{notification.body}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState emoji="🔔" title="Nothing yet" message="Offers, messages and payment updates land here." />
      )}
    </Screen>
  );
}

/** Earnings dashboard (spec §56). */
export function Earnings(): JSX.Element {
  const state = useAsync<EarningsSummary>((signal) => api.get<EarningsSummary>('/users/me/earnings', signal), []);

  if (state.loading && !state.data) {
    return (
      <Screen title="Earnings" back>
        <div className="skeleton" style={{ height: 200 }} />
      </Screen>
    );
  }
  if (state.error || !state.data) {
    return (
      <Screen title="Earnings" back>
        <ErrorState message={state.error ?? 'Could not load your earnings.'} onRetry={state.reload} />
      </Screen>
    );
  }

  const data = state.data;
  const maxMonth = Math.max(1, ...data.byMonth.map((month) => month.earnedPaise));

  return (
    <Screen title="Earnings" back>
      <div className="card center mb-4">
        <div className="small muted">Total earned</div>
        <div className="reward" style={{ fontSize: 38, justifyContent: 'center' }}>
          {formatINR(data.totalEarnedPaise)}
        </div>
        <div className="small muted mt-2">
          Confirmed by the students who paid you
        </div>
      </div>

      <div className="stat-grid mb-4">
        <div className="stat">
          <div className="value">{data.completedTasks}</div>
          <div className="label">Tasks paid</div>
        </div>
        <div className="stat">
          <div className="value">{formatINR(data.averageRewardPaise)}</div>
          <div className="label">Average</div>
        </div>
        <div className="stat">
          <div className="value">{formatINR(data.thisMonthPaise)}</div>
          <div className="label">This month</div>
        </div>
        <div className="stat">
          <div className="value">{formatINR(data.pendingPaise)}</div>
          <div className="label">Pending</div>
        </div>
      </div>

      {data.pendingPaise > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="Awaiting payment">
            {formatINR(data.pendingPaise)} has been agreed but not yet confirmed as received.
            Remember to confirm in the app once the money actually reaches you.
          </Alert>
        </div>
      )}

      {data.byMonth.length > 0 && (
        <>
          <h2 className="mb-3">By month</h2>
          <div className="card stack">
            {data.byMonth.map((month) => (
              <div key={month.month}>
                <div className="row row--between small mb-2">
                  <span className="muted">
                    {new Date(`${month.month}-01`).toLocaleDateString('en-IN', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="strong">{formatINR(month.earnedPaise)}</span>
                </div>
                {/* A simple proportional bar, labelled by the figure above it. */}
                <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999 }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round((month.earnedPaise / maxMonth) * 100)}%`,
                      background: 'var(--success)',
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

/** Trusted helpers (spec §48). */
export function Favourites(): JSX.Element {
  const state = useAsync<{ helpers: PublicUser[] }>(
    (signal) => api.get<{ helpers: PublicUser[] }>('/users/me/favourites', signal),
    [],
  );

  return (
    <Screen title="Trusted helpers" back>
      <p className="small muted mb-4">
        Only you can see this list. Students are never told they have been added.
      </p>

      {state.loading && !state.data ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.helpers.length > 0 ? (
        <div className="card card--pad-0">
          <div className="list">
            {state.data.helpers.map((helper) => (
              <Link key={helper.id} to={`/users/${helper.id}`} className="list-row">
                <Avatar user={helper} />
                <div className="body">
                  <div className="strong truncate">{helper.fullName}</div>
                  <Stars value={helper.averageRating} count={helper.ratingCount} />
                </div>
                <span className="chevron">›</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          emoji="⭐"
          title="No trusted helpers yet"
          message="Add students you have had a good experience with from their profile."
        />
      )}
    </Screen>
  );
}

/** Raise a dispute about a transaction (spec §62). */
export function CreateDispute(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const subjectType = params.get('subjectType') ?? 'REQUEST';
  const subjectId = params.get('subjectId') ?? '';

  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Attachment | null>(null);

  const reasons = [
    'Item never delivered',
    'Wrong item',
    'Payment problem',
    'Item damaged',
    'Item not returned',
    'Other',
  ];

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { dispute } = await api.post<{ dispute: { id: string } }>('/disputes', {
        subjectType,
        subjectId,
        reason,
        description: description.trim(),
      });
      if (evidence) {
        await api.post(`/disputes/${dispute.id}/evidence`, { attachmentId: evidence.id });
      }
      toast.success('Dispute opened. A moderator will review it.');
      navigate(`/disputes/${dispute.id}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open the dispute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Open a dispute" back>
      <div className="mb-4">
        <Alert tone="warning" title="This freezes the transaction">
          Nothing further can happen on it until a campus moderator reviews what both of you say.
          Try resolving it in the chat first if you can.
        </Alert>
      </div>

      <form onSubmit={submit} noValidate>
        {error && <div className="alert alert--error mb-4">{error}</div>}

        <Field label="What went wrong?">
          <div className="row row--wrap" style={{ gap: 'var(--sp-2)' }}>
            {reasons.map((option) => (
              <button
                key={option}
                type="button"
                className={`chip${reason === option ? ' active' : ''}`}
                onClick={() => setReason(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Explain what happened" hint="Include times and anything you agreed in the chat.">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            minLength={10}
            maxLength={2000}
            required
          />
        </Field>

        <EvidencePicker value={evidence} onChange={setEvidence} purpose="DISPUTE" />

        <Button
          type="submit"
          size="lg"
          block
          variant="danger"
          loading={busy}
          disabled={!reason || description.trim().length < 10}
        >
          Open dispute
        </Button>
      </form>
    </Screen>
  );
}

/** A participant-facing dispute inbox, including evidence from both sides. */
export function Disputes(): JSX.Element {
  const state = useAsync<{ disputes: Dispute[] }>((signal) => api.get<{ disputes: Dispute[] }>('/disputes', signal), []);
  return (
    <Screen title="Disputes" back>
      {state.loading && !state.data ? <div className="skeleton" style={{ height: 180 }} /> : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data?.disputes.length ? (
        <div className="stack">{state.data.disputes.map((dispute) => (
          <Link className="card card-link" to={`/disputes/${dispute.id}`} key={dispute.id}>
            <div className="row row--between"><span className="badge badge--warning">{dispute.status.replace(/_/g, ' ').toLowerCase()}</span><span className="tiny muted">{relativeTime(dispute.createdAt)}</span></div>
            <h3 className="mt-3">{dispute.reason}</h3>
            <p className="small muted mt-2">{dispute.subjectType.toLowerCase()} · {dispute.evidence.length} evidence item{dispute.evidence.length === 1 ? '' : 's'}</p>
          </Link>
        ))}</div>
      ) : <EmptyState emoji="⚖️" title="No disputes" message="Transaction disputes you open or receive will appear here." />}
    </Screen>
  );
}

export function DisputeDetail(): JSX.Element {
  const { id = '' } = useParams();
  const toast = useToast();
  const state = useAsync<{ dispute: Dispute }>((signal) => api.get<{ dispute: Dispute }>(`/disputes/${id}`, signal), [id]);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const dispute = state.data?.dispute;

  async function submitEvidence(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!attachment && !note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/disputes/${id}/evidence`, { attachmentId: attachment?.id ?? null, note: note.trim() || null });
      setAttachment(null);
      setNote('');
      state.reload();
      toast.success('Evidence added for moderator review.');
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not add evidence.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Dispute details" back="/disputes">
      {state.loading && !dispute ? <div className="skeleton" style={{ height: 220 }} /> : state.error || !dispute ? (
        <ErrorState message={state.error ?? 'This dispute is not available.'} onRetry={state.reload} />
      ) : <div className="stack">
        <div className="card stack stack--sm">
          <div className="row row--between"><span className="badge badge--warning">{dispute.status.replace(/_/g, ' ').toLowerCase()}</span><span className="tiny muted">{relativeTime(dispute.createdAt)}</span></div>
          <h2>{dispute.reason}</h2><p className="small">{dispute.description}</p>
          <p className="tiny muted">Opened by {dispute.openedBy.fullName}{dispute.against ? ` · other party ${dispute.against.fullName}` : ''}</p>
          {dispute.resolution && <Alert tone="success" title="Moderator outcome">{dispute.resolution}</Alert>}
        </div>

        <div className="card stack stack--sm"><h2>Evidence from both parties</h2>
          {dispute.evidence.map((item) => <div className="card card--flat" key={item.id}>
            <div className="row row--between"><strong className="small">{item.submittedBy.fullName}</strong><span className="tiny muted">{relativeTime(item.createdAt)}</span></div>
            {item.note && <p className="small mt-2">{item.note}</p>}
            {item.attachment && <a className="btn btn--secondary btn--sm btn--block mt-2" href={item.attachment.url} target="_blank" rel="noreferrer">Open {item.attachment.fileName}</a>}
          </div>)}
          {dispute.evidence.length === 0 && <p className="small muted">No evidence added yet.</p>}
        </div>

        {['OPEN', 'UNDER_REVIEW'].includes(dispute.status) && <form className="card" onSubmit={submitEvidence}>
          <h2 className="mb-3">Add your evidence</h2>
          <Field label="Explanation (optional)"><Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} /></Field>
          <EvidencePicker value={attachment} onChange={setAttachment} purpose="DISPUTE" />
          <Button block type="submit" loading={busy} disabled={!attachment && !note.trim()}>Submit evidence</Button>
        </form>}
      </div>}
    </Screen>
  );
}

/** Report a user, request or listing (spec §61). */
export function CreateReport(): JSX.Element {
  const [params] = useSearchParams();
  const goBack = useAppBack();
  const toast = useToast();
  const targetType = params.get('targetType') ?? 'REQUEST';
  const targetId = params.get('targetId') ?? '';

  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<Attachment | null>(null);

  return (
    <Screen title="Report" back>
      <form
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          setBusy(true);
          try {
            const { report } = await api.post<{ report: { id: string } }>('/reports', {
              targetType,
              targetId,
              reason,
              description: description.trim() || null,
            });
            if (evidence) {
              await api.post(`/reports/${report.id}/evidence`, { attachmentId: evidence.id });
            }
            toast.success('Reported. A moderator will look into it.');
            goBack();
          } catch (cause) {
            toast.error(cause instanceof ApiError ? cause.message : 'Could not send the report.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Reason">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Spam, harassment, scam…" required />
        </Field>
        <Field label="Details (optional)">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
        </Field>
        <EvidencePicker value={evidence} onChange={setEvidence} purpose="REPORT" />
        <Button type="submit" size="lg" block loading={busy} disabled={reason.trim().length < 3}>
          Send report
        </Button>
      </form>
    </Screen>
  );
}

function EvidencePicker({ value, onChange, purpose }: { value: Attachment | null; onChange: (value: Attachment | null) => void; purpose: 'DISPUTE' | 'REPORT' }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  async function upload(file: File): Promise<void> {
    setUploading(true);
    try {
      const { attachment } = await api.upload<{ attachment: Attachment }>(
        `/uploads?purpose=${purpose}`,
        file,
        file.name,
        'POST',
      );
      onChange(attachment);
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not upload that evidence.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field label="Evidence (optional)" hint={purpose === 'REPORT' ? 'Attach a screenshot, photo or PDF. Only you and moderators can access report evidence.' : 'Attach a screenshot, photo or PDF. Only both parties and moderators can access dispute evidence.'}>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      {value ? (
        <div className="row row--between">
          <a href={value.url} target="_blank" rel="noreferrer" className="small strong">{value.fileName}</a>
          <Button size="sm" variant="ghost" type="button" onClick={() => onChange(null)}>Remove</Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" block loading={uploading} onClick={() => input.current?.click()}>
          Attach evidence
        </Button>
      )}
    </Field>
  );
}

export function NotFound(): JSX.Element {
  return (
    <Screen title="Not found" back="/">
      <EmptyState
        emoji="🧭"
        title="Page not found"
        message="That link does not go anywhere."
        action={
          <Link to="/" className="btn">
            Back to home
          </Link>
        }
      />
    </Screen>
  );
}
