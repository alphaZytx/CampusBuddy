import { useSearchParams } from 'react-router-dom';
import type { HelpRequest, Paginated } from '@campusbuddy/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRealtime } from '../lib/realtime';
import { useAuth } from '../state/auth';
import { Screen } from '../components/Layout';
import { RequestCard } from '../components/RequestCard';
import { EmptyState, ErrorState, LoadingCards, Segmented } from '../components/ui';

type Tab = 'tasks' | 'requests' | 'history';

/** Requester and helper dashboards in one place (spec §57, §58). */
export function Tasks(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const tab = (params.get('tab') as Tab) ?? 'tasks';

  const state = useAsync<Paginated<HelpRequest>>(
    (signal) => {
      if (tab === 'requests') return api.get<Paginated<HelpRequest>>('/requests?scope=MINE&limit=30', signal);
      if (tab === 'history') {
        return api.get<Paginated<HelpRequest>>(
          '/requests?scope=MINE&status=RATED,PAID,CANCELLED,EXPIRED&limit=30',
          signal,
        );
      }
      return api.get<Paginated<HelpRequest>>('/requests?scope=MY_TASKS&limit=30', signal);
    },
    [tab],
  );

  useRealtime(() => state.reload(), { channel: user ? `user:${user.id}` : undefined });

  const empty = {
    tasks: {
      emoji: '🤝',
      title: 'No active tasks',
      message: 'Tasks you have taken on will appear here. Browse Discover to find one.',
    },
    requests: {
      emoji: '📝',
      title: 'No open requests',
      message: 'Requests you post will appear here while they are active.',
    },
    history: {
      emoji: '📚',
      title: 'Nothing here yet',
      message: 'Finished and cancelled requests will be listed here.',
    },
  }[tab];

  return (
    <Screen title="Tasks">
      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={(value) => setParams({ tab: value }, { replace: true })}
          options={[
            { value: 'tasks', label: 'Helping' },
            { value: 'requests', label: 'My requests' },
            { value: 'history', label: 'History' },
          ]}
        />
      </div>

      {state.loading && !state.data ? (
        <LoadingCards />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.items.length > 0 ? (
        <div className="stack">
          {state.data.items.map((request) => (
            <RequestCard key={request.id} request={request} showStatus />
          ))}
        </div>
      ) : (
        <EmptyState {...empty} />
      )}
    </Screen>
  );
}
