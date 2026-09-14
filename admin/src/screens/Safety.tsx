import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

interface Signal {
  id: number;
  user_id: string;
  user_name: string | null;
  signal_type: string;
  score: number;
  details: Record<string, unknown>;
  detected_at: string;
}

interface Appeal {
  id: string;
  user_name: string;
  statement: string;
  action_type: string;
  action_reason: string;
  created_at: string;
}

export function Safety(): JSX.Element {
  const state = useAsync<{ signals: Signal[]; appeals: Appeal[] }>(
    (signal) => api.get<{ signals: Signal[]; appeals: Appeal[] }>('/admin/safety', signal),
    [],
  );
  const [message, setMessage] = useState<string | null>(null);

  async function update(path: string, body: unknown): Promise<void> {
    try {
      await api.patch(path, body);
      state.reload();
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Could not update the safety queue.');
    }
  }

  return (
    <>
      <div className="admin-header"><div><h1>Safety queue</h1><p className="muted mt-2">Risk signals and student appeals for human review</p></div><button className="btn btn--secondary btn--sm" onClick={state.reload}>Refresh</button></div>
      {message && <div className="alert alert--error mb-4">{message}</div>}
      {state.loading && !state.data ? <div className="skeleton" style={{ height: 200 }} /> : state.error ? <div className="alert alert--error">{state.error}</div> : (
        <>
          <h2 className="mb-3">Automated signals</h2>
          <div className="stack">
            {state.data?.signals.map((signal) => <div className="card" key={signal.id}>
              <div className="row row--between"><span className="badge badge--warning">Risk {signal.score}</span><span className="small strong">{signal.user_name ?? 'Unknown student'}</span></div>
              <h3 className="mt-3">{signal.signal_type.replace(/_/g, ' ').toLowerCase()}</h3>
              <p className="small muted mt-2">{JSON.stringify(signal.details)}</p>
              <div className="btn-row mt-3"><button className="btn btn--sm" onClick={() => void update(`/admin/safety/signals/${signal.id}`, { status: 'REVIEWED' })}>Reviewed</button><button className="btn btn--ghost btn--sm" onClick={() => void update(`/admin/safety/signals/${signal.id}`, { status: 'DISMISSED' })}>Dismiss</button></div>
            </div>)}
            {state.data?.signals.length === 0 && <div className="empty"><span className="emoji">✅</span><h3>No open risk signals</h3></div>}
          </div>

          <h2 className="mt-4 mb-3">Appeals</h2>
          <div className="stack">
            {state.data?.appeals.map((appeal) => <div className="card" key={appeal.id}>
              <div className="row row--between"><strong>{appeal.user_name}</strong><span className="badge badge--accent">{appeal.action_type.toLowerCase()}</span></div>
              <p className="small muted mt-2">Original action: {appeal.action_reason}</p><p className="small mt-3">{appeal.statement}</p>
              <div className="btn-row mt-3"><button className="btn btn--sm" onClick={() => { const resolution = window.prompt('Why is this appeal upheld?'); if (resolution) void update(`/admin/safety/appeals/${appeal.id}`, { status: 'UPHELD', resolution }); }}>Uphold</button><button className="btn btn--secondary btn--sm" onClick={() => { const resolution = window.prompt('Why is this action overturned?'); if (resolution) void update(`/admin/safety/appeals/${appeal.id}`, { status: 'OVERTURNED', resolution }); }}>Overturn</button></div>
            </div>)}
            {state.data?.appeals.length === 0 && <div className="empty"><span className="emoji">📭</span><h3>No open appeals</h3></div>}
          </div>
        </>
      )}
    </>
  );
}

