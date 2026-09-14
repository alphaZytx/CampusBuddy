import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app: the same student app, packaged with Capacitor. Its screens ship
 * inside the APK and talk to the server whose address is entered on first launch
 * (see src/lib/server.ts).
 *
 * Build it with `npm run android:build` (see DEPLOYMENT.md, "Android app").
 */
const config: CapacitorConfig = {
  appId: 'com.campusbuddy.app',
  appName: 'CampusBuddy',
  webDir: 'dist',
  server: {
    // The app's own screens are served from http://localhost, which browsers treat as a
    // secure origin (so location works) while still being allowed to call a server on
    // plain http — a laptop on the same Wi-Fi during testing. A real server should use
    // https; the server's CORS_ORIGINS must include http://localhost either way.
    androidScheme: 'http',
    cleartext: true,
  },
};

export default config;
