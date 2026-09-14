import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { Alert, Button, Field, Input } from '../../components/ui';

export function Login(): JSX.Element {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/welcome" className="btn btn--ghost btn--sm" style={{ marginLeft: -8 }} aria-label="Back">
          ←
        </Link>
        <h1>Sign in</h1>
      </header>
      <main className="app-main">
        <form onSubmit={onSubmit} noValidate>
          {error && (
            <div className="mb-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          <Field label="College email" id="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="name.ug22.cs@nitp.ac.in"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>

          <Field label="Password" id="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <Button type="submit" size="lg" block loading={busy}>
            Sign in
          </Button>
        </form>

        <p className="center small muted mt-4">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </main>
    </div>
  );
}
