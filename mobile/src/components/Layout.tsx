import { type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

/** App shell: sticky header, scrolling body, and the bottom tab bar (spec §14). */

export function Screen({
  title,
  back,
  actions,
  children,
  flush,
  hideTabs,
}: {
  title?: string;
  back?: boolean | string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  hideTabs?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const goBack = useAppBack();

  return (
    <div className="app">
      {(title || back || actions) && (
        <header className="app-header">
          {back && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ marginLeft: -8 }}
              onClick={() => (typeof back === 'string' ? navigate(back) : goBack())}
              aria-label="Go back"
            >
              ←
            </button>
          )}
          {title && <h1>{title}</h1>}
          {actions}
        </header>
      )}
      <main className={`app-main${flush ? ' app-main--flush' : ''}`}>{children}</main>
      {!hideTabs && <TabBar />}
    </div>
  );
}

/**
 * Return to the previous in-app route, falling back to Home for a deep link or
 * restored Android activity that has no route history.
 */
export function useAppBack(): () => void {
  const navigate = useNavigate();
  const location = useLocation();

  return (): void => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1);
      return;
    }
    if (location.pathname !== '/') navigate('/', { replace: true });
  };
}

const TABS = [
  { to: '/', icon: '🏠', label: 'Home', end: true },
  { to: '/discover', icon: '🔍', label: 'Discover', end: false },
  { to: '/tasks', icon: '✅', label: 'Tasks', end: false },
  { to: '/lost-found', icon: '🧭', label: 'Lost', end: false },
  { to: '/chat', icon: '💬', label: 'Chat', end: false },
  { to: '/profile', icon: '👤', label: 'Profile', end: false },
] as const;

export function TabBar({ unread }: { unread?: { chat?: number } } = {}): JSX.Element {
  return (
    <nav className="tabbar" aria-label="Main navigation">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          <span className="tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          {tab.label}
          {tab.to === '/chat' && unread?.chat ? (
            <span className="tab-dot">{unread.chat > 9 ? '9+' : unread.chat}</span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
