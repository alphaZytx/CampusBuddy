import type { PlatformAnalytics } from '@campusbuddy/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatINR, percent } from '../lib/format';

/** Campus analytics (spec §73). */
export function Dashboard(): JSX.Element {
  const state = useAsync<PlatformAnalytics & { suspendedStudents: number }>(
    (signal) => api.get<PlatformAnalytics & { suspendedStudents: number }>('/admin/analytics', signal),
    [],
  );

  if (state.loading && !state.data) return <div className="skeleton" style={{ height: 320 }} />;
  if (state.error || !state.data) {
    return <div className="alert alert--error">{state.error ?? 'Could not load analytics.'}</div>;
  }

  const data = state.data;
  const maxDay = Math.max(1, ...data.requestsByDay.map((day) => day.count));

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted mt-2">NIT Patna · Bihta Campus</p>
        </div>
        <button type="button" className="btn btn--secondary btn--sm" onClick={state.reload}>
          Refresh
        </button>
      </div>

      <div className="stat-grid mb-4">
        <Stat label="Registered students" value={data.registeredStudents} />
        <Stat label="Verified" value={data.verifiedStudents} />
        <Stat label="Active this week" value={data.activeUsers7d} />
        <Stat label="Suspended" value={data.suspendedStudents} />
      </div>

      <div className="stat-grid mb-4">
        <Stat label="Requests created" value={data.requestsCreated} />
        <Stat label="Completed" value={data.requestsCompleted} />
        <Stat label="Completion rate" value={percent(data.completionRate)} />
        <Stat label="Cancellation rate" value={percent(data.cancellationRate)} />
      </div>

      <div className="stat-grid mb-4">
        <Stat label="Average reward" value={formatINR(data.averageRewardPaise)} />
        <Stat
          label="Average completion"
          value={data.averageCompletionMinutes !== null ? `${data.averageCompletionMinutes} min` : '—'}
        />
        <Stat label="Dispute rate" value={percent(data.disputeRate)} />
        <Stat label="Rentals active" value={data.rentalsActive} />
      </div>

      {(data.openReports > 0 || data.openDisputes > 0) && (
        <div className="alert alert--warning mb-4">
          <div>
            <strong>Waiting on you</strong>
            {data.openReports} open report{data.openReports === 1 ? '' : 's'} and{' '}
            {data.openDisputes} open dispute{data.openDisputes === 1 ? '' : 's'}.
          </div>
        </div>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2>Requests per day</h2>
          <p className="small muted mt-2">Last 30 days</p>
          {data.requestsByDay.length === 0 ? (
            <p className="small muted mt-4">No requests yet.</p>
          ) : (
            <>
              <div className="chart">
                {data.requestsByDay.map((day) => (
                  <div
                    key={day.day}
                    className="chart-bar"
                    style={{ height: `${Math.max(3, (day.count / maxDay) * 100)}%` }}
                    title={`${day.day}: ${day.count} request${day.count === 1 ? '' : 's'}`}
                  />
                ))}
              </div>
              <div className="row row--between tiny subtle mt-2">
                <span>{data.requestsByDay[0]?.day}</span>
                <span>{data.requestsByDay[data.requestsByDay.length - 1]?.day}</span>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Popular categories</h2>
          <div className="stack stack--sm mt-4">
            {data.popularCategories.length === 0 && <p className="small muted">No data yet.</p>}
            {data.popularCategories.map((category) => {
              const max = data.popularCategories[0]?.count || 1;
              return (
                <div key={category.categorySlug}>
                  <div className="row row--between small mb-2">
                    <span>{category.categorySlug.replace(/-/g, ' ')}</span>
                    <span className="strong">{category.count}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999 }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${(category.count / max) * 100}%`,
                        background: 'var(--accent)',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
