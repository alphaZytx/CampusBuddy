import { useState } from 'react';
import type { UserRole } from '@campusbuddy/shared';
import { ApiError, api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatINR, relativeTime } from '../lib/format';

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  account_status: string;
  suspension_reason: string | null;
  is_verified: boolean;
  verification_method: string | null;
  average_rating: string | number;
  rating_count: number;
  completed_tasks: number;
  cancelled_tasks: number;
  disputed_tasks: number;
  reliability_score: number;
  total_earned_paise: number;
  department_code: string | null;
  created_at: string;
  last_seen_at: string | null;
}

/** Student management (spec §59). Suspension signs the student out everywhere. */
export function Users({ currentRole }: { currentRole: UserRole }): JSX.Element {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const state = useAsync<{ users: AdminUser[] }>(
    (signal) =>
      api.get<{ users: AdminUser[] }>(
        `/admin/users${query({ q: search || undefined, status: statusFilter || undefined, limit: 100 })}`,
        signal,
      ),
    [search, statusFilter],
  );

  const canModerate = currentRole === 'CAMPUS_ADMIN' || currentRole === 'PLATFORM_ADMIN';

  async function setStatus(user: AdminUser, accountStatus: string): Promise<void> {
    const reason =
      accountStatus === 'SUSPENDED'
        ? window.prompt(`Why is ${user.full_name} being suspended? They will be told this reason.`)
        : null;
    if (accountStatus === 'SUSPENDED' && !reason) return;

    setBusy(user.id);
    setMessage(null);
    try {
      await api.patch(`/admin/users/${user.id}`, { accountStatus, suspensionReason: reason });
      setMessage(
        accountStatus === 'SUSPENDED'
          ? `${user.full_name} has been suspended and signed out.`
          : `${user.full_name} has been reinstated.`,
      );
      state.reload();
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Could not update that student.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Students</h1>
          <p className="muted mt-2">{state.data?.users.length ?? 0} accounts</p>
        </div>
        <div className="row">
          <input
            className="input"
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ minWidth: 240 }}
          />
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DEACTIVATED">Deactivated</option>
          </select>
        </div>
      </div>

      {message && <div className="alert alert--info mb-4">{message}</div>}
      {state.error && <div className="alert alert--error mb-4">{state.error}</div>}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Student</th>
              <th>Department</th>
              <th>Verified</th>
              <th>Reputation</th>
              <th>Tasks</th>
              <th>Earned</th>
              <th>Last seen</th>
              <th>Status</th>
              {canModerate && <th />}
            </tr>
          </thead>
          <tbody>
            {state.data?.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="strong">{user.full_name}</div>
                  <div className="tiny muted">{user.email}</div>
                </td>
                <td>{user.department_code ?? '—'}</td>
                <td>
                  {user.is_verified ? (
                    <span className="badge badge--success">
                      {user.verification_method === 'CAMPUS_LOCATION' ? 'Location' : 'Email'}
                    </span>
                  ) : (
                    <span className="badge badge--warning">No</span>
                  )}
                </td>
                <td>
                  <div>
                    ★ {Number(user.average_rating).toFixed(1)}{' '}
                    <span className="tiny muted">({user.rating_count})</span>
                  </div>
                  <div className="tiny muted">{user.reliability_score}/100 reliability</div>
                </td>
                <td>
                  <div>{user.completed_tasks} done</div>
                  {user.cancelled_tasks > 0 && (
                    <div className="tiny muted">{user.cancelled_tasks} cancelled</div>
                  )}
                  {user.disputed_tasks > 0 && (
                    <div className="tiny" style={{ color: 'var(--danger-text)' }}>
                      {user.disputed_tasks} disputed
                    </div>
                  )}
                </td>
                <td>{formatINR(Number(user.total_earned_paise))}</td>
                <td className="tiny muted">{relativeTime(user.last_seen_at)}</td>
                <td>
                  {user.account_status === 'ACTIVE' ? (
                    <span className="badge badge--success">Active</span>
                  ) : (
                    <>
                      <span className="badge badge--danger">{user.account_status.toLowerCase()}</span>
                      {user.suspension_reason && (
                        <div className="tiny muted mt-2">{user.suspension_reason}</div>
                      )}
                    </>
                  )}
                </td>
                {canModerate && (
                  <td>
                    {user.role === 'STUDENT' &&
                      (user.account_status === 'ACTIVE' ? (
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          disabled={busy === user.id}
                          onClick={() => void setStatus(user, 'SUSPENDED')}
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy === user.id}
                          onClick={() => void setStatus(user, 'ACTIVE')}
                        >
                          Reinstate
                        </button>
                      ))}
                    {user.role !== 'STUDENT' && (
                      <span className="badge badge--accent">{user.role.replace('_', ' ').toLowerCase()}</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {state.data?.users.length === 0 && (
          <div className="empty">
            <h3>No students match</h3>
          </div>
        )}
      </div>
    </>
  );
}
