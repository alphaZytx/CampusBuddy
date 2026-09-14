import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { SelfUser } from '@campusbuddy/shared';
import { ADMIN_ROLES } from '@campusbuddy/shared';
import { ApiError, api, endSession, getAccessToken, saveSession, setSessionLostHandler } from './lib/api';
import { Dashboard } from './screens/Dashboard';
import { Users } from './screens/Users';
import { Reports } from './screens/Reports';
import { Disputes } from './screens/Disputes';
import { RequestsTable } from './screens/RequestsTable';
import { CampusSettings } from './screens/CampusSettings';
import { AuditLog } from './screens/AuditLog';
import { Safety } from './screens/Safety';
import { Operations } from './screens/Operations';
import { LostFoundAdmin } from './screens/LostFound';

/** How often to try again while the server is unreachable. */
const OFFLINE_RETRY_MS = 15_000;

/**
 * Admin panel (spec §59, §88).
 *
 * Access is decided by the server on every request; this only decides what to
 * render. A student who reaches this URL is told plainly that it is not for them.
 */
export function App(): JSX.Element {
  const [user, setUser] = useState<SelfUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'in' | 'out' | 'offline'>('loading');
  const [counts, setCounts] = useState({ reports: 0, disputes: 0 });

  const load = useCallback(async () => {
    if (!getAccessToken()) {
      setStatus('out');
      return;
    }
    try {
      const { user: current } = await api.get<{ user: SelfUser }>('/auth/me');
      setUser(current);
      setStatus('in');
    } catch (cause) {
      // Only a refused session signs staff out; an unreachable server does not.
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        saveSession(null);
        setStatus('out');
      } else {
        setStatus((current) => (current === 'in' ? current : 'offline'));
      }
    }
  }, []);

  useEffect(() => {
    void load();
    setSessionLostHandler(() => {
      setUser(null);
      setStatus('out');
    });
  }, [load]);

  useEffect(() => {
    if (status !== 'offline') return;
    const retry = (): void => void load();
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, OFFLINE_RETRY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(timer);
    };
  }, [status, load]);

  const isStaff = user !== null && ADMIN_ROLES.includes(user.role);

  useEffect(() => {
    if (!isStaff) return;
    void api
      .get<{ openReports: number; openDisputes: number }>('/admin/analytics')
      .then((analytics) => setCounts({ reports: analytics.openReports, disputes: analytics.openDisputes }))
      .catch(() => undefined);
  }, [isStaff]);

  /** Ends this browser's session only; the server call needs no valid access token. */
  const signOut = useCallback(() => {
    void endSession().catch(() => undefined);
    saveSession(null);
    setUser(null);
    setStatus('out');
  }, []);

  if (status === 'loading') {
    return (
      <div className="admin-login">
        <span className="spinner" style={{ width: 28, height: 28, color: 'var(--accent)' }} />
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="admin-login">
        <div className="card center">
          <h2>Can’t reach CampusBuddy</h2>
          <p className="muted mt-3">
            The server is not responding. You are still signed in, and this page will reconnect by
            itself.
          </p>
          <button type="button" className="btn btn--secondary mt-4" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (status === 'out') return <Login onSignedIn={load} />;

  if (!isStaff) {
    return (
      <div className="admin-login">
        <div className="card center">
          <h2>Not a staff account</h2>
          <p className="muted mt-3">
            This panel is for campus moderators and administrators. Your account is a student
            account.
          </p>
          <button type="button" className="btn btn--secondary mt-4" onClick={signOut}>
            Sign in with a different account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span aria-hidden="true">🎓</span> CampusBuddy
        </div>
        <nav className="admin-nav">
          <NavLink to="/" end>
            <span aria-hidden="true">📊</span> Dashboard
          </NavLink>
          <NavLink to="/users">
            <span aria-hidden="true">👥</span> Students
          </NavLink>
          <NavLink to="/requests">
            <span aria-hidden="true">📋</span> Requests
          </NavLink>
          <NavLink to="/lost-found">
            <span aria-hidden="true">🧭</span> Lost & Found
          </NavLink>
          <NavLink to="/reports">
            <span aria-hidden="true">🚩</span> Reports
            {counts.reports > 0 && <span className="count">{counts.reports}</span>}
          </NavLink>
          <NavLink to="/disputes">
            <span aria-hidden="true">⚖️</span> Disputes
            {counts.disputes > 0 && <span className="count">{counts.disputes}</span>}
          </NavLink>
          <NavLink to="/safety">
            <span aria-hidden="true">🛡️</span> Safety
          </NavLink>
          <NavLink to="/campus">
            <span aria-hidden="true">🏫</span> Campus
          </NavLink>
          <NavLink to="/audit">
            <span aria-hidden="true">📜</span> Audit log
          </NavLink>
          {user?.role !== 'MODERATOR' && <NavLink to="/operations">
            <span aria-hidden="true">⚙️</span> Operations
          </NavLink>}
        </nav>
        <div style={{ marginTop: 'auto', padding: 'var(--sp-3)' }}>
          <div className="small strong truncate">{user?.fullName}</div>
          <div className="tiny muted">{user?.role.replace(/_/g, ' ').toLowerCase()}</div>
          <button type="button" className="btn btn--secondary btn--sm btn--block mt-3" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<Users currentRole={user!.role} />} />
          <Route path="/requests" element={<RequestsTable />} />
          <Route path="/lost-found" element={<LostFoundAdmin />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route path="/safety" element={<Safety />} />
          <Route path="/campus" element={<CampusSettings canEdit={user!.role !== 'MODERATOR'} />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
        email: email.trim(),
        password,
      });
      saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
      await onSignedIn();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="card" onSubmit={submit}>
        <div className="center mb-4">
          <div style={{ fontSize: 34 }} aria-hidden="true">
            🎓
          </div>
          <h2 className="mt-2">CampusBuddy Admin</h2>
          <p className="small muted mt-2">NIT Patna · Bihta Campus</p>
        </div>

        {error && <div className="alert alert--error mb-4">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn btn--block btn--lg" disabled={busy}>
          {busy && <span className="spinner" />} Sign in
        </button>
      </form>
    </div>
  );
}
