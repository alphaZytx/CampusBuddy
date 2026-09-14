import { useState } from 'react';
import { ApiError, api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';

interface Report {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  description: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
  reporter_name: string | null;
  sla_due_at: string;
  escalated_at: string | null;
  evidence: Array<{ id: string; note: string | null; attachment: { url: string; fileName: string } | null }>;
}

const STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ESCALATED'] as const;

/** Report queue (spec §61). */
export function Reports(): JSX.Element {
  const [filter, setFilter] = useState('OPEN');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const state = useAsync<{ reports: Report[] }>(
    (signal) => api.get<{ reports: Report[] }>(`/admin/reports${query({ status: filter || undefined })}`, signal),
    [filter],
  );

  async function resolve(report: Report, status: string): Promise<void> {
    const resolution = window.prompt('Add a short note explaining the outcome:') ?? '';
    setBusy(report.id);
    try {
      await api.patch(`/admin/reports/${report.id}`, { status, resolution: resolution || null });
      setMessage(`Report marked ${status.toLowerCase().replace('_', ' ')}.`);
      state.reload();
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Could not update that report.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Reports</h1>
          <p className="muted mt-2">Content and conduct flagged by students</p>
        </div>
        <select className="select" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ minWidth: 170 }}>
          <option value="">All</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace('_', ' ').toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {message && <div className="alert alert--info mb-4">{message}</div>}
      {state.error && <div className="alert alert--error mb-4">{state.error}</div>}

      {state.loading && !state.data ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : state.data && state.data.reports.length > 0 ? (
        <div className="stack">
          {state.data.reports.map((report) => (
            <div key={report.id} className="card">
              <div className="row row--between mb-3">
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <span className="badge badge--accent">{report.target_type.toLowerCase()}</span>
                  <span
                    className={`badge badge--${report.status === 'OPEN' ? 'warning' : report.status === 'RESOLVED' ? 'success' : 'info'}`}
                  >
                    {report.status.replace('_', ' ').toLowerCase()}
                  </span>
                </div>
                <span className="tiny subtle">{relativeTime(report.created_at)}</span>
              </div>

              <h3>{report.reason}</h3>
              {report.description && <p className="small muted mt-2">{report.description}</p>}
              <p className="tiny subtle mt-3">
                Reported by {report.reporter_name ?? 'a deleted account'} · target {report.target_id.slice(0, 8)}
              </p>
              {['OPEN', 'UNDER_REVIEW', 'ESCALATED'].includes(report.status) && <p className="tiny mt-2" style={{ color: new Date(report.sla_due_at).getTime() <= Date.now() ? 'var(--danger)' : undefined }}>
                Review due {new Date(report.sla_due_at).toLocaleString()}{report.escalated_at ? ' · automatically escalated' : ''}
              </p>}

              {report.evidence.length > 0 && <div className="stack stack--sm mt-3">
                <strong className="small">Supporting evidence</strong>
                {report.evidence.map((item) => <div className="small" key={item.id}>
                  {item.attachment && <a href={item.attachment.url} target="_blank" rel="noreferrer">Open {item.attachment.fileName}</a>}
                  {item.note && <span className="muted"> {item.note}</span>}
                </div>)}
              </div>}

              {report.resolution && (
                <div className="alert alert--success mt-3">
                  <div>
                    <strong>Outcome</strong>
                    {report.resolution}
                  </div>
                </div>
              )}

              {['OPEN', 'UNDER_REVIEW'].includes(report.status) && (
                <div className="btn-row mt-4">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={busy === report.id}
                    onClick={() => void resolve(report, 'UNDER_REVIEW')}
                  >
                    Mark under review
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={busy === report.id}
                    onClick={() => void resolve(report, 'RESOLVED')}
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy === report.id}
                    onClick={() => void resolve(report, 'DISMISSED')}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="emoji">✅</span>
          <h3>Nothing to review</h3>
          <p className="small">No reports match this filter.</p>
        </div>
      )}
    </>
  );
}
