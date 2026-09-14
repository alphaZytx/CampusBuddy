/*
 * CampusBuddy service worker.
 *
 * Keeps the app shell available so the installed app still opens without signal and
 * can say it is offline, instead of showing the browser's own error page.
 *
 * Deliberately narrow: nothing from /api or /ws is ever cached (that data is private
 * and must always be live), pages come from the network first so a new release is
 * picked up at once, and only the content-hashed build assets are served from cache.
 */

const CACHE = 'campusbuddy-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

/**
 * The page loads its script and stylesheet before this worker takes control, so they
 * would not be cached on a first visit. They are named by content hash, so they are
 * read out of the page itself rather than hard-coded.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const page = await cache.match('/index.html');
  if (!page) return;
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  await cache.addAll(assets);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  // Pages: the network first; the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Build output is named by content hash, so a cached copy can never be stale.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
