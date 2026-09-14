import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { HelpRequest, Paginated } from '@campusbuddy/shared';
import { CATEGORIES } from '@campusbuddy/shared';
import { api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { usePosition } from '../lib/usePosition';
import { Screen } from '../components/Layout';
import { RequestCard } from '../components/RequestCard';
import { Button, EmptyState, ErrorState, Field, Input, LoadingCards, Sheet } from '../components/ui';

type Sort = 'RECOMMENDED' | 'NEAREST' | 'HIGHEST_REWARD' | 'ENDING_SOON' | 'NEWEST';

const SORTS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: 'RECOMMENDED', label: 'Recommended' },
  { value: 'NEAREST', label: 'Nearest' },
  { value: 'HIGHEST_REWARD', label: 'Highest reward' },
  { value: 'ENDING_SOON', label: 'Ending soon' },
  { value: 'NEWEST', label: 'Newest' },
];

/** Browse open requests with filters and sorting (spec §23). */
export function Discover(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const position = usePosition();

  const category = params.get('category') ?? '';
  const sort = (params.get('sort') as Sort) ?? 'RECOMMENDED';
  const search = params.get('q') ?? '';

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minReward, setMinReward] = useState(params.get('minReward') ?? '');
  const [maxDistance, setMaxDistance] = useState(params.get('maxDistance') ?? '');
  const [urgentOnly, setUrgentOnly] = useState(params.get('urgency') === 'URGENT');
  const [searchDraft, setSearchDraft] = useState(search);

  const queryString = useMemo(
    () =>
      query({
        scope: 'ALL',
        sort,
        categorySlug: category || undefined,
        q: search || undefined,
        minRewardPaise: params.get('minReward') ? Number(params.get('minReward')) * 100 : undefined,
        maxDistanceMetres: params.get('maxDistance') ? Number(params.get('maxDistance')) : undefined,
        urgency: params.get('urgency') || undefined,
        lat: position?.lat,
        lng: position?.lng,
        limit: 20,
      }),
    [sort, category, search, params, position],
  );

  const state = useAsync<Paginated<HelpRequest>>(
    (signal) => api.get<Paginated<HelpRequest>>(`/requests${queryString}`, signal),
    [queryString],
  );

  const update = (changes: Record<string, string | undefined>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const activeFilterCount =
    (params.get('minReward') ? 1 : 0) +
    (params.get('maxDistance') ? 1 : 0) +
    (params.get('urgency') ? 1 : 0);

  return (
    <Screen title="Discover">
      <form
        className="row mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: searchDraft.trim() || undefined });
        }}
      >
        <Input
          type="search"
          placeholder="Search requests…"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          aria-label="Search requests"
        />
        <Button type="button" variant="secondary" onClick={() => setFiltersOpen(true)}>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      </form>

      <div className="chip-scroller mb-3">
        <button
          type="button"
          className={`chip${category === '' ? ' active' : ''}`}
          onClick={() => update({ category: undefined })}
        >
          All
        </button>
        {CATEGORIES.map((item) => (
          <button
            key={item.slug}
            type="button"
            className={`chip${category === item.slug ? ' active' : ''}`}
            onClick={() => update({ category: item.slug })}
          >
            {item.icon} {item.name}
          </button>
        ))}
      </div>

      <div className="chip-scroller mb-4">
        {SORTS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`chip${sort === option.value ? ' active' : ''}`}
            onClick={() => update({ sort: option.value })}
            disabled={option.value === 'NEAREST' && !position}
            title={option.value === 'NEAREST' && !position ? 'Share your location to sort by distance' : undefined}
          >
            {option.label}
          </button>
        ))}
      </div>

      {state.loading && !state.data ? (
        <LoadingCards count={4} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.items.length > 0 ? (
        <div className="stack">
          {state.data.items.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
          {state.data.nextCursor && (
            <LoadMoreButton
              path={`/requests${queryString}&cursor=${encodeURIComponent(state.data.nextCursor)}`}
              onLoaded={(next) =>
                state.setData((current) => {
                  // The feed can shift while the student scrolls; never list a request twice.
                  const seen = new Set((current?.items ?? []).map((item) => item.id));
                  return {
                    items: [...(current?.items ?? []), ...next.items.filter((item) => !seen.has(item.id))],
                    nextCursor: next.nextCursor,
                    total: next.total,
                  };
                })
              }
            />
          )}
        </div>
      ) : (
        <EmptyState
          emoji="🔍"
          title="No requests match"
          message={
            activeFilterCount > 0 || category || search
              ? 'Try widening your filters or clearing the search.'
              : 'Nothing is open on campus right now. Check back shortly.'
          }
          action={
            (activeFilterCount > 0 || category || search) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchDraft('');
                  setMinReward('');
                  setMaxDistance('');
                  setUrgentOnly(false);
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      )}

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <Field label="Minimum reward" hint="Only show requests paying at least this much.">
          <div className="input-prefix">
            <span aria-hidden="true">₹</span>
            <input
              className="input"
              inputMode="numeric"
              value={minReward}
              onChange={(event) => setMinReward(event.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
            />
          </div>
        </Field>

        <Field
          label="Maximum distance"
          hint={position ? 'In metres from where you are now.' : 'Share your location to filter by distance.'}
        >
          <Input
            inputMode="numeric"
            value={maxDistance}
            onChange={(event) => setMaxDistance(event.target.value.replace(/[^0-9]/g, ''))}
            placeholder="2000"
            disabled={!position}
          />
        </Field>

        <label className="row mb-4" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={(event) => setUrgentOnly(event.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          <span>Urgent requests only</span>
        </label>

        <div className="btn-row">
          <Button
            variant="secondary"
            onClick={() => {
              setMinReward('');
              setMaxDistance('');
              setUrgentOnly(false);
              update({ minReward: undefined, maxDistance: undefined, urgency: undefined });
              setFiltersOpen(false);
            }}
          >
            Reset
          </Button>
          <Button
            onClick={() => {
              update({
                minReward: minReward || undefined,
                maxDistance: maxDistance || undefined,
                urgency: urgentOnly ? 'URGENT' : undefined,
              });
              setFiltersOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

/** Fetches the next page, one request at a time, and says so when it fails. */
function LoadMoreButton({
  path,
  onLoaded,
}: {
  path: string;
  onLoaded: (page: Paginated<HelpRequest>) => void;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  function load(): void {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    api
      .get<Paginated<HelpRequest>>(path)
      .then(onLoaded)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  return (
    <>
      {failed && (
        <p className="small muted center">Could not load more requests. Check your connection and try again.</p>
      )}
      <Button variant="secondary" block loading={loading} onClick={load}>
        Load more
      </Button>
    </>
  );
}
