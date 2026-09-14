import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

interface OperationsData {
  driver: string;
  outbox: { pending: number; failed: number; oldest: string | null };
  jobs: { ready: number; failed: number };
  failures: Array<{ id: number; topic: string; attempts: number; last_error: string | null; failed_at: string }>;
}

export function Operations(): JSX.Element {
  const state = useAsync<OperationsData>((signal) => api.get<OperationsData>('/admin/operations', signal), []);

  async function retry(id: number): Promise<void> {
    try {
      await api.post(`/admin/operations/outbox/${id}/retry`, {});
      state.reload();
    } catch (cause) {
      window.alert(cause instanceof ApiError ? cause.message : 'Could not retry that delivery.');
    }
  }

  if (state.loading && !state.data) return <div className="skeleton" style={{ height: 260 }} />;
  if (state.error || !state.data) return <div className="alert alert--error">{state.error ?? 'Could not load operations.'}</div>;
  const data = state.data;
  return (
    <>
      <div className="admin-header">
        <div><h1>Operations</h1><p className="muted mt-2">Durable jobs and notification delivery · {data.driver}</p></div>
        <button className="btn btn--secondary btn--sm" onClick={state.reload}>Refresh</button>
      </div>
      <div className="stat-grid mb-4">
        <div className="stat"><div className="value">{data.outbox.pending}</div><div className="label">Push pending</div></div>
        <div className="stat"><div className="value">{data.outbox.failed}</div><div className="label">Push dead-lettered</div></div>
        <div className="stat"><div className="value">{data.jobs.ready}</div><div className="label">Jobs ready</div></div>
        <div className="stat"><div className="value">{data.jobs.failed}</div><div className="label">Jobs failed</div></div>
      </div>
      {data.outbox.oldest && <div className="alert alert--warning mb-4">Oldest pending delivery: {new Date(data.outbox.oldest).toLocaleString()}</div>}
      <h2 className="mb-3">Dead-letter queue</h2>
      <div className="stack">
        {data.failures.map((failure) => (
          <div className="card" key={failure.id}>
            <div className="row row--between"><strong>{failure.topic}</strong><span className="badge badge--warning">{failure.attempts} attempts</span></div>
            <p className="small muted mt-2">{failure.last_error ?? 'No error detail'} · {new Date(failure.failed_at).toLocaleString()}</p>
            <button className="btn btn--sm mt-3" onClick={() => void retry(failure.id)}>Retry safely</button>
          </div>
        ))}
        {data.failures.length === 0 && <div className="empty"><span className="emoji">✅</span><h3>No failed deliveries</h3></div>}
      </div>
    </>
  );
}
