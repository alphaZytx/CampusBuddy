import { Link, useNavigate } from 'react-router-dom';
import type { HelpRequest, LostFoundPost, Paginated } from '@campusbuddy/shared';
import { CATEGORIES, formatINR } from '@campusbuddy/shared';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRealtime } from '../lib/realtime';
import { useAuth } from '../state/auth';
import { Screen } from '../components/Layout';
import { RequestCard } from '../components/RequestCard';
import { Avatar, EmptyState, ErrorState, LoadingCards } from '../components/ui';
import { usePosition } from '../lib/usePosition';

interface HomeData {
  recommended: Paginated<HelpRequest>;
  mine: Paginated<HelpRequest>;
  tasks: Paginated<HelpRequest>;
  earnings: { totalEarnedPaise: number; pendingPaise: number; completedTasks: number };
  lostFound: { posts: LostFoundPost[]; hasMore: boolean };
}

const MOCK_REQUESTS = [
  {
    id: 'mock-1',
    categorySlug: 'quick-delivery',
    urgency: 'NORMAL',
    status: 'OPEN',
    title: 'Need a printout from the library',
    description: 'I need someone to print my lab manual and bring it to Hostel 1. I have the PDF.',
    rewardPaise: 2000,
    productCostPaise: 3000,
    offerCount: 0,
    pickupLocation: { label: 'Central Library' },
    distanceMetres: 450,
    createdAt: new Date().toISOString(),
    requester: {
      id: 'r-1',
      fullName: 'Aarav Patel',
      averageRating: 4.8,
      ratingCount: 12,
    }
  },
  {
    id: 'mock-2',
    categorySlug: 'academic-help',
    urgency: 'URGENT',
    status: 'OPEN',
    title: 'Can someone explain pointer arithmetic in C?',
    description: 'I have a mid-sem exam tomorrow and I am completely stuck on pointers. Need 30 mins of explanation.',
    rewardPaise: 5000,
    productCostPaise: 0,
    offerCount: 1,
    pickupLocation: { label: 'Library Canteen' },
    distanceMetres: 200,
    deadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    requester: {
      id: 'r-2',
      fullName: 'Sneha Sharma',
      averageRating: 5.0,
      ratingCount: 3,
    }
  }
] as unknown as HelpRequest[];


/** The student dashboard: what needs my attention, then what I could pick up. */
export function Home(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const position = usePosition();

  const state = useAsync<HomeData>(
    async (signal) => {
      const coords = query({ lat: position?.lat, lng: position?.lng });
      const suffix = coords ? `&${coords.slice(1)}` : '';
      const [recommended, mine, tasks, earnings, lostFound] = await Promise.all([
        api.get<Paginated<HelpRequest>>(`/requests?scope=RECOMMENDED&limit=5${suffix}`, signal),
        api.get<Paginated<HelpRequest>>('/requests?scope=MINE&limit=5', signal),
        api.get<Paginated<HelpRequest>>('/requests?scope=MY_TASKS&limit=5', signal),
        api.get<HomeData['earnings']>('/users/me/earnings', signal),
        api.get<HomeData['lostFound']>('/lost-found?limit=3', signal),
      ]);
      return { recommended, mine, tasks, earnings, lostFound };
    },
    [position?.lat, position?.lng],
  );

  // New requests and lifecycle changes refresh the dashboard without a manual pull.
  useRealtime(() => state.reload(), {
    channel: user ? `campus:${user.campusId}` : undefined,
  });

  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return (
    <Screen>
      <div className="row row--between mb-4">
        <div>
          <p className="small muted">{greeting()},</p>
          <h1>{firstName}</h1>
        </div>
        <Link to="/profile" aria-label="Your profile">
          {user && <Avatar user={user} />}
        </Link>
      </div>

      <section className="lost-found-spotlight mb-4" aria-labelledby="lost-found-title">
        <Link to="/lost-found" className="lost-found-spotlight__main">
          <span className="lost-found-spotlight__icon" aria-hidden="true">🧭</span>
          <span>
            <span className="row" style={{ gap: 7 }}>
              <strong id="lost-found-title">Campus Lost & Found</strong>
              <span className="live-dot" aria-label="Active" />
            </span>
            <span className="small">
              {state.data?.lostFound.posts.length
                ? `${state.data.lostFound.posts.length}${state.data.lostFound.hasMore ? '+' : ''} active now · `
                : ''}
              See something familiar? Help it find its way home.
            </span>
          </span>
          <span className="lost-found-spotlight__arrow" aria-hidden="true">›</span>
        </Link>
      </section>

      {/* Categories double as the fastest route into creating a request. */}
      <div className="chip-scroller mb-4">
        {CATEGORIES.map((category) => (
          <button
            key={category.slug}
            type="button"
            className="chip"
            onClick={() => navigate(`/discover?category=${category.slug}`)}
          >
            {category.icon} {category.name}
          </button>
        ))}
      </div>

      {state.loading && !state.data ? (
        <LoadingCards />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : (
        <>
          {state.data && state.data.tasks.items.length > 0 && (
            <>
              <div className="section-title">
                <h2>Your active tasks</h2>
                <Link to="/tasks">All tasks</Link>
              </div>
              <div className="stack">
                {state.data.tasks.items.map((request) => (
                  <RequestCard key={request.id} request={request} showStatus />
                ))}
              </div>
            </>
          )}

          {state.data && state.data.mine.items.length > 0 && (
            <>
              <div className="section-title">
                <h2>Your requests</h2>
                <Link to="/tasks?tab=requests">All requests</Link>
              </div>
              <div className="stack">
                {state.data.mine.items.map((request) => (
                  <RequestCard key={request.id} request={request} showStatus />
                ))}
              </div>
            </>
          )}

          <div className="section-title">
            <h2>You could help with</h2>
            <Link to="/discover">Discover</Link>
          </div>

          {state.data && state.data.recommended.items.length > 0 ? (
            <div className="stack">
              {state.data.recommended.items.map((request) => (
                <RequestCard key={request.id} request={request} />
              ))}
            </div>
          ) : (
            <>
              <EmptyState
                emoji="🌤️"
                title="Nothing open right now"
                message="When another student posts a request that suits you, it will appear here. Here are some examples of what you might see:"
              />
              <div className="stack mt-4" style={{ opacity: 0.8, pointerEvents: 'none' }}>
                {MOCK_REQUESTS.map((request) => (
                  <RequestCard key={request.id} request={request} />
                ))}
              </div>
            </>
          )}

          {state.data && state.data.earnings.completedTasks > 0 && (
            <>
              <div className="section-title">
                <h2>Your earnings</h2>
                <Link to="/earnings">Details</Link>
              </div>
              <div className="stat-grid">
                <div className="stat">
                  <div className="value">{formatINR(state.data.earnings.totalEarnedPaise)}</div>
                  <div className="label">Total earned</div>
                </div>
                <div className="stat">
                  <div className="value">{state.data.earnings.completedTasks}</div>
                  <div className="label">Tasks completed</div>
                </div>
                <div className="stat">
                  <div className="value">{formatINR(state.data.earnings.pendingPaise)}</div>
                  <div className="label">Pending</div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <button type="button" className="fab" onClick={() => navigate('/create')}>
        <span aria-hidden="true">＋</span> Create request
      </button>
    </Screen>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
