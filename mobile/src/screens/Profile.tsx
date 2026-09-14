import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PublicUser, Rating, SelfUser } from '@campusbuddy/shared';
import {
  AVAILABILITY_STATES,
  CATEGORIES,
  UPI_ID_PATTERN,
  formatINR,
  formatRate,
  isSameUpiId,
} from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { relativeTime } from '../lib/format';
import { ImageProcessingError, prepareAvatar, prepareUpiQr, type PreparedUpiQr } from '../lib/image';
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
  Sheet,
  Stars,
  TierBadge,
  VerifiedBadge,
} from '../components/ui';

type ProfileSheet = null | 'photo' | 'payment' | 'availability' | 'categories';

const AVAILABILITY_LABEL: Record<string, string> = {
  AVAILABLE_NOW: 'Available now',
  BUSY: 'Busy',
  AVAILABLE_LATER: 'Available later',
};

const ROW_BUTTON_STYLE = { width: '100%', background: 'none', border: 'none', textAlign: 'left' } as const;

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError || cause instanceof ImageProcessingError ? cause.message : fallback;
}

function paymentSummary(user: SelfUser): string {
  if (user.upiId && user.upiQrUrl) return `${user.upiId} · QR code added`;
  if (user.upiId) return user.upiId;
  if (user.upiQrUrl) return 'QR code added';
  return 'Add a UPI ID or QR code to get paid';
}

/** Your own profile, settings and preferences (spec §13). */
export function Profile(): JSX.Element {
  const { user, signOut, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [sheet, setSheet] = useState<ProfileSheet>(null);

  if (!user) return <Screen title="Profile">{null}</Screen>;

  async function patch(path: string, body: unknown, message: string): Promise<void> {
    try {
      const { user: updated } = await api.patch<{ user: SelfUser }>(path, body);
      setUser(updated);
      toast.success(message);
      setSheet(null);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Could not save that.'));
    }
  }

  const closeSheet = (): void => setSheet(null);

  return (
    <Screen title="Profile">
      <div className="card stack mb-4">
        <div className="row">
          <button
            type="button"
            className="avatar-edit"
            onClick={() => setSheet('photo')}
            aria-label={user.avatarUrl ? 'Change your profile photo' : 'Add a profile photo'}
          >
            <Avatar user={user} size="lg" />
            <span className="avatar-edit__badge" aria-hidden="true">
              📷
            </span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="truncate">{user.fullName}</h2>
            <div className="row row--wrap mt-2" style={{ gap: 'var(--sp-2)' }}>
              {user.isVerified ? (
                <VerifiedBadge method={user.verificationMethod} />
              ) : (
                <span className="badge badge--warning">Not verified</span>
              )}
              <TierBadge tier={user.tier} />
            </div>
            <div className="small muted mt-2">
              {user.departmentName ?? 'Department not set'}
              {user.yearOfStudy ? ` · Year ${user.yearOfStudy}` : ''}
            </div>
          </div>
        </div>

        {!user.isVerified && (
          <Alert tone="warning" title="Verify your account">
            You can browse, but posting requests and helping others needs verification.
            <div className="mt-3">
              <Button size="sm" onClick={() => navigate('/verify')}>
                Verify now
              </Button>
            </div>
          </Alert>
        )}

        <div className="stat-grid">
          <div className="stat">
            <div className="value">{user.averageRating > 0 ? user.averageRating.toFixed(1) : '—'}</div>
            <div className="label">Rating ({user.ratingCount})</div>
          </div>
          <div className="stat">
            <div className="value">{user.completedTasks}</div>
            <div className="label">Tasks completed</div>
          </div>
          <div className="stat">
            <div className="value">{formatRate(user.completionRate)}</div>
            <div className="label">Completion rate</div>
          </div>
          <div className="stat">
            <div className="value">{user.reliabilityScore}</div>
            <div className="label">Reliability score</div>
          </div>
        </div>
      </div>

      <div className="card card--pad-0 mb-4">
        <div className="list">
          <Link to="/earnings" className="list-row">
            <span aria-hidden="true">💰</span>
            <div className="body">
              <div className="strong">Earnings</div>
              <div className="small muted">{formatINR(user.totalEarnedPaise)} earned in total</div>
            </div>
            <span className="chevron">›</span>
          </Link>

          <button type="button" className="list-row" onClick={() => setSheet('payment')} style={ROW_BUTTON_STYLE}>
            <span aria-hidden="true">📱</span>
            <div className="body">
              <div className="strong">Payment details</div>
              <div className="small muted">{paymentSummary(user)}</div>
            </div>
            <span className="chevron">›</span>
          </button>

          <button type="button" className="list-row" onClick={() => setSheet('availability')} style={ROW_BUTTON_STYLE}>
            <span aria-hidden="true">🟢</span>
            <div className="body">
              <div className="strong">Availability</div>
              <div className="small muted">{AVAILABILITY_LABEL[user.availability]}</div>
            </div>
            <span className="chevron">›</span>
          </button>

          <button type="button" className="list-row" onClick={() => setSheet('categories')} style={ROW_BUTTON_STYLE}>
            <span aria-hidden="true">🎯</span>
            <div className="body">
              <div className="strong">What you want to help with</div>
              <div className="small muted">
                {user.preferredCategories.length === 0
                  ? 'Anything'
                  : `${user.preferredCategories.length} categories`}
              </div>
            </div>
            <span className="chevron">›</span>
          </button>

          <Link to="/favourites" className="list-row">
            <span aria-hidden="true">⭐</span>
            <div className="body">
              <div className="strong">Trusted helpers</div>
              <div className="small muted">Students you have saved</div>
            </div>
            <span className="chevron">›</span>
          </Link>

          <Link to="/notifications" className="list-row">
            <span aria-hidden="true">🔔</span>
            <div className="body">
              <div className="strong">Notifications</div>
            </div>
            <span className="chevron">›</span>
          </Link>

          <Link to="/settings/notifications" className="list-row">
            <span aria-hidden="true">⚙️</span>
            <div className="body">
              <div className="strong">Notification settings</div>
              <div className="small muted">Categories, filters and quiet hours</div>
            </div>
            <span className="chevron">›</span>
          </Link>

          <Link to="/settings/privacy" className="list-row">
            <span aria-hidden="true">🛡️</span>
            <div className="body">
              <div className="strong">Privacy & safety</div>
              <div className="small muted">Data, consent, blocks and account controls</div>
            </div>
            <span className="chevron">›</span>
          </Link>

          <Link to="/disputes" className="list-row">
            <span aria-hidden="true">⚖️</span>
            <div className="body">
              <div className="strong">Disputes</div>
              <div className="small muted">Evidence, status and moderator outcomes</div>
            </div>
            <span className="chevron">›</span>
          </Link>

          <Link to={`/users/${user.id}`} className="list-row">
            <span aria-hidden="true">👁️</span>
            <div className="body">
              <div className="strong">View my public profile</div>
              <div className="small muted">What other students see</div>
            </div>
            <span className="chevron">›</span>
          </Link>
        </div>
      </div>

      <Button variant="secondary" block onClick={() => void signOut()}>
        Sign out
      </Button>

      <p className="tiny subtle center mt-4">
        CampusBuddy · {user.email}
        <br />
        Your phone number, UPI ID and QR code are never shown publicly.
      </p>

      <PhotoSheet open={sheet === 'photo'} onClose={closeSheet} user={user} onUpdated={setUser} />

      <PaymentDetailsSheet open={sheet === 'payment'} onClose={closeSheet} user={user} onUpdated={setUser} />

      <Sheet open={sheet === 'availability'} onClose={closeSheet} title="Availability">
        <p className="small muted mb-4">
          This affects which requests you are notified about and how highly you rank for matching.
        </p>
        <div className="stack stack--sm">
          {AVAILABILITY_STATES.map((value) => (
            <Button
              key={value}
              variant={user.availability === value ? 'primary' : 'secondary'}
              block
              onClick={() => void patch('/users/me/preferences', { availability: value }, 'Availability updated.')}
            >
              {AVAILABILITY_LABEL[value]}
            </Button>
          ))}
        </div>
      </Sheet>

      <CategorySheet
        open={sheet === 'categories'}
        onClose={closeSheet}
        selected={user.preferredCategories}
        onSave={(preferredCategories) =>
          patch('/users/me/preferences', { preferredCategories }, 'Preferences saved.')
        }
      />
    </Screen>
  );
}

interface ProfileSheetProps {
  open: boolean;
  onClose: () => void;
  user: SelfUser;
  onUpdated: (user: SelfUser) => void;
}

/** Add, replace or remove the profile photo. */
function PhotoSheet({ open, onClose, user, onUpdated }: ProfileSheetProps): JSX.Element {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'upload' | 'remove'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function upload(file: File): Promise<void> {
    setError(null);
    setBusy('upload');
    try {
      const photo = await prepareAvatar(file);
      const { user: updated } = await api.upload<{ user: SelfUser }>('/users/me/avatar', photo, 'profile-photo.jpg');
      onUpdated(updated);
      toast.success('Profile photo updated.');
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not update your photo. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    setError(null);
    setBusy('remove');
    try {
      const { user: updated } = await api.delete<{ user: SelfUser }>('/users/me/avatar');
      onUpdated(updated);
      toast.success('Profile photo removed.');
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not remove your photo. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Profile photo">
      <div className="center mb-3">
        <div style={{ display: 'inline-block' }}>
          <Avatar user={user} size="xl" />
        </div>
      </div>
      <p className="small muted center mb-4">
        Shown to other students next to your requests, offers and reviews.
      </p>

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again still triggers a change.
          event.target.value = '';
          if (file) void upload(file);
        }}
      />

      <div className="stack stack--sm">
        <Button
          size="lg"
          block
          loading={busy === 'upload'}
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          {user.avatarUrl ? 'Choose a new photo' : 'Choose a photo'}
        </Button>
        {user.avatarUrl && (
          <Button
            variant="ghost"
            block
            loading={busy === 'remove'}
            disabled={busy !== null}
            onClick={() => void remove()}
            style={{ color: 'var(--danger-text)' }}
          >
            Remove photo
          </Button>
        )}
      </div>

      <p className="tiny subtle center mt-3">
        Photos are cropped to a square. Location and camera details are removed before they leave your
        phone.
      </p>
    </Sheet>
  );
}

/** UPI ID and payment QR code — how a student gets paid. */
function PaymentDetailsSheet({ open, onClose, user, onUpdated }: ProfileSheetProps): JSX.Element {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [upiId, setUpiId] = useState(user.upiId ?? '');
  const [pending, setPending] = useState<(PreparedUpiQr & { previewUrl: string }) | null>(null);
  const [busy, setBusy] = useState<null | 'scan' | 'save-qr' | 'remove-qr' | 'save-id'>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Start fresh each time the sheet opens, and follow the saved UPI ID when it changes.
  useEffect(() => {
    if (!open) {
      setPending(null);
      return;
    }
    setUpiId(user.upiId ?? '');
    setError(null);
  }, [open, user.upiId]);

  useEffect(() => setPreviewFailed(false), [user.upiQrUrl]);

  // Release the local preview once it is no longer shown.
  useEffect(() => {
    if (!pending) return undefined;
    return () => URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  async function scan(file: File): Promise<void> {
    setError(null);
    setBusy('scan');
    try {
      const prepared = await prepareUpiQr(file);
      setPending({ ...prepared, previewUrl: URL.createObjectURL(prepared.blob) });
    } catch (cause) {
      setError(errorMessage(cause, 'Could not read that image. Please try another.'));
    } finally {
      setBusy(null);
    }
  }

  async function saveQr(): Promise<void> {
    if (!pending) return;
    setError(null);
    setBusy('save-qr');
    try {
      let { user: updated } = await api.upload<{ user: SelfUser }>('/users/me/payment-qr', pending.blob, 'upi-qr.png');
      // With no UPI ID saved yet, take it from the code, so payers get both options.
      const adoptedId = !updated.upiId;
      if (adoptedId) {
        ({ user: updated } = await api.patch<{ user: SelfUser }>('/users/me/payment-details', {
          upiId: pending.target.vpa,
        }));
      }
      onUpdated(updated);
      toast.success(
        adoptedId ? `QR code saved. Your UPI ID is now ${pending.target.vpa}.` : 'Payment QR code saved.',
      );
      setPending(null);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save your QR code. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function removeQr(): Promise<void> {
    setError(null);
    setBusy('remove-qr');
    try {
      const { user: updated } = await api.delete<{ user: SelfUser }>('/users/me/payment-qr');
      onUpdated(updated);
      toast.success('Payment QR code removed.');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not remove your QR code. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function saveUpiId(value: string): Promise<void> {
    const next = value.trim();
    if (next && !UPI_ID_PATTERN.test(next)) {
      setError('Enter a valid UPI ID, for example name@okaxis.');
      return;
    }
    setError(null);
    setBusy('save-id');
    try {
      const { user: updated } = await api.patch<{ user: SelfUser }>('/users/me/payment-details', {
        upiId: next || null,
      });
      onUpdated(updated);
      toast.success(next ? 'UPI ID saved.' : 'UPI ID removed.');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save your UPI ID. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  const mismatchedVpa =
    pending && user.upiId && !isSameUpiId(user.upiId, pending.target.vpa) ? pending.target.vpa : null;
  const idUnchanged = (upiId.trim() || null) === (user.upiId ?? null);

  return (
    <Sheet open={open} onClose={onClose} title="Payment details">
      <Alert tone="info">
        Your UPI ID and QR code are shown only to a student who owes you money, and only while that
        payment is due. CampusBuddy never handles the transfer itself.
      </Alert>

      {error && (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void scan(file);
        }}
      />

      <h3 className="mt-4 mb-3">UPI QR code</h3>

      {pending ? (
        <div className="stack">
          <div className="qr-frame">
            <img className="qr-image" src={pending.previewUrl} alt="Your UPI QR code" />
          </div>
          <Alert tone="success" title="QR code recognised">
            Payments will go to <strong>{pending.target.vpa}</strong>
            {pending.target.payeeName ? ` (${pending.target.payeeName})` : ''}.
          </Alert>
          {mismatchedVpa && (
            <Alert tone="warning" title="Different from your UPI ID">
              Your saved UPI ID is {user.upiId}, but this QR code pays {mismatchedVpa}. Payers see both,
              so they should be the same account.
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === 'save-id'}
                  disabled={busy !== null}
                  onClick={() => void saveUpiId(mismatchedVpa)}
                >
                  Use {mismatchedVpa} as my UPI ID
                </Button>
              </div>
            </Alert>
          )}
          <div className="btn-row">
            <Button variant="secondary" disabled={busy !== null} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button loading={busy === 'save-qr'} disabled={busy !== null} onClick={() => void saveQr()}>
              Save QR code
            </Button>
          </div>
        </div>
      ) : user.upiQrUrl ? (
        <div className="stack">
          <div className="qr-frame">
            {previewFailed ? (
              <p className="small muted center">Preview unavailable. Close and reopen this sheet to refresh it.</p>
            ) : (
              <img
                className="qr-image"
                src={user.upiQrUrl}
                alt="Your saved UPI QR code"
                onError={() => setPreviewFailed(true)}
              />
            )}
          </div>
          <div className="btn-row">
            <Button
              variant="secondary"
              loading={busy === 'scan'}
              disabled={busy !== null}
              onClick={() => fileInput.current?.click()}
            >
              Replace
            </Button>
            <Button variant="danger" loading={busy === 'remove-qr'} disabled={busy !== null} onClick={() => void removeQr()}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="small muted mb-3">
            In your UPI app (Google Pay, PhonePe, Paytm, BHIM…), open the QR code for{' '}
            <strong>receiving</strong> money and save or screenshot it. Then upload it here.
          </p>
          <Button
            variant="secondary"
            block
            loading={busy === 'scan'}
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            Upload your UPI QR code
          </Button>
        </>
      )}

      <div className="divider" />

      <h3 className="mb-3">UPI ID</h3>
      <Field hint="For example name@okhdfcbank">
        <Input
          value={upiId}
          onChange={(event) => setUpiId(event.target.value)}
          placeholder="name@bank"
          aria-label="UPI ID"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Button block loading={busy === 'save-id'} disabled={busy !== null || idUnchanged} onClick={() => void saveUpiId(upiId)}>
        {upiId.trim() || !user.upiId ? 'Save UPI ID' : 'Remove UPI ID'}
      </Button>

      <Button variant="secondary" block disabled={busy !== null} onClick={onClose}>
        Okay, done
      </Button>
    </Sheet>
  );
}

function CategorySheet({
  open,
  onClose,
  selected,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  selected: string[];
  onSave: (categories: string[]) => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<string[]>(selected);
  const toggle = (slug: string): void =>
    setChosen((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );

  return (
    <Sheet open={open} onClose={onClose} title="What you want to help with">
      <p className="small muted mb-4">Choose nothing to be notified about everything.</p>
      <div className="row row--wrap mb-4" style={{ gap: 'var(--sp-2)' }}>
        {CATEGORIES.map((category) => (
          <button
            key={category.slug}
            type="button"
            className={`chip${chosen.includes(category.slug) ? ' active' : ''}`}
            onClick={() => toggle(category.slug)}
          >
            {category.icon} {category.name}
          </button>
        ))}
      </div>
      <Button size="lg" block onClick={() => onSave(chosen)}>
        Save
      </Button>
    </Sheet>
  );
}

/** Another student's public profile (spec §13). */
export function UserProfile(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const state = useAsync<{ user: PublicUser; reviews: Rating[]; isFavourite: boolean; safety: { blocked: boolean; muted: boolean } }>(
    (signal) => api.get<{ user: PublicUser; reviews: Rating[]; isFavourite: boolean; safety: { blocked: boolean; muted: boolean } }>(`/users/${id}`, signal),
    [id],
  );
  const [favourite, setFavourite] = useState<boolean | null>(null);
  const [safety, setSafety] = useState<{ blocked: boolean; muted: boolean } | null>(null);

  if (state.loading && !state.data) {
    return (
      <Screen title="Profile" back>
        <div className="skeleton" style={{ height: 200 }} />
      </Screen>
    );
  }
  if (state.error || !state.data) {
    return (
      <Screen title="Profile" back>
        <ErrorState message={state.error ?? 'Profile not available.'} onRetry={state.reload} />
      </Screen>
    );
  }

  const profile = state.data.user;
  const isSelf = profile.id === user?.id;
  const isFavourite = favourite ?? state.data.isFavourite;
  const safetyState = safety ?? state.data.safety;

  async function toggleFavourite(): Promise<void> {
    const next = !isFavourite;
    setFavourite(next);
    try {
      if (next) await api.put(`/users/${id}/favourite`, {});
      else await api.delete(`/users/${id}/favourite`);
      toast.success(next ? 'Added to your trusted helpers.' : 'Removed from your trusted helpers.');
    } catch {
      setFavourite(!next);
      toast.error('Could not update your favourites.');
    }
  }

  async function setSafetyControl(blocked: boolean, muted: boolean): Promise<void> {
    try {
      if (!blocked && !muted) await api.delete(`/safety/controls/${id}`);
      else await api.put(`/safety/controls/${id}`, { blocked, muted });
      setSafety({ blocked, muted });
      toast.success(blocked ? 'Student blocked.' : muted ? 'Notifications from this student muted.' : 'Safety control removed.');
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update that safety control.');
    }
  }

  return (
    <Screen title={profile.fullName} back>
      <div className="card stack mb-4">
        <div className="row">
          <Avatar user={profile} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="truncate">{profile.fullName}</h2>
            <div className="row row--wrap mt-2" style={{ gap: 'var(--sp-2)' }}>
              {profile.isVerified && <VerifiedBadge method={profile.verificationMethod} />}
              <TierBadge tier={profile.tier} />
            </div>
            <div className="small muted mt-2">
              {profile.departmentName ?? 'Student'}
              {profile.yearOfStudy ? ` · Year ${profile.yearOfStudy}` : ''}
            </div>
            <div className="mt-2">
              <Stars value={profile.averageRating} count={profile.ratingCount} />
            </div>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="value">{profile.completedTasks}</div>
            <div className="label">Tasks completed</div>
          </div>
          <div className="stat">
            <div className="value">{formatRate(profile.completionRate)}</div>
            <div className="label">Completion</div>
          </div>
          <div className="stat">
            <div className="value">{formatRate(profile.cancellationRate)}</div>
            <div className="label">Cancellation</div>
          </div>
          <div className="stat">
            <div className="value">{profile.reliabilityScore}</div>
            <div className="label">Reliability</div>
          </div>
        </div>

        {profile.skills.length > 0 && (
          <div>
            <div className="small muted mb-2">Skills</div>
            <div className="row row--wrap" style={{ gap: 'var(--sp-2)' }}>
              {profile.skills.map((skill) => (
                <span key={skill} className="chip chip--static">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {profile.badges.length > 0 && (
          <div>
            <div className="small muted mb-2">Badges</div>
            <div className="row row--wrap" style={{ gap: 'var(--sp-2)' }}>
              {profile.badges.map((badge) => (
                <span key={badge} className="badge badge--accent">
                  🏆 {badge.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="tiny subtle">Member since {relativeTime(profile.memberSince)}</div>

        {!isSelf && (
          <div className="stack stack--sm">
            {/* A request only this student can see, so you can ask someone you trust directly. */}
            {profile.isVerified && !safetyState.blocked && (
              <Link
                className="btn btn--block"
                to={`/create?${new URLSearchParams({ invite: profile.id, inviteName: profile.fullName }).toString()}`}
              >
                Ask {profile.fullName.split(' ')[0]} privately
              </Link>
            )}
            {!safetyState.blocked && <Button variant="secondary" block onClick={() => void toggleFavourite()}>
              {isFavourite ? '★ In your trusted helpers' : '☆ Add to trusted helpers'}
            </Button>}
            <div className="btn-row">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void setSafetyControl(false, !safetyState.muted)}
              >
                {safetyState.muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button
                size="sm"
                variant={safetyState.blocked ? 'secondary' : 'danger'}
                onClick={() => void setSafetyControl(!safetyState.blocked, safetyState.muted)}
              >
                {safetyState.blocked ? 'Unblock' : 'Block'}
              </Button>
              <Link
                className="btn btn--ghost btn--sm"
                to={`/reports/new?${new URLSearchParams({ targetType: 'USER', targetId: profile.id }).toString()}`}
              >
                Report
              </Link>
            </div>
          </div>
        )}
      </div>

      <h2 className="mb-3">Reviews</h2>
      {state.data.reviews.length === 0 ? (
        <EmptyState emoji="📝" title="No reviews yet" message="Reviews appear after a completed task." />
      ) : (
        <div className="stack">
          {state.data.reviews.map((review) => (
            <div key={review.id} className="card">
              <div className="row">
                <Avatar user={review.rater} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row row--between">
                    <span className="small strong truncate">{review.rater.fullName}</span>
                    <span className="tiny subtle">{relativeTime(review.createdAt)}</span>
                  </div>
                  <span className="stars" aria-label={`${review.stars} out of 5`}>
                    {'★'.repeat(review.stars)}
                    {'☆'.repeat(5 - review.stars)}
                  </span>
                </div>
              </div>
              {review.review && <p className="small mt-3">{review.review}</p>}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
