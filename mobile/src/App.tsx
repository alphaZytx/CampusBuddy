import { useCallback, useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './state/auth';
import { realtime } from './lib/realtime';
import { api } from './lib/api';
import { hasServer, isNativeApp } from './lib/server';
import { Button, ErrorState } from './components/ui';
import { ServerSetup } from './screens/ServerSetup';
import { Welcome } from './screens/auth/Welcome';
import { Login } from './screens/auth/Login';
import { Register } from './screens/auth/Register';
import { Verify } from './screens/auth/Verify';
import { Home } from './screens/Home';
import { Discover } from './screens/Discover';
import { CreateRequest } from './screens/CreateRequest';
import { RequestDetail } from './screens/RequestDetail';
import { Tasks } from './screens/Tasks';
import { ChatForRequest, ChatList, ChatThread } from './screens/Chat';
import { Profile, UserProfile } from './screens/Profile';
import { CreateListing, ListingDetail, Marketplace } from './screens/Marketplace';
import { CreateRentalItem, RentalDetail, RentalItemDetail, Rentals } from './screens/Rentals';
import { CreateLostFound, LostFound, LostFoundDetail } from './screens/LostFound';
import { LegalDocuments, NotificationSettings, PrivacyCentre } from './screens/Settings';
import {
  CreateDispute,
  DisputeDetail,
  Disputes,
  CreateReport,
  Earnings,
  Favourites,
  NotFound,
  Notifications,
} from './screens/Misc';

export function App(): JSX.Element {
  const { status, user, refreshUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // The Android app needs a server address before anything else can load.
  const [needsServer, setNeedsServer] = useState(() => !hasServer());
  const onServerSaved = useCallback(() => {
    setNeedsServer(false);
    navigate('/welcome', { replace: true });
    void refreshUser();
  }, [navigate, refreshUser]);

  // One socket for the whole session, opened once the student is signed in.
  useEffect(() => {
    if (status === 'authenticated') realtime.connect();
    else realtime.disconnect();
    return () => {
      if (status !== 'authenticated') realtime.disconnect();
    };
  }, [status]);

  // Every navigation starts at the top of the new screen.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Capacitor's default Android back behaviour exits the activity. Handle it in
  // the router so the device back button matches the back arrow on every screen.
  useEffect(() => {
    let removed = false;
    let listener: { remove: () => Promise<void> } | undefined;

    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      // Sheets and other temporary UI should be dismissed before changing routes.
      // `Sheet` prevents the default event while it is open.
      if (!window.dispatchEvent(new Event('campusbuddy:back', { cancelable: true }))) return;

      const historyIndex = window.history.state?.idx;
      if (canGoBack && typeof historyIndex === 'number' && historyIndex > 0) {
        navigate(-1);
      } else if (location.pathname !== '/') {
        navigate('/', { replace: true });
      }
    }).then((handle) => {
      if (removed) void handle.remove();
      else listener = handle;
    });

    return () => {
      removed = true;
      if (listener) void listener.remove();
    };
  }, [location.pathname, navigate]);

  // Register the signed-in Android device for FCM and turn notification taps into
  // normal router navigation. In browsers the existing realtime inbox remains active.
  useEffect(() => {
    if (status !== 'authenticated' || !user || !isNativeApp()) return;
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void Promise.all([
      PushNotifications.addListener('registration', (token) => {
        void CapacitorApp.getInfo()
          .then((info) => api.post('/push/devices', {
            token: token.value,
            platform: 'ANDROID',
            deviceName: navigator.userAgent.slice(0, 120),
            appVersion: info.version,
          }))
          .catch(() => undefined);
      }),
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const path = action.notification.data?.path;
        if (typeof path === 'string' && path.startsWith('/')) navigate(path);
        else navigate('/notifications');
      }),
    ]).then((registered) => {
      if (disposed) registered.forEach((handle) => void handle.remove());
      else handles.push(...registered);
    });

    void PushNotifications.createChannel({
      id: 'campusbuddy_updates',
      name: 'CampusBuddy updates',
      description: 'Requests, messages, payments and rental updates',
      importance: 4,
      visibility: 1,
    }).catch(() => undefined);
    void PushNotifications.requestPermissions().then((permission) => {
      if (permission.receive === 'granted') return PushNotifications.register();
      return undefined;
    });

    return () => {
      disposed = true;
      handles.forEach((handle) => void handle.remove());
    };
  }, [status, user, navigate]);

  if (needsServer) return <ServerSetup onSaved={onServerSaved} />;

  if (status === 'loading') {
    return (
      <div className="app">
        <main className="app-main" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
          <div className="center">
            <span className="spinner" style={{ width: 28, height: 28, color: 'var(--accent)' }} />
            <p className="small muted mt-3">Loading CampusBuddy…</p>
          </div>
        </main>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="app">
        <main className="app-main" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
          <div className="stack">
            <ErrorState
              message="Can’t reach CampusBuddy right now. You are still signed in, and the app will reconnect by itself."
              onRetry={() => void refreshUser()}
            />
            {isNativeApp() && (
              <Button variant="ghost" block onClick={() => setNeedsServer(true)}>
                Change server address
              </Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/server" element={<ServerSetup onSaved={onServerSaved} />} />
        <Route path="/policies" element={<LegalDocuments />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  // Verification gates the whole app, because an unverified student cannot transact.
  if (user && !user.isVerified) {
    return (
      <Routes>
        <Route path="/verify" element={<Verify />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/policies" element={<LegalDocuments />} />
        <Route path="*" element={<Navigate to="/verify" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/discover" element={<Discover />} />
      <Route path="/create" element={<CreateRequest />} />
      <Route path="/requests/:id" element={<RequestDetail />} />
      <Route path="/tasks" element={<Tasks />} />

      <Route path="/chat" element={<ChatList />} />
      <Route path="/chat/:id" element={<ChatThread />} />
      <Route path="/chat/request/:requestId" element={<ChatForRequest />} />

      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="/marketplace/new" element={<CreateListing />} />
      <Route path="/marketplace/:id" element={<ListingDetail />} />

      <Route path="/lost-found" element={<LostFound />} />
      <Route path="/lost-found/new" element={<CreateLostFound />} />
      <Route path="/lost-found/:id" element={<LostFoundDetail />} />

      <Route path="/rentals" element={<Rentals />} />
      <Route path="/rentals/new" element={<CreateRentalItem />} />
      <Route path="/rentals/item/:id" element={<RentalItemDetail />} />
      <Route path="/rentals/:id" element={<RentalDetail />} />

      <Route path="/profile" element={<Profile />} />
      <Route path="/users/:id" element={<UserProfile />} />
      <Route path="/favourites" element={<Favourites />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/earnings" element={<Earnings />} />
      <Route path="/settings/notifications" element={<NotificationSettings />} />
      <Route path="/settings/privacy" element={<PrivacyCentre />} />
      <Route path="/policies" element={<LegalDocuments />} />

      <Route path="/disputes/new" element={<CreateDispute />} />
      <Route path="/disputes" element={<Disputes />} />
      <Route path="/disputes/:id" element={<DisputeDetail />} />
      <Route path="/reports/new" element={<CreateReport />} />

      <Route path="/verify" element={<Navigate to="/" replace />} />
      <Route path="/welcome" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route path="/server" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
