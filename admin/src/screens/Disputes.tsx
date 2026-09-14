import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';

interface Dispute {
  id: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  description: string;
  status: string;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  opened_by_name: string;
  against_name: string | null;
  sla_due_at: string;
  escalated_at: string | null;
  evidence: Array<{
    id: string;
    note: string | null;
    submitterName: string;
    attachment: { url: string; fileName: string } | null;
  }>;
}

/**
 * Dispute resolution (spec §62).
 *
 * The outcome decides where the frozen request lands: ruling for the helper sends it
 * back to PAYMENT_PENDING so they can still be paid; ruling for the requester
 * cancels it. Both are recorded in the audit log.
 */
export function Disputes(): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const state = useAsync<{ disputes: Dispute[] }>(
    (signal) => api.get<{ disputes: Dispute[] }>('/admin/disputes', signal),
    [],
  );

  async function resolve(dispute: Dispute, status: string, label: string): Promise<void> {
    const resolution = window.prompt(`Explain the outcome. Both students will see this.\n\n${label}`);
    if (!resolution) return;

    setBusy(dispute.id);
    try {
      await api.patch(`/admin/disputes/${dispute.id}`, { status, resolution });
      setMessage('Dispute resolved and both students notified.');
      state.reload();
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Could not resolve that dispute.');
    } finally {
      setBusy(null);
    }
  }

  const open = state.data?.disputes.filter((d) => ['OPEN', 'UNDER_REVIEW'].includes(d.status)) ?? [];
  const closed = state.data?.disputes.filter((d) => !['OPEN', 'UNDER_REVIEW'].includes(d.status)) ?? [];

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Disputes</h1>
          <p className="muted mt-2">{open.length} waiting for a decision</p>
        </div>
        <button type="button" className="btn btn--secondary btn--sm" onClick={state.reload}>
          Refresh
        </button>
      </div>

      {message && <div className="alert alert--info mb-4">{message}</div>}
      {state.error && <div className="alert alert--error mb-4">{state.error}</div>}

      {state.loading && !state.data ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <>
          {open.length === 0 && closed.length === 0 && (
            <div className="empty">
              <span className="emoji">⚖️</span>
              <h3>No disputes</h3>
              <p className="small">Nothing has been escalated.</p>
            </div>
          )}

          <div className="stack">
            {open.map((dispute) => (
              <div key={dispute.id} className="card">
                <div className="row row--between mb-3">
                  <span className="badge badge--danger">{dispute.status.replace('_', ' ').toLowerCase()}</span>
                  <span className="tiny subtle">{relativeTime(dispute.created_at)}</span>
                </div>

                <h3>{dispute.reason}</h3>
                <p className="small mt-2">{dispute.description}</p>

                <div className="row row--between small muted mt-3">
                  <span>
                    <strong>{dispute.opened_by_name}</strong> vs {dispute.against_name ?? 'unknown'}
                  </span>
                  <span>
                    {dispute.subject_type.toLowerCase()} · {dispute.evidence.length} piece
                    {dispute.evidence.length === 1 ? '' : 's'} of evidence
                  </span>
                </div>

                <p
                  className="tiny mt-2"
                  style={{ color: new Date(dispute.sla_due_at).getTime() <= Date.now() ? 'var(--danger)' : undefined }}
                >
                  Decision due {new Date(dispute.sla_due_at).toLocaleString()}
                  {dispute.escalated_at ? ' · automatically escalated' : ''}
                </p>
                {dispute.evidence.length > 0 && (
                  <div className="stack stack--sm mt-3">
                    {dispute.evidence.map((item) => (
                      <div className="small" key={item.id}>
                        <strong>{item.submitterName}:</strong> {item.note ?? ''}
                        {item.attachment && (
                          <> · <a href={item.attachment.url} target="_blank" rel="noreferrer">open {item.attachment.fileName}</a></>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="btn-row mt-4">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={busy === dispute.id}
                    onClick={() => void resolve(dispute, 'RESOLVED_HELPER', 'The helper should be paid.')}
                  >
                    Rule for the helper
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--secondary"
                    disabled={busy === dispute.id}
                    onClick={() =>
                      void resolve(dispute, 'RESOLVED_REQUESTER', 'The request is cancelled in the requester’s favour.')
                    }
                  >
                    Rule for the requester
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    disabled={busy === dispute.id}
                    onClick={() => void resolve(dispute, 'DISMISSED', 'Dismissed without action.')}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>

          {closed.length > 0 && (
            <>
              <h2 className="mt-4 mb-3">Resolved</h2>
              <div className="stack">
                {closed.map((dispute) => (
                  <div key={dispute.id} className="card card--flat">
                    <div className="row row--between">
                      <span className="badge badge--success">
                        {dispute.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <span className="tiny subtle">{relativeTime(dispute.resolved_at)}</span>
                    </div>
                    <div className="strong mt-2">{dispute.reason}</div>
                    {dispute.resolution && <p className="small muted mt-2">{dispute.resolution}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
