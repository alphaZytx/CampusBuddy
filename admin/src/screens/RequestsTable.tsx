import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { formatINR, relativeTime } from '../lib/format';

interface AdminRequest {
  id: string;
  title: string;
  status: string;
  category_slug: string;
  reward_paise: number;
  created_at: string;
  requester_name: string;
  helper_name: string | null;
}

/** Recent request activity across the campus. */
export function RequestsTable(): JSX.Element {
  const state = useAsync<{ requests: AdminRequest[] }>(
    (signal) => api.get<{ requests: AdminRequest[] }>('/admin/requests', signal),
    [],
  );

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Requests</h1>
          <p className="muted mt-2">Most recent activity on campus</p>
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
              <th>Request</th>
              <th>Category</th>
              <th>Requester</th>
              <th>Helper</th>
              <th>Reward</th>
              <th>Status</th>
              <th>Posted</th>
            </tr>
          </thead>
          <tbody>
            {state.data?.requests.map((request) => (
              <tr key={request.id}>
                <td className="strong">{request.title}</td>
                <td className="small muted">{request.category_slug.replace(/-/g, ' ')}</td>
                <td>{request.requester_name}</td>
                <td>{request.helper_name ?? '—'}</td>
                <td>{formatINR(Number(request.reward_paise))}</td>
                <td>
                  <span
                    className={`badge badge--${
                      ['RATED', 'PAID'].includes(request.status)
                        ? 'success'
                        : ['DISPUTED', 'CANCELLED', 'EXPIRED'].includes(request.status)
                          ? 'danger'
                          : 'info'
                    }`}
                  >
                    {request.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </td>
                <td className="tiny muted">{relativeTime(request.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
