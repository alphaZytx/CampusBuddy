import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { api } from '../../lib/api';
import { isNativeApp, serverOrigin } from '../../lib/server';

interface CampusInfo {
  campus: { name: string; institutionShortName: string; emailDomains: string[] };
}

/** First screen: says plainly who this is for before asking for anything. */
export function Welcome(): JSX.Element {
  const { data } = useAsync<CampusInfo>(() => api.get<CampusInfo>('/campus'), []);
  const campus = data?.campus;

  return (
    <div className="app">
      <main className="app-main" style={{ paddingBottom: 'var(--sp-8)' }}>
        <div className="stack stack--lg" style={{ minHeight: '80vh', justifyContent: 'center' }}>
          <div className="center">
            <div
              style={{
                width: 76,
                height: 76,
                margin: '0 auto var(--sp-4)',
                borderRadius: 22,
                background: 'var(--accent)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 38,
              }}
              aria-hidden="true"
            >
              🎓
            </div>
            <h1>CampusBuddy</h1>
            <p className="muted mt-2">
              {campus
                ? `${campus.institutionShortName} · ${campus.name}`
                : 'Your campus help network'}
            </p>
          </div>

          <div className="stack">
            {[
              { icon: '⚡', title: 'Ask, and someone nearby helps', text: 'Snacks, printouts, a charger — post it and set a reward.' },
              { icon: '💰', title: 'Earn in your spare time', text: 'Pick up small tasks between classes and get paid for them.' },
              { icon: '🔒', title: 'Students only', text: 'Every account is verified by college email or campus location.' },
            ].map((item) => (
              <div key={item.title} className="row row--top">
                <span style={{ fontSize: 22 }} aria-hidden="true">
                  {item.icon}
                </span>
                <div>
                  <div className="strong">{item.title}</div>
                  <div className="small muted">{item.text}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="stack stack--sm">
            <Link to="/register" className="btn btn--lg btn--block">
              Create an account
            </Link>
            <Link to="/login" className="btn btn--secondary btn--lg btn--block">
              I already have an account
            </Link>
          </div>

          {campus && (
            <p className="tiny subtle center">
              Only students with a{' '}
              {campus.emailDomains.map((d) => `@${d}`).join(' or ')} address can join.
            </p>
          )}

          <p className="tiny subtle center">
            By using CampusBuddy you agree to its{' '}
            <Link to="/policies">terms, privacy notice and community rules</Link>.
          </p>

          {/* The Android app talks to a server chosen on first launch; say which. */}
          {isNativeApp() && (
            <p className="tiny subtle center">
              Server: {serverOrigin().replace(/^https?:\/\//, '')} · <Link to="/server">Change</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
