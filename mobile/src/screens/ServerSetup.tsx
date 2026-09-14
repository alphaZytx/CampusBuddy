import { useState, type FormEvent } from 'react';
import { saveSession } from '../lib/api';
import { SUGGESTED_SERVER, normaliseServer, saveServerOrigin, serverOrigin } from '../lib/server';
import { Alert, Button, Field, Input } from '../components/ui';

/**
 * Server address, for the Android app only — the web app is served by its server and
 * never shows this. The address is checked before it is saved, so a typo is caught
 * here instead of surfacing later as "offline".
 */
export function ServerSetup({ onSaved }: { onSaved: () => void }): JSX.Element {
  const current = serverOrigin();
  const [address, setAddress] = useState(current || SUGGESTED_SERVER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(event: FormEvent): Promise<void> {
    event.preventDefault();
    const origin = normaliseServer(address);
    if (!origin) {
      setError('Enter the server address, for example https://campusbuddy.example.edu');
      return;
    }

    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: controller.signal });
      const body = (await response.json()) as { status?: string };
      if (!response.ok || body.status !== 'ok') throw new Error('Not a CampusBuddy server');

      // A session belongs to the server that issued it.
      if (origin !== current) saveSession(null);
      saveServerOrigin(origin);
      onSaved();
    } catch {
      setError(
        `Could not reach a CampusBuddy server at ${origin}. Check the address, and that this phone can reach it — the same Wi-Fi as the server, or a server on the internet.`,
      );
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Connect to CampusBuddy</h1>
      </header>
      <main className="app-main">
        <p className="muted mb-4">
          Enter the address of your campus's CampusBuddy server. You only need to do this once.
        </p>
        <form onSubmit={connect} noValidate>
          {error && (
            <div className="mb-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          <Field
            label="Server address"
            id="server"
            hint="For example https://campusbuddy.example.edu, or http://192.168.1.20:4000 on the same Wi-Fi."
          >
            <Input
              id="server"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://campusbuddy.example.edu"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" block loading={busy}>
            Connect
          </Button>
        </form>
      </main>
    </div>
  );
}
