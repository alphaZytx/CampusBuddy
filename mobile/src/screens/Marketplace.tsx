import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Listing } from '@campusbuddy/shared';
import { ITEM_CONDITIONS, LISTING_TYPES, MAX_REWARD_PAISE, formatINR, rupeesToPaise } from '@campusbuddy/shared';
import { ApiError, api, query } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Screen } from '../components/Layout';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingCards,
  RupeeInput,
  Stars,
  Textarea,
} from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  SELL: 'For sale',
  RENT: 'For rent',
  EXCHANGE: 'Exchange',
  GIVEAWAY: 'Free',
};

const CONDITION_LABEL: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Well used',
};

/** Student marketplace (spec §43). */
export function Marketplace(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const type = params.get('type') ?? '';
  const search = params.get('q') ?? '';
  const [draft, setDraft] = useState(search);

  const state = useAsync<{ listings: Listing[]; hasMore: boolean }>(
    (signal) =>
      api.get<{ listings: Listing[]; hasMore: boolean }>(
        `/listings${query({ listingType: type || undefined, q: search || undefined, limit: 30 })}`,
        signal,
      ),
    [type, search],
  );

  return (
    <Screen title="Marketplace" back="/discover">
      <form
        className="mb-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const next = new URLSearchParams(params);
          if (draft.trim()) next.set('q', draft.trim());
          else next.delete('q');
          setParams(next, { replace: true });
        }}
      >
        <Input
          type="search"
          placeholder="Search books, electronics, hostel items…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Search the marketplace"
        />
      </form>

      <div className="chip-scroller mb-4">
        <button
          type="button"
          className={`chip${type === '' ? ' active' : ''}`}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.delete('type');
            setParams(next, { replace: true });
          }}
        >
          All
        </button>
        {LISTING_TYPES.map((value) => (
          <button
            key={value}
            type="button"
            className={`chip${type === value ? ' active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('type', value);
              setParams(next, { replace: true });
            }}
          >
            {TYPE_LABEL[value]}
          </button>
        ))}
      </div>

      {state.loading && !state.data ? (
        <LoadingCards />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.listings.length > 0 ? (
        <div className="stack">
          {state.data.listings.map((listing) => (
            <Link key={listing.id} to={`/marketplace/${listing.id}`} className="card card-link">
              <div className="row row--between mb-2">
                <span className="badge badge--accent">{TYPE_LABEL[listing.listingType]}</span>
                <span className="badge">{CONDITION_LABEL[listing.condition]}</span>
              </div>
              <h3>{listing.title}</h3>
              <p className="small muted clamp-2 mt-2">{listing.description}</p>
              <div className="row row--between mt-3">
                <span className="reward">
                  {listing.pricePaise > 0 ? formatINR(listing.pricePaise) : 'Free'}
                </span>
                <span className="small muted">{listing.pickupZone}</span>
              </div>
              <div className="row mt-3" style={{ gap: 'var(--sp-2)' }}>
                <Avatar user={listing.seller} size="sm" />
                <span className="small truncate">{listing.seller.fullName}</span>
                <span className="spacer" />
                <span className="tiny subtle">{relativeTime(listing.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          emoji="🛍️"
          title="Nothing listed yet"
          message="Be the first to sell or give away something you no longer need."
        />
      )}

      <button type="button" className="fab" onClick={() => navigate('/marketplace/new')}>
        <span aria-hidden="true">＋</span> Sell something
      </button>
    </Screen>
  );
}

export function ListingDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const state = useAsync<{ listing: Listing }>(
    (signal) => api.get<{ listing: Listing }>(`/listings/${id}`, signal),
    [id],
  );

  if (state.loading && !state.data) {
    return (
      <Screen title="Listing" back>
        <div className="skeleton" style={{ height: 220 }} />
      </Screen>
    );
  }
  if (state.error || !state.data) {
    return (
      <Screen title="Listing" back>
        <ErrorState message={state.error ?? 'Listing not available.'} onRetry={state.reload} />
      </Screen>
    );
  }

  const listing = state.data.listing;
  const isSeller = listing.seller.id === user?.id;

  return (
    <Screen title="Listing" back>
      <div className="card stack">
        <div className="row row--between">
          <span className="badge badge--accent">{TYPE_LABEL[listing.listingType]}</span>
          <span className="badge">{CONDITION_LABEL[listing.condition]}</span>
        </div>
        <h1>{listing.title}</h1>
        <div className="reward" style={{ fontSize: 26 }}>
          {listing.pricePaise > 0 ? formatINR(listing.pricePaise) : 'Free'}
        </div>
        {listing.description && <p className="muted">{listing.description}</p>}
        {listing.pickupZone && (
          <div className="row row--between small">
            <span className="muted">Pick up from</span>
            <span className="strong">{listing.pickupZone}</span>
          </div>
        )}
      </div>

      <Link to={`/users/${listing.seller.id}`} className="card card-link mt-3">
        <div className="row">
          <Avatar user={listing.seller} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="strong truncate">{listing.seller.fullName}</div>
            <Stars value={listing.seller.averageRating} count={listing.seller.ratingCount} />
          </div>
          <span className="chevron subtle">›</span>
        </div>
      </Link>

      <div className="mt-4">
        {isSeller ? (
          <Button
            variant="danger"
            block
            onClick={async () => {
              try {
                await api.delete(`/listings/${listing.id}`);
                toast.success('Listing removed.');
                navigate('/marketplace', { replace: true });
              } catch (cause) {
                toast.error(cause instanceof ApiError ? cause.message : 'Could not remove it.');
              }
            }}
          >
            Remove listing
          </Button>
        ) : (
          <Button
            size="lg"
            block
            onClick={() => {
              // A private request addressed to the seller alone. When they respond and
              // the buyer accepts, a chat opens between the two of them.
              const price = listing.pricePaise > 0 ? formatINR(listing.pricePaise) : 'free';
              const prefill = new URLSearchParams({
                title: `Buy: ${listing.title}`.slice(0, 120),
                description: `Hi! I would like your listing "${listing.title}" (${price}). When can we meet?`,
                category: 'marketplace',
                invite: listing.seller.id,
                inviteName: listing.seller.fullName,
              });
              // The agreed price becomes the seller's reward, within the platform's cap.
              if (listing.pricePaise > 0 && listing.pricePaise <= MAX_REWARD_PAISE) {
                prefill.set('reward', String(Math.round(listing.pricePaise / 100)));
              }
              navigate(`/create?${prefill.toString()}`);
            }}
          >
            Contact the seller
          </Button>
        )}
        <p className="tiny subtle center mt-3">
          Handover happens in person on campus. CampusBuddy does not handle marketplace payments.
        </p>
      </div>
    </Screen>
  );
}

export function CreateListing(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    description: '',
    listingType: 'SELL',
    price: '',
    condition: 'GOOD',
    pickupZone: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFree = form.listingType === 'GIVEAWAY' || form.listingType === 'EXCHANGE';

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { listing } = await api.post<{ listing: Listing }>('/listings', {
        title: form.title.trim(),
        description: form.description.trim(),
        categorySlug: 'marketplace',
        listingType: form.listingType,
        pricePaise: isFree ? 0 : rupeesToPaise(Number(form.price || 0)),
        condition: form.condition,
        pickupZone: form.pickupZone || null,
        imageIds: [],
      });
      toast.success('Listed on the campus marketplace.');
      navigate(`/marketplace/${listing.id}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create the listing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="New listing" back>
      <form onSubmit={submit} noValidate>
        {error && <div className="alert alert--error mb-4">{error}</div>}

        <Field label="What are you listing?">
          <Input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Engineering Mathematics textbook"
            maxLength={120}
            required
          />
        </Field>

        <Field label="Type">
          <select
            className="select"
            value={form.listingType}
            onChange={(event) => setForm({ ...form, listingType: event.target.value })}
          >
            {LISTING_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>

        {!isFree && (
          <Field label="Price">
            <RupeeInput value={form.price} onChange={(price) => setForm({ ...form, price })} placeholder="250" />
          </Field>
        )}

        <Field label="Condition">
          <select
            className="select"
            value={form.condition}
            onChange={(event) => setForm({ ...form, condition: event.target.value })}
          >
            {ITEM_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {CONDITION_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Condition, what is included, why you are selling."
            maxLength={2000}
          />
        </Field>

        <Field label="Pick up from">
          <Input
            value={form.pickupZone}
            onChange={(event) => setForm({ ...form, pickupZone: event.target.value })}
            placeholder="Hostel A"
          />
        </Field>

        <Button type="submit" size="lg" block loading={busy} disabled={form.title.trim().length < 3}>
          Publish listing
        </Button>
      </form>
    </Screen>
  );
}
