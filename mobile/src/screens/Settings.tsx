import { useEffect, useState } from 'react';
import type { LegalDocument, ModerationAction, NotificationPreferences, SafetyControl, SelfUser } from '@campusbuddy/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { Screen } from '../components/Layout';
import { Alert, Button, EmptyState, ErrorState, Field } from '../components/ui';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';

const NOTIFICATION_OPTIONS: Array<{ key: keyof NotificationPreferences; label: string; description: string }> = [
  { key: 'newMatchingRequests', label: 'Matching requests', description: 'New requests matching your categories, reward and distance.' },
  { key: 'offers', label: 'Offers and selections', description: 'Offers, selections and reward changes.' },
  { key: 'chat', label: 'Chat messages', description: 'New messages from transaction partners.' },
  { key: 'payments', label: 'Payments', description: 'Payment claims, confirmations and problems.' },
  { key: 'rentals', label: 'Rentals', description: 'Bookings, handovers and returns.' },
  { key: 'ratings', label: 'Ratings', description: 'New reviews and reminders to rate.' },
  { key: 'reminders', label: 'Reminders', description: 'Deadlines, payments and items due back.' },
  { key: 'lostFound', label: 'Lost & Found', description: 'Possible matches, private responses and item updates.' },
];

export function NotificationSettings(): JSX.Element {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(user?.notificationPreferences ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPrefs(user?.notificationPreferences ?? null), [user]);
  if (!user || !prefs) return <Screen title="Notifications" back>{null}</Screen>;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const { user: updated } = await api.patch<{ user: SelfUser }>('/users/me/notification-preferences', prefs);
      setUser(updated);
      toast.success('Notification preferences saved.');
    } catch {
      toast.error('Could not save notification preferences.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Notification settings" back>
      <div className="card stack mb-4">
        {NOTIFICATION_OPTIONS.map((option) => (
          <label className="row row--top" key={option.key} style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(prefs[option.key])}
              onChange={(event) => setPrefs({ ...prefs, [option.key]: event.target.checked })}
              style={{ width: 20, height: 20, marginTop: 2 }}
            />
            <span>
              <span className="strong">{option.label}</span>
              <span className="small muted" style={{ display: 'block' }}>{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="card mb-4">
        <h2 className="mb-3">Quiet hours</h2>
        <p className="small muted mb-3">Ordinary alerts wait during this window. Urgent safety and selection alerts still arrive.</p>
        <div className="grid-2">
          <Field label="Start">
            <select className="select" value={prefs.quietHoursStart ?? ''} onChange={(event) => setPrefs({ ...prefs, quietHoursStart: event.target.value === '' ? null : Number(event.target.value) })}>
              <option value="">Off</option>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </Field>
          <Field label="End">
            <select className="select" value={prefs.quietHoursEnd ?? ''} onChange={(event) => setPrefs({ ...prefs, quietHoursEnd: event.target.value === '' ? null : Number(event.target.value) })}>
              <option value="">Off</option>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </Field>
        </div>
      </div>

      <Button size="lg" block loading={busy} onClick={() => void save()}>Save settings</Button>
    </Screen>
  );
}

export function PrivacyCentre(): JSX.Element {
  const { signOut } = useAuth();
  const toast = useToast();
  const documents = useAsync<{ documents: LegalDocument[] }>((signal) => api.get<{ documents: LegalDocument[] }>('/privacy/documents', signal), []);
  const controls = useAsync<{ controls: SafetyControl[] }>((signal) => api.get<{ controls: SafetyControl[] }>('/safety/controls', signal), []);
  const actions = useAsync<{ actions: ModerationAction[] }>((signal) => api.get<{ actions: ModerationAction[] }>('/safety/actions', signal), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function downloadData(): Promise<void> {
    setBusy('export');
    try {
      const data = await api.get<Record<string, unknown>>('/privacy/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `campusbuddy-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not prepare your data export.');
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(): Promise<void> {
    if (!window.confirm('Deactivate your account and sign out of every device?')) return;
    setBusy('deactivate');
    try {
      await api.post('/privacy/deactivate', { confirmation: 'DEACTIVATE' });
      await signOut();
    } catch {
      toast.error('Could not deactivate your account.');
      setBusy(null);
    }
  }

  async function deleteAccount(): Promise<void> {
    const confirmation = window.prompt('This permanently anonymises your account. Type DELETE MY ACCOUNT to continue.');
    if (confirmation !== 'DELETE MY ACCOUNT') return;
    setBusy('delete');
    try {
      await api.delete('/privacy/account', { confirmation });
      await signOut();
    } catch {
      toast.error('Could not delete your account.');
      setBusy(null);
    }
  }

  return (
    <Screen title="Privacy & safety" back>
      <Alert tone="info" title="You control your data">
        Location is used only when you explicitly share it. Payment screenshots and QR codes remain private to the relevant transaction.
      </Alert>

      <h2 className="mt-4 mb-3">Policies and consent</h2>
      {documents.loading && !documents.data ? <div className="skeleton" style={{ height: 120 }} /> : documents.error ? <ErrorState message={documents.error} onRetry={documents.reload} /> : (
        <div className="stack">
          {documents.data?.documents.map((document) => (
            <details className="card card--flat" key={document.documentType}>
              <summary className="strong">{document.title} · {document.version}</summary>
              <p className="small muted mt-3">{document.content}</p>
              <div className="mt-3">
                {document.acceptedAt ? <span className="badge badge--success">Accepted</span> : (
                  <Button size="sm" onClick={() => void api.post('/privacy/consents', { documentType: document.documentType, version: document.version, accepted: true }).then(documents.reload)}>Accept</Button>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      <h2 className="mt-4 mb-3">Blocked and muted students</h2>
      {controls.data?.controls.length ? (
        <div className="card card--pad-0"><div className="list">
          {controls.data.controls.map((control) => (
            <div className="list-row" key={control.user.id}>
              <div className="body"><div className="strong">{control.user.fullName}</div><div className="small muted">{control.blocked ? 'Blocked' : 'Muted'}</div></div>
              <Button size="sm" variant="secondary" onClick={() => void api.delete(`/safety/controls/${control.user.id}`).then(controls.reload)}>Remove</Button>
            </div>
          ))}
        </div></div>
      ) : <EmptyState emoji="🛡️" title="No blocked students" message="Block or mute someone from their profile." />}

      {actions.data && actions.data.actions.length > 0 && (
        <><h2 className="mt-4 mb-3">Moderation history</h2><div className="stack">
          {actions.data.actions.map((action) => (
            <div className="card card--flat" key={action.id}>
              <span className="badge badge--warning">{action.actionType.toLowerCase()}</span>
              <p className="small mt-2">{action.reason}</p>
              {!action.appealed && <Button className="mt-3" size="sm" variant="secondary" onClick={() => {
                const statement = window.prompt('Explain why this action should be reviewed:');
                if (statement && statement.trim().length >= 10) void api.post('/safety/appeals', { moderationActionId: action.id, statement }).then(actions.reload);
              }}>Appeal</Button>}
            </div>
          ))}
        </div></>
      )}

      <h2 className="mt-4 mb-3">Your account data</h2>
      <div className="stack stack--sm">
        <Button variant="secondary" block loading={busy === 'export'} onClick={() => void downloadData()}>Download my data</Button>
        <Button variant="secondary" block loading={busy === 'deactivate'} onClick={() => void deactivate()}>Deactivate account</Button>
        <Button variant="danger" block loading={busy === 'delete'} onClick={() => void deleteAccount()}>Delete and anonymise account</Button>
      </div>
    </Screen>
  );
}

export function LegalDocuments(): JSX.Element {
  const state = useAsync<{ documents: LegalDocument[] }>((signal) => api.get<{ documents: LegalDocument[] }>('/privacy/documents', signal), []);
  return (
    <Screen title="Policies" back="/welcome" hideTabs>
      {state.loading && !state.data ? <div className="skeleton" style={{ height: 180 }} /> : state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : (
        <div className="stack">{state.data?.documents.map((document) => <div className="card" key={document.documentType}><h2>{document.title}</h2><p className="small muted mt-3">{document.content}</p><p className="tiny subtle mt-3">Version {document.version} · effective {new Date(document.effectiveAt).toLocaleDateString('en-IN')}</p></div>)}</div>
      )}
    </Screen>
  );
}
