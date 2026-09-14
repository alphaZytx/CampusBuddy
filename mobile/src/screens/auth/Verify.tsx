import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SelfUser } from '@campusbuddy/shared';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/toast';
import { Alert, Button, Field, Input, Segmented } from '../../components/ui';

interface OtpResponse {
  sent: true;
  expiresAt: string;
  devMode: boolean;
  devCode?: string;
}

/**
 * Student verification (spec §9, §10).
 *
 * Two independent routes, either of which is enough: a code emailed to the college
 * address, or a GPS reading from inside the campus geofence.
 */
export function Verify(): JSX.Element {
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [method, setMethod] = useState<'email' | 'location'>('email');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<OtpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (user?.isVerified) navigate('/', { replace: true });
  }, [user, navigate]);

  // Simple resend cooldown so the button reflects the server's rate limit.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await api.post<OtpResponse>('/verification/email/request', {});
      setSent(response);
      setCooldown(60);
      if (response.devCode) setCode(response.devCode);
      toast.success('Verification code sent.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await api.post<{ user: SelfUser }>('/verification/email/verify', { code });
      setUser(response.user);
      toast.success('You are verified. Welcome to CampusBuddy!');
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not verify that code.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyLocation(): Promise<void> {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This device cannot share its location. Use email verification instead.');
      return;
    }
    setBusy(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await api.post<{ user: SelfUser }>('/verification/location/verify', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMetres: Math.round(position.coords.accuracy),
          });
          setUser(response.user);
          toast.success('Verified from campus. Welcome!');
          navigate('/', { replace: true });
        } catch (cause) {
          setError(cause instanceof ApiError ? cause.message : 'Could not verify your location.');
        } finally {
          setBusy(false);
        }
      },
      (positionError) => {
        setBusy(false);
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? 'Location permission was denied. Allow it in your browser settings, or verify by email instead.'
            : 'Could not read your location. Try again outdoors, or verify by email.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Verify your account</h1>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <main className="app-main">
        <div className="mb-4">
          <Alert tone="info">
            Verification is what keeps CampusBuddy to students of this campus only. Choose
            whichever is easier — you only need one.
          </Alert>
        </div>

        <div className="mb-4">
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'email', label: '✉️ College email' },
              { value: 'location', label: '📍 On campus' },
            ]}
          />
        </div>

        {error && (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {method === 'email' ? (
          <div className="card stack">
            <div>
              <h3>Verify by college email</h3>
              <p className="small muted mt-2">
                We will send a 6-digit code to <strong>{user?.email}</strong>.
              </p>
            </div>

            {sent?.devMode && (
              <Alert tone="warning" title="Development mode">
                Email delivery is not configured, so the code was printed to the server
                console instead of being sent. It has been filled in for you below.
                {sent.devCode && (
                  <div style={{ fontSize: 22, letterSpacing: 6, fontWeight: 700, marginTop: 8 }}>
                    {sent.devCode}
                  </div>
                )}
              </Alert>
            )}

            {!sent ? (
              <Button size="lg" block onClick={() => void sendCode()} loading={busy}>
                Send verification code
              </Button>
            ) : (
              <>
                <Field label="Enter the 6-digit code" id="code">
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
                  />
                </Field>
                <Button size="lg" block onClick={() => void verifyCode()} loading={busy} disabled={code.length !== 6}>
                  Verify
                </Button>
                <Button variant="ghost" block onClick={() => void sendCode()} disabled={cooldown > 0 || busy}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="card stack">
            <div>
              <h3>Verify from campus</h3>
              <p className="small muted mt-2">
                Share your location once while you are physically on the Bihta campus. Your
                position is checked against the campus boundary and is not tracked afterwards.
              </p>
            </div>
            <Alert tone="info">
              Location works best outdoors. Indoors, GPS accuracy can be too poor to confirm.
            </Alert>
            <Button size="lg" block onClick={() => void verifyLocation()} loading={busy}>
              Share location and verify
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
