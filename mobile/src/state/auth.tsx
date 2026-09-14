import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSession, SelfUser } from '@campusbuddy/shared';
import { ApiError, api, endSession, getAccessToken, saveSession, setSessionLostHandler } from '../lib/api';

/**
 * Session state.
 *
 * The signed-in student is loaded from the server on boot rather than trusted from
 * local storage, so a suspension or a revoked session takes effect the moment the
 * app opens.
 */

interface AuthContextValue {
  user: SelfUser | null;
  /**
   * `offline`: a session is stored but the server could not be reached to load it.
   * The student is still signed in, and loading is retried automatically.
   */
  status: 'loading' | 'authenticated' | 'anonymous' | 'offline';
  signIn(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
  /** Replaces the cached profile, e.g. after verifying or editing it. */
  setUser(user: SelfUser): void;
  refreshUser(): Promise<void>;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  departmentId?: string;
  hostelId?: string;
  yearOfStudy?: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** How often to try again while the server is unreachable. */
const OFFLINE_RETRY_MS = 15_000;

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<SelfUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  const loadCurrentUser = useCallback(async () => {
    if (!getAccessToken()) {
      setStatus('anonymous');
      return;
    }
    try {
      const { user: current } = await api.get<{ user: SelfUser }>('/auth/me');
      setUser(current);
      setStatus('authenticated');
    } catch (cause) {
      // Only a refused session signs the student out. Opening the app with no signal,
      // or while the server restarts, must not throw a perfectly good session away.
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        saveSession(null);
        setUser(null);
        setStatus('anonymous');
      } else {
        setStatus((current) => (current === 'authenticated' ? current : 'offline'));
      }
    }
  }, []);

  useEffect(() => {
    void loadCurrentUser();
    // When a refresh finally fails, drop straight back to the signed-out state.
    setSessionLostHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });
  }, [loadCurrentUser]);

  // While unreachable, try again when the device reconnects, and every so often.
  useEffect(() => {
    if (status !== 'offline') return;
    const retry = (): void => void loadCurrentUser();
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, OFFLINE_RETRY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(timer);
    };
  }, [status, loadCurrentUser]);

  const adopt = useCallback((session: AuthSession) => {
    saveSession({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      adopt(await api.post<AuthSession>('/auth/login', { email, password }));
    },
    [adopt],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      adopt(await api.post<AuthSession>('/auth/register', input));
    },
    [adopt],
  );

  const signOut = useCallback(async () => {
    try {
      // Ends only this device's session, and works even if the access token expired.
      await endSession();
    } catch {
      // Signing out locally matters more than the server call succeeding.
    }
    saveSession(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, signIn, register, signOut, setUser, refreshUser: loadCurrentUser }),
    [user, status, signIn, register, signOut, loadCurrentUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

/** The signed-in student, for screens that only render when authenticated. */
export function useUser(): SelfUser {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called while signed out');
  return user;
}
