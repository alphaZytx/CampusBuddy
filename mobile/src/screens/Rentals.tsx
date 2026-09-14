import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Rental, RentalItem } from '@campusbuddy/shared';
import { ITEM_CONDITIONS, RENTAL_UNITS, formatINR, rupeesToPaise } from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRealtime } from '../lib/realtime';
import { relativeTime } from '../lib/format';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Screen } from '../components/Layout';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingCards,
  RupeeInput,
  Segmented,
  Sheet,
  Stars,
  Textarea,
} from '../components/ui';

const UNIT_LABEL: Record<string, string> = { HOUR: 'hour', DAY: 'day', WEEK: 'week' };
const RENTAL_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  RESERVED: 'Reserved',
  RENTED: 'With the renter',
  RETURN_PENDING: 'Return pending',
  RETURNED: 'Returned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DECLINED: 'Declined',
  DISPUTED: 'Disputed',
};

/** Borrow and rent (spec §41, §42). */
export function Rentals(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');

  const items = useAsync<{ items: RentalItem[] }>(
    (signal) =>
      api.get<{ items: RentalItem[] }>(
        tab === 'mine' ? '/rental-items?scope=MINE&availableOnly=false' : '/rental-items?limit=30',
        signal,
      ),
    [tab],
  );

  const rentals = useAsync<{ rentals: Rental[] }>(
    (signal) => api.get<{ rentals: Rental[] }>('/rentals', signal),
    [],
  );

  const activeRentals = rentals.data?.rentals.filter(
    (rental) => !['COMPLETED', 'CANCELLED', 'DECLINED'].includes(rental.status),
  );

  return (
    <Screen title="Rentals" back="/discover">
      {activeRentals && activeRentals.length > 0 && (
        <>
          <h2 className="mb-3">Your active rentals</h2>
          <div className="stack mb-4">
            {activeRentals.map((rental) => (
              <Link key={rental.id} to={`/rentals/${rental.id}`} className="card card-link">
                <div className="row row--between mb-2">
                  <span className="badge badge--accent">{RENTAL_STATUS_LABEL[rental.status]}</span>
                  <span className="small muted">
                    due {relativeTime(rental.expectedReturnAt)}
                  </span>
                </div>
                <h3>{rental.item.name}</h3>
                <div className="row row--between mt-2 small">
                  {/* Always the other student: who you lent it to, or who you borrowed it from. */}
                  <span className="muted">
                    {rental.owner.id === user?.id
                      ? `Lent to ${rental.renter.fullName}`
                      : `From ${rental.owner.fullName}`}
                  </span>
                  <span className="strong">{formatINR(rental.rentalFeePaise)}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'browse', label: 'Browse' },
            { value: 'mine', label: 'My items' },
          ]}
        />
      </div>

      {items.loading && !items.data ? (
        <LoadingCards />
      ) : items.error ? (
        <ErrorState message={items.error} onRetry={items.reload} />
      ) : items.data && items.data.items.length > 0 ? (
        <div className="stack">
          {items.data.items.map((item) => (
            <Link key={item.id} to={`/rentals/item/${item.id}`} className="card card-link">
              <div className="row row--between mb-2">
                <h3>{item.name}</h3>
                <span className={`badge badge--${item.status === 'AVAILABLE' ? 'success' : 'warning'}`}>
                  {item.status === 'AVAILABLE' ? 'Available' : item.status.toLowerCase()}
                </span>
              </div>
              <p className="small muted clamp-2">{item.description}</p>
              <div className="row row--between mt-3">
                <span className="reward">
                  {formatINR(item.pricePaise)}
                  <small>/{UNIT_LABEL[item.rentalUnit]}</small>
                </span>
                {item.depositPaise > 0 && (
                  <span className="small muted">Deposit {formatINR(item.depositPaise)}</span>
                )}
              </div>
              <div className="row mt-3" style={{ gap: 'var(--sp-2)' }}>
                <Avatar user={item.owner} size="sm" />
                <span className="small truncate">{item.owner.fullName}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          emoji="🔌"
          title={tab === 'mine' ? 'You have not listed anything' : 'Nothing available right now'}
          message={
            tab === 'mine'
              ? 'List a calculator, charger or camera and earn from it between uses.'
              : 'Check back later, or list something of your own.'
          }
        />
      )}

      <button type="button" className="fab" onClick={() => navigate('/rentals/new')}>
        <span aria-hidden="true">＋</span> List an item
      </button>
    </Screen>
  );
}

export function RentalItemDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('1');

  const state = useAsync<{ item: RentalItem }>(
    (signal) => api.get<{ item: RentalItem }>(`/rental-items/${id}`, signal),
    [id],
  );

  if (state.loading && !state.data) {
    return (
      <Screen title="Item" back>
        <div className="skeleton" style={{ height: 200 }} />
      </Screen>
    );
  }
  if (state.error || !state.data) {
    return (
      <Screen title="Item" back>
        <ErrorState message={state.error ?? 'Item not available.'} onRetry={state.reload} />
      </Screen>
    );
  }

  const item = state.data.item;
  const isOwner = item.owner.id === user?.id;
  const unitMs = item.rentalUnit === 'HOUR' ? 3_600_000 : item.rentalUnit === 'WEEK' ? 604_800_000 : 86_400_000;
  const units = Math.max(1, Number(days) || 1);

  async function requestRental(): Promise<void> {
    setBusy(true);
    try {
      const startAt = new Date(Date.now() + 30 * 60_000);
      const { rental } = await api.post<{ rental: Rental }>('/rentals', {
        itemId: item.id,
        startAt: startAt.toISOString(),
        expectedReturnAt: new Date(startAt.getTime() + units * unitMs).toISOString(),
      });
      toast.success('Request sent to the owner.');
      navigate(`/rentals/${rental.id}`, { replace: true });
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not request that item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={item.name} back>
      <div className="card stack">
        <div className="row row--between">
          <h1>{item.name}</h1>
          <span className={`badge badge--${item.status === 'AVAILABLE' ? 'success' : 'warning'}`}>
            {item.status === 'AVAILABLE' ? 'Available' : item.status.toLowerCase()}
          </span>
        </div>
        <p className="muted">{item.description}</p>

        <div className="row row--between">
          <div>
            <div className="reward" style={{ fontSize: 24 }}>
              {formatINR(item.pricePaise)}
              <small>/{UNIT_LABEL[item.rentalUnit]}</small>
            </div>
          </div>
          {item.depositPaise > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div className="strong">{formatINR(item.depositPaise)}</div>
              <div className="tiny muted">Refundable deposit</div>
            </div>
          )}
        </div>

        {item.rules && (
          <Alert tone="info" title="Owner's rules">
            {item.rules}
          </Alert>
        )}

        {item.pickupZone && (
          <div className="row row--between small">
            <span className="muted">Pick up from</span>
            <span className="strong">{item.pickupZone}</span>
          </div>
        )}
      </div>

      <Link to={`/users/${item.owner.id}`} className="card card-link mt-3">
        <div className="row">
          <Avatar user={item.owner} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="strong truncate">{item.owner.fullName}</div>
            <Stars value={item.owner.averageRating} count={item.owner.ratingCount} />
          </div>
          <span className="chevron subtle">›</span>
        </div>
      </Link>

      {!isOwner && item.status === 'AVAILABLE' && (
        <div className="mt-4">
          <Button size="lg" block onClick={() => setSheetOpen(true)}>
            Request to borrow
          </Button>
        </div>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={`Borrow ${item.name}`}>
        <Field label={`How many ${UNIT_LABEL[item.rentalUnit]}s?`}>
          <Input
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </Field>

        <div className="card card--flat mb-4" style={{ background: 'var(--surface-2)' }}>
          <div className="row row--between small">
            <span className="muted">
              {units} {UNIT_LABEL[item.rentalUnit]}
              {units > 1 ? 's' : ''} × {formatINR(item.pricePaise)}
            </span>
            <span>{formatINR(units * item.pricePaise)}</span>
          </div>
          {item.depositPaise > 0 && (
            <div className="row row--between small mt-2">
              <span className="muted">Deposit (refundable)</span>
              <span>{formatINR(item.depositPaise)}</span>
            </div>
          )}
          <div className="divider" style={{ margin: 'var(--sp-3) 0' }} />
          <div className="row row--between">
            <span className="strong">Total to hand over</span>
            <span className="reward">{formatINR(units * item.pricePaise + item.depositPaise)}</span>
          </div>
        </div>

        <Button size="lg" block loading={busy} onClick={() => void requestRental()}>
          Send request
        </Button>
      </Sheet>
    </Screen>
  );
}

export function RentalDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [returnSheet, setReturnSheet] = useState(false);
  const [depositBack, setDepositBack] = useState('');
  const [damage, setDamage] = useState('');

  const state = useAsync<{ rental: Rental }>(
    (signal) => api.get<{ rental: Rental }>(`/rentals/${id}`, signal),
    [id],
  );

  // Both sides see each step as it happens: an accepted request, a handover, a return.
  useRealtime(() => state.reload(), { channel: `rental:${id}` });

  async function act(path: string, body: unknown, message: string): Promise<void> {
    setBusy(path);
    try {
      await api.post(`/rentals/${id}/${path}`, body);
      toast.success(message);
      setReturnSheet(false);
      state.reload();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (state.loading && !state.data) {
    return (
      <Screen title="Rental" back>
        <div className="skeleton" style={{ height: 220 }} />
      </Screen>
    );
  }
  if (state.error || !state.data) {
    return (
      <Screen title="Rental" back>
        <ErrorState message={state.error ?? 'Rental not available.'} onRetry={state.reload} />
      </Screen>
    );
  }

  const rental = state.data.rental;
  const isOwner = rental.owner.id === user?.id;
  const can = (action: string): boolean => rental.availableActions.includes(action);

  return (
    <Screen title="Rental" back>
      <div className="card stack">
        <div className="row row--between">
          <span className="badge badge--accent">{RENTAL_STATUS_LABEL[rental.status]}</span>
          <span className="small muted">{isOwner ? 'You own this' : 'You are borrowing'}</span>
        </div>
        <h1>{rental.item.name}</h1>

        <div className="stack stack--sm small">
          <div className="row row--between">
            <span className="muted">Rental fee</span>
            <span className="strong">{formatINR(rental.rentalFeePaise)}</span>
          </div>
          <div className="row row--between">
            <span className="muted">Deposit</span>
            <span className="strong">{formatINR(rental.depositPaise)}</span>
          </div>
          <div className="row row--between">
            <span className="muted">Due back</span>
            <span className="strong">{relativeTime(rental.expectedReturnAt)}</span>
          </div>
          {rental.depositReturnedPaise !== null && (
            <div className="row row--between">
              <span className="muted">Deposit returned</span>
              <span className="strong">{formatINR(rental.depositReturnedPaise)}</span>
            </div>
          )}
        </div>

        {rental.damageNote && (
          <Alert tone="warning" title="Note from the owner">
            {rental.damageNote}
          </Alert>
        )}
      </div>

      <Link to={`/users/${isOwner ? rental.renter.id : rental.owner.id}`} className="card card-link mt-3">
        <div className="row">
          <Avatar user={isOwner ? rental.renter : rental.owner} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small muted">{isOwner ? 'Borrower' : 'Owner'}</div>
            <div className="strong truncate">
              {isOwner ? rental.renter.fullName : rental.owner.fullName}
            </div>
          </div>
          <span className="chevron subtle">›</span>
        </div>
      </Link>

      <div className="stack stack--sm mt-4">
        {can('accept') && (
          <Button size="lg" block loading={busy === 'accept'} onClick={() => void act('accept', {}, 'Rental accepted.')}>
            Accept request
          </Button>
        )}
        {can('decline') && (
          <Button variant="secondary" block loading={busy === 'decline'} onClick={() => void act('decline', {}, 'Request declined.')}>
            Decline
          </Button>
        )}
        {can('confirm_pickup') && (
          <Button size="lg" block loading={busy === 'confirm-pickup'} onClick={() => void act('confirm-pickup', {}, 'Rental started.')}>
            Confirm handover
          </Button>
        )}
        {can('mark_returned') && (
          <Button size="lg" block loading={busy === 'mark-returned'} onClick={() => void act('mark-returned', {}, 'Marked as returned.')}>
            I have returned it
          </Button>
        )}
        {can('confirm_return') && (
          <Button variant="success" size="lg" block onClick={() => setReturnSheet(true)}>
            Confirm return and settle deposit
          </Button>
        )}
        {can('cancel') && (
          <Button variant="ghost" block loading={busy === 'cancel'} onClick={() => void act('cancel', {}, 'Rental cancelled.')}>
            Cancel
          </Button>
        )}
        {can('open_dispute') && (
          <Button
            variant="ghost"
            block
            onClick={() => navigate(`/disputes/new?subjectType=RENTAL&subjectId=${rental.id}`)}
          >
            Open a dispute
          </Button>
        )}
      </div>

      <Sheet open={returnSheet} onClose={() => setReturnSheet(false)} title="Settle the deposit">
        <p className="small muted mb-4">
          The deposit was {formatINR(rental.depositPaise)}. Return all of it unless the item came
          back damaged.
        </p>
        <Field label="Deposit to return">
          <RupeeInput
            value={depositBack || String(Math.round(rental.depositPaise / 100))}
            onChange={setDepositBack}
          />
        </Field>
        <Field label="Damage note (optional)">
          <Textarea
            value={damage}
            onChange={(event) => setDamage(event.target.value)}
            placeholder="Describe any damage you are deducting for."
            maxLength={500}
          />
        </Field>
        <Button
          size="lg"
          block
          loading={busy === 'confirm-return'}
          onClick={() =>
            void act(
              'confirm-return',
              {
                depositReturnedPaise: rupeesToPaise(
                  Number(depositBack || Math.round(rental.depositPaise / 100)),
                ),
                damageNote: damage.trim() || null,
              },
              'Rental completed.',
            )
          }
        >
          Complete rental
        </Button>
      </Sheet>
    </Screen>
  );
}

export function CreateRentalItem(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    description: '',
    condition: 'GOOD',
    price: '',
    rentalUnit: 'DAY',
    deposit: '',
    pickupZone: '',
    rules: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { item } = await api.post<{ item: RentalItem }>('/rental-items', {
        name: form.name.trim(),
        description: form.description.trim(),
        categorySlug: 'borrow-rent',
        condition: form.condition,
        pricePaise: rupeesToPaise(Number(form.price || 0)),
        rentalUnit: form.rentalUnit,
        depositPaise: rupeesToPaise(Number(form.deposit || 0)),
        pickupZone: form.pickupZone || null,
        rules: form.rules || null,
        imageIds: [],
      });
      toast.success('Item listed for rent.');
      navigate(`/rentals/item/${item.id}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not list that item.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="List an item" back>
      <form onSubmit={submit} noValidate>
        {error && <div className="alert alert--error mb-4">{error}</div>}

        <Field label="What are you lending?">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Scientific Calculator"
            required
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Model, condition, what is included."
          />
        </Field>

        <div className="grid-2">
          <Field label="Price">
            <RupeeInput value={form.price} onChange={(price) => setForm({ ...form, price })} placeholder="30" />
          </Field>
          <Field label="Per">
            <select
              className="select"
              value={form.rentalUnit}
              onChange={(event) => setForm({ ...form, rentalUnit: event.target.value })}
            >
              {RENTAL_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_LABEL[unit]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Refundable deposit" hint="Held by you, returned when the item comes back safely.">
          <RupeeInput value={form.deposit} onChange={(deposit) => setForm({ ...form, deposit })} placeholder="200" />
        </Field>

        <Field label="Condition">
          <select
            className="select"
            value={form.condition}
            onChange={(event) => setForm({ ...form, condition: event.target.value })}
          >
            {ITEM_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Pick up from">
          <Input
            value={form.pickupZone}
            onChange={(event) => setForm({ ...form, pickupZone: event.target.value })}
            placeholder="Hostel A"
          />
        </Field>

        <Field label="Rules (optional)">
          <Textarea
            value={form.rules}
            onChange={(event) => setForm({ ...form, rules: event.target.value })}
            placeholder="Return before 9 PM. Handle with care."
          />
        </Field>

        <Button type="submit" size="lg" block loading={busy} disabled={form.name.trim().length < 3}>
          List item
        </Button>
      </form>
    </Screen>
  );
}
