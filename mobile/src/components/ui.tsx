import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useEffect, useState } from 'react';
import type { PublicUser } from '@campusbuddy/shared';
import { formatRate } from '@campusbuddy/shared';
import { initials, STATUS_META } from '../lib/format';

/** Shared primitives for the design system (spec §107). */

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
}): JSX.Element {
  const classes = [
    'btn',
    variant !== 'primary' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  id?: string;
}): JSX.Element {
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {/* The error replaces the hint so the two never compete for attention. */}
      {error ? <div className="error">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Input({
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }): JSX.Element {
  return <input className="input" aria-invalid={error ? 'true' : undefined} {...rest} />;
}

export function Textarea({
  error,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }): JSX.Element {
  return <textarea className="textarea" aria-invalid={error ? 'true' : undefined} {...rest} />;
}

/** Rupee input. Values are held in whole rupees here and converted to paise on submit. */
export function RupeeInput({
  value,
  onChange,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="input-prefix">
      <span aria-hidden="true">₹</span>
      <input
        className="input"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
        {...rest}
      />
    </div>
  );
}

export function Avatar({
  user,
  size = 'md',
}: {
  user: Pick<PublicUser, 'fullName' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}): JSX.Element {
  // Photo links are short-lived. If one has expired or the photo was removed, fall
  // back to initials instead of showing a broken image.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [user.avatarUrl]);

  const className = `avatar${size !== 'md' ? ` avatar--${size}` : ''}`;
  if (user.avatarUrl && !failed) {
    return (
      <div className={className}>
        <img src={user.avatarUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={className} aria-hidden="true">
      {initials(user.fullName)}
    </div>
  );
}

export function Stars({ value, count }: { value: number; count?: number }): JSX.Element {
  const rounded = Math.round(value);
  return (
    <span className="row" style={{ gap: 5 }}>
      <span className="stars" aria-hidden="true">
        {'★'.repeat(rounded)}
        {'☆'.repeat(Math.max(0, 5 - rounded))}
      </span>
      <span className="small muted">
        {value > 0 ? value.toFixed(1) : 'New'}
        {count !== undefined && count > 0 ? ` (${count})` : ''}
      </span>
    </span>
  );
}

/** Colour-coded status pill. Never relies on colour alone — the label carries the meaning. */
export function StatusPill({ status }: { status: keyof typeof STATUS_META }): JSX.Element {
  const meta = STATUS_META[status];
  const toneStyles: Record<string, { background: string; color: string }> = {
    info: { background: 'var(--info-soft)', color: 'var(--info-text)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-soft-text)' },
    warning: { background: 'var(--warning-soft)', color: 'var(--warning-text)' },
    success: { background: 'var(--success-soft)', color: 'var(--success-text)' },
    danger: { background: 'var(--danger-soft)', color: 'var(--danger-text)' },
  };
  return (
    <span className="status" style={toneStyles[meta.tone]}>
      {meta.label}
    </span>
  );
}

export function VerifiedBadge({ method }: { method?: string | null }): JSX.Element {
  const via =
    method === 'COLLEGE_EMAIL'
      ? 'college email'
      : method === 'CAMPUS_LOCATION'
        ? 'campus location'
        : 'manual review';
  return (
    <span className="badge badge--success" title={`Verified via ${via}`}>
      ✓ Verified
    </span>
  );
}

export function TierBadge({ tier }: { tier: PublicUser['tier'] }): JSX.Element | null {
  if (tier === 'NEW') return null;
  const emoji = tier === 'GOLD' ? '🏅' : tier === 'SILVER' ? '🥈' : '🥉';
  return (
    <span className="badge" title={`${tier.toLowerCase()} tier helper`}>
      {emoji} {tier.charAt(0) + tier.slice(1).toLowerCase()}
    </span>
  );
}

export function EmptyState({
  emoji = '📭',
  title,
  message,
  action,
}: {
  emoji?: string;
  title: string;
  message?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty">
      <span className="emoji" aria-hidden="true">
        {emoji}
      </span>
      <h3>{title}</h3>
      {message && <p className="small">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="empty">
      <span className="emoji" aria-hidden="true">
        ⚠️
      </span>
      <h3>Could not load this</h3>
      <p className="small">{message}</p>
      {onRetry && (
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function LoadingCards({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: 118 }} />
      ))}
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}): JSX.Element | null {
  // Escape and the Android device back button close the sheet before changing the
  // page behind it; the page behind does not scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onAppBack = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('campusbuddy:back', onAppBack);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('campusbuddy:back', onAppBack);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        {title && <h2 className="mb-4">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/** Compact reputation line used on profiles and offer rows. */
export function ReputationLine({ user }: { user: PublicUser }): JSX.Element {
  return (
    <div className="row row--wrap small muted" style={{ gap: 'var(--sp-3)' }}>
      <Stars value={user.averageRating} count={user.ratingCount} />
      <span>{user.completedTasks} tasks</span>
      {user.completedTasks > 0 && <span>{formatRate(user.completionRate)} completion</span>}
    </div>
  );
}

export function StarPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="star-picker" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            className={star <= value ? 'on' : ''}
            onClick={() => onChange(star)}
          >
            {star <= value ? '★' : '☆'}
          </button>
        ))}
      </div>
    </div>
  );
}
