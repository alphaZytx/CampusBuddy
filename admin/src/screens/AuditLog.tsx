import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { dateTime } from '../lib/format';

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
}

/** Append-only record of privileged actions (spec §88). */
export function AuditLog(): JSX.Element {
  const state = useAsync<{ logs: AuditEntry[] }>(
    (signal) => api.get<{ logs: AuditEntry[] }>('/admin/audit-logs', signal),
    [],
  );

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Audit log</h1>
          <p className="muted mt-2">Every privileged action, in order. Records cannot be edited or deleted.</p>
        </div>
        <button type="button" className="btn btn--secondary btn--sm" onClick={state.reload}>
          Refresh
        </button>
      </div>

      {state.error && <div className="alert alert--error mb-4">{state.error}</div>}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {state.data?.logs.map((entry) => (
              <tr key={entry.id}>
                <td className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  {dateTime(entry.created_at)}
                </td>
                <td>
                  <div className="small">{entry.actor_name ?? 'System'}</div>
                  <div className="tiny muted">{entry.actor_role?.toLowerCase()}</div>
                </td>
                <td>
                  <span className="badge badge--accent">{entry.action}</span>
                </td>
                <td className="tiny muted">
                  {entry.entity_type}
                  {entry.entity_id ? ` · ${entry.entity_id.slice(0, 8)}` : ''}
                </td>
                <td className="tiny muted" style={{ maxWidth: 280 }}>
                  {Object.entries(entry.metadata ?? {})
                    .filter(([, value]) => value !== null && value !== undefined)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {state.data?.logs.length === 0 && (
          <div className="empty">
            <h3>No admin actions yet</h3>
          </div>
        )}
      </div>
    </>
  );
}
