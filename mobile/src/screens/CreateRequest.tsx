import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Attachment } from '@campusbuddy/shared';
import { CATEGORIES, DEADLINE_PRESETS, formatINR, rupeesToPaise } from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { requestPosition } from '../lib/usePosition';
import { useToast } from '../state/toast';
import { useAuth } from '../state/auth';
import { Screen } from '../components/Layout';
import { Alert, Button, Field, Input, RupeeInput, Textarea } from '../components/ui';

/**
 * Create a request (spec §82).
 *
 * Kept to one screen so a simple errand takes seconds to post; the advanced options
 * are tucked behind a disclosure rather than blocking the common case.
 *
 * Other screens can open it pre-filled — "Contact the seller" on a listing, "Ask
 * privately" on a profile — and may address it to one student alone (`invite`), in
 * which case only they can see it (spec §48).
 */
export function CreateRequest(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [params] = useSearchParams();

  const invitee = params.get('invite');
  const inviteeName = params.get('inviteName') ?? 'this student';
  const presetCategory = params.get('category');

  const [form, setForm] = useState({
    title: params.get('title') ?? '',
    description: params.get('description') ?? '',
    categorySlug:
      presetCategory && CATEGORIES.some((item) => item.slug === presetCategory)
        ? presetCategory
        : 'quick-delivery',
    subcategory: '',
    reward: params.get('reward') ?? '',
    productCost: '',
    pickupLabel: '',
    deliveryLabel: '',
    deadlineMinutes: '30',
    urgency: 'NORMAL' as 'NORMAL' | 'URGENT',
    visibility: 'CAMPUS',
    maxReward: '',
    autoEscalate: false,
  });
  const [advanced, setAdvanced] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const category = CATEGORIES.find((item) => item.slug === form.categorySlug);
  const rewardPaise = form.reward ? rupeesToPaise(Number(form.reward)) : 0;
  const costPaise = form.productCost ? rupeesToPaise(Number(form.productCost)) : 0;

  async function addPhotos(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    const available = 5 - photos.length;
    const chosen = Array.from(files).slice(0, available);
    if (chosen.length === 0) {
      setError('You can add up to 5 photos.');
      return;
    }

    setError(null);
    setUploadingPhotos(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of chosen) {
        if (!file.type.startsWith('image/')) throw new Error('Choose image files only.');
        const result = await api.upload<{ attachment: Attachment }>(
          '/uploads?purpose=REQUEST',
          file,
          file.name,
          'POST',
        );
        uploaded.push(result.attachment);
      }
      setPhotos((current) => [...current, ...uploaded].slice(0, 5));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : (cause as Error).message || 'Could not upload those photos.');
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (form.title.trim().length < 4) errors.title = 'Give your request a clear title.';
    if (!form.reward || Number(form.reward) < 1) errors.rewardPaise = 'Set a reward of at least ₹1.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    try {
      // Location is attached only when the student opts in on this screen.
      const position = shareLocation ? await requestPosition() : null;
      const minutes = Number(form.deadlineMinutes);

      const { request } = await api.post<{ request: { id: string } }>('/requests', {
        title: form.title.trim(),
        description: form.description.trim(),
        categorySlug: form.categorySlug,
        subcategory: form.subcategory || null,
        rewardPaise,
        productCostPaise: costPaise,
        maxRewardPaise: form.maxReward ? rupeesToPaise(Number(form.maxReward)) : null,
        autoEscalate: form.autoEscalate && Boolean(form.maxReward),
        pickupLocation: form.pickupLabel
          ? { label: form.pickupLabel, lat: position?.lat ?? null, lng: position?.lng ?? null }
          : null,
        deliveryLocation: form.deliveryLabel ? { label: form.deliveryLabel } : null,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        deadlineAt: minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
        urgency: form.urgency,
        visibility: invitee ? 'FAVOURITES' : form.visibility,
        attachmentIds: photos.map((photo) => photo.id),
        invitedHelperIds: invitee ? [invitee] : [],
      });

      toast.success(invitee ? `Request sent to ${inviteeName}.` : 'Request posted. Nearby students have been notified.');
      navigate(`/requests/${request.id}`, { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fieldErrors);
      } else {
        setError('Could not post your request. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (user && !user.isVerified) {
    return (
      <Screen title="Create request" back>
        <Alert tone="warning" title="Verify first">
          Only verified students can post requests. It takes less than a minute.
        </Alert>
        <div className="mt-4">
          <Button block onClick={() => navigate('/verify')}>
            Verify my account
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={invitee ? `Ask ${inviteeName}` : 'Create request'} back>
      <form onSubmit={onSubmit} noValidate>
        {invitee && (
          <div className="mb-4">
            <Alert tone="info" title={`Only ${inviteeName} will see this`}>
              It goes to them alone. When they offer and you accept, a private chat opens between
              the two of you.
            </Alert>
          </div>
        )}

        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <Field label="What do you need?" id="title" error={fieldErrors.title}>
          <Input
            id="title"
            placeholder="e.g. Bring a cold drink from the canteen"
            value={form.title}
            onChange={(event) => set('title', event.target.value)}
            error={Boolean(fieldErrors.title)}
            maxLength={120}
            required
          />
        </Field>

        <Field label="Category" id="category">
          <select
            id="category"
            className="select"
            value={form.categorySlug}
            onChange={(event) => {
              set('categorySlug', event.target.value);
              set('subcategory', '');
            }}
          >
            {CATEGORIES.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.icon} {item.name}
              </option>
            ))}
          </select>
        </Field>

        {category && category.subcategories.length > 0 && (
          <Field label="Type (optional)" id="subcategory">
            <select
              id="subcategory"
              className="select"
              value={form.subcategory}
              onChange={(event) => set('subcategory', event.target.value)}
            >
              <option value="">Any</option>
              {category.subcategories.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Details (optional)" id="description" hint="Anything the helper should know.">
          <Textarea
            id="description"
            placeholder="Sugar-free if they have it. I am in room 214."
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            maxLength={2000}
          />
        </Field>

        <Field label="Relevant photos (optional)" hint="Add up to 5 photos. Anyone who can view this request can view them.">
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = '';
            }}
          />
          {photos.length > 0 && (
            <div className="request-photo-grid mb-3">
              {photos.map((photo) => (
                <div className="request-photo" key={photo.id}>
                  <img src={photo.url} alt={photo.fileName} />
                  <button
                    type="button"
                    aria-label={`Remove ${photo.fileName}`}
                    onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            block
            loading={uploadingPhotos}
            disabled={busy || uploadingPhotos || photos.length >= 5}
            onClick={() => photoInput.current?.click()}
          >
            {photos.length ? `Add more photos (${photos.length}/5)` : 'Add photos'}
          </Button>
        </Field>

        <div className="grid-2">
          <Field label="Helper reward" error={fieldErrors.rewardPaise} hint="What they earn.">
            <RupeeInput value={form.reward} onChange={(value) => set('reward', value)} placeholder="20" />
          </Field>
          <Field label="Item cost" hint="What they spend for you.">
            <RupeeInput
              value={form.productCost}
              onChange={(value) => set('productCost', value)}
              placeholder="0"
            />
          </Field>
        </div>

        {/* The three amounts are shown separately so nothing is ambiguous (spec §21). */}
        {(rewardPaise > 0 || costPaise > 0) && (
          <div className="card card--flat mb-4" style={{ background: 'var(--surface-2)' }}>
            <div className="row row--between small">
              <span className="muted">Item cost</span>
              <span>{formatINR(costPaise)}</span>
            </div>
            <div className="row row--between small mt-2">
              <span className="muted">Helper reward</span>
              <span>{formatINR(rewardPaise)}</span>
            </div>
            <div className="divider" style={{ margin: 'var(--sp-3) 0' }} />
            <div className="row row--between">
              <span className="strong">You pay in total</span>
              <span className="reward">{formatINR(rewardPaise + costPaise)}</span>
            </div>
          </div>
        )}

        <div className="grid-2">
          <Field label="Pick up from" id="pickup">
            <Input
              id="pickup"
              placeholder="Campus Canteen"
              value={form.pickupLabel}
              onChange={(event) => set('pickupLabel', event.target.value)}
            />
          </Field>
          <Field label="Deliver to" id="delivery">
            <Input
              id="delivery"
              placeholder="Hostel A"
              value={form.deliveryLabel}
              onChange={(event) => set('deliveryLabel', event.target.value)}
            />
          </Field>
        </div>

        <Field label="Needed within" id="deadline">
          <div className="chip-scroller">
            {DEADLINE_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                className={`chip${Number(form.deadlineMinutes) === preset.minutes ? ' active' : ''}`}
                onClick={() => set('deadlineMinutes', String(preset.minutes))}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={`chip${form.deadlineMinutes === '0' ? ' active' : ''}`}
              onClick={() => set('deadlineMinutes', '0')}
            >
              No deadline
            </button>
          </div>
        </Field>

        <label className="row mb-3" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.urgency === 'URGENT'}
            onChange={(event) => set('urgency', event.target.checked ? 'URGENT' : 'NORMAL')}
            style={{ width: 20, height: 20 }}
          />
          <span>
            <span className="strong">Mark as urgent</span>
            <span className="small muted" style={{ display: 'block' }}>
              Ranks higher and notifies available students first.
            </span>
          </span>
        </label>

        <label className="row mb-4" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={shareLocation}
            onChange={(event) => setShareLocation(event.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          <span>
            <span className="strong">Share my approximate location</span>
            <span className="small muted" style={{ display: 'block' }}>
              Helps nearby students find this. Only a rounded position is shown publicly.
            </span>
          </span>
        </label>

        <button
          type="button"
          className="btn btn--ghost btn--block mb-4"
          onClick={() => setAdvanced((value) => !value)}
        >
          {advanced ? 'Hide' : 'Show'} advanced options
        </button>

        {advanced && (
          <div className="card card--flat mb-4">
            {!invitee && (
              <Field label="Who can see this?" id="visibility">
                <select
                  id="visibility"
                  className="select"
                  value={form.visibility}
                  onChange={(event) => set('visibility', event.target.value)}
                >
                  <option value="CAMPUS">Everyone on campus</option>
                  <option value="HOSTEL">My hostel only</option>
                  <option value="DEPARTMENT">My department only</option>
                  <option value="YEAR">My year only</option>
                </select>
              </Field>
            )}

            <Field
              label="Maximum reward"
              hint="If nobody accepts, the reward can rise automatically up to this amount."
            >
              <RupeeInput
                value={form.maxReward}
                onChange={(value) => set('maxReward', value)}
                placeholder="No limit"
              />
            </Field>

            <label className="row" style={{ cursor: form.maxReward ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                disabled={!form.maxReward}
                checked={form.autoEscalate}
                onChange={(event) => set('autoEscalate', event.target.checked)}
                style={{ width: 20, height: 20 }}
              />
              <span>
                <span className="strong">Raise the reward automatically</span>
                <span className="small muted" style={{ display: 'block' }}>
                  Increases every 10 minutes while nobody has accepted.
                </span>
              </span>
            </label>
          </div>
        )}

        <Button type="submit" size="lg" block loading={busy} disabled={uploadingPhotos}>
          {invitee ? `Send to ${inviteeName}` : 'Post request'}
        </Button>
      </form>
    </Screen>
  );
}
