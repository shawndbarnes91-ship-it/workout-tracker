// Service worker. Every path is relative so the app works from a GitHub Pages
// project subpath. App files (html, js, css, manifest) are network first, so a
// deploy shows up on the next launch; the cached copy is used when offline. The
// pinned CDN libraries are cache first. Bump VERSION whenever app files change.

const VERSION = 'v2';
const NETWORK_TIMEOUT_MS = 4000; // slow gym signal: fall back to the cached copy
const SHELL_CACHE = `wt-shell-${VERSION}`;
const CDN_CACHE = 'wt-cdn-v1';
const PHOTO_CACHE = 'wt-photos';

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './js/app.js',
  './js/util.js',
  './js/db.js',
  './js/seed.js',
  './js/sync.js',
  './js/photos.js',
  './js/timer.js',
  './js/prs.js',
  './js/lifting-data.js',
  './js/library.js',
  './js/templates.js',
  './js/workout.js',
  './js/cardio.js',
  './js/diet.js',
  './js/supplements.js',
  './js/progress.js',
  './js/stats.js',
  './js/export.js',
];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // One missing file (for example icons not generated yet) must not block install.
    await Promise.all(SHELL_FILES.map((u) => shell.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_FILES.map(async (u) => {
      if (await cdn.match(u)) return;
      try {
        const res = await fetch(new Request(u, { mode: 'cors' }));
        if (res.ok) await cdn.put(u, res);
      } catch (e) {
        /* fetched again at runtime */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const keep = new Set([SHELL_CACHE, CDN_CACHE, PHOTO_CACHE]);
    await Promise.all(keys.filter((k) => k.startsWith('wt-') && !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Fetch that skips the HTTP cache's stale copy (revalidates) and gives up after a timeout. */
function freshFetch(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await freshFetch(request.url);
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (e) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

/** App code: network first so deploys are picked up; the cached copy keeps it working offline. */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await freshFetch(request.url);
    if (res.ok) {
      cache.put(request, res.clone());
      return res;
    }
    return (await cache.match(request, { ignoreSearch: true })) || res;
  } catch (e) {
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(networkFirstPage(req));
      return;
    }
    event.respondWith(networkFirst(req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }
  // Public photos in the Supabase "photos" bucket: keep a copy for offline viewing.
  if (url.pathname.includes('/storage/v1/object/public/photos/')) {
    event.respondWith(cacheFirst(req, PHOTO_CACHE));
  }
  // Everything else (the Supabase database API) goes straight to the network.
});
