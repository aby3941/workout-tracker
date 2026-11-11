// Offline service worker. Bump CACHE on every deploy so installed phones pick up the new files.
const CACHE = 'ppl-v5';

// Every file in public/ (keep in sync when files are added or removed).
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/analysis.js',
  './js/charts.js',
  './js/csv.js',
  './js/dates.js',
  './js/html.js',
  './js/parser.js',
  './js/program.js',
  './js/progression.js',
  './js/store.js',
  './js/units.js',
  './js/ui/chart-ui.js',
  './js/ui/data.js',
  './js/ui/dom.js',
  './js/ui/history.js',
  './js/ui/model.js',
  './js/ui/pickers.js',
  './js/ui/plan.js',
  './js/ui/progress.js',
  './js/ui/sheets.js',
  './js/ui/today.js',
  './favicon.ico',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Hosts that redirect /index.html → / (Cloudflare Pages does) leave a "redirected" response in the
// cache; browsers refuse those for navigations, so serve a clean copy instead.
async function usable(response) {
  if (!response || !response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  const isNavigation = request.mode === 'navigate';

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: isNavigation });
    if (cached) return usable(cached);
    try {
      return await fetch(request);
    } catch (error) {
      if (isNavigation) {
        const shell = (await caches.match('./')) || (await caches.match('./index.html'));
        if (shell) return usable(shell);
      }
      throw error;
    }
  })());
});
