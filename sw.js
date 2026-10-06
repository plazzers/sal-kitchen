// Service worker: keeps a copy of the app on the device so it works offline.
// When you change files, the app picks them up automatically on the next visit or two.
// Changing VERSION forces every device to download a fresh copy of everything.
const VERSION = '1';
const CACHE = 'sals-kitchen-v' + VERSION;

const FILES = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './manifest.webmanifest',
  './data/recipes.js',
  './js/app.js',
  './js/db.js',
  './js/icons.js',
  './js/install.js',
  './js/scale.js',
  './js/sha256.js',
  './js/timers.js',
  './js/util.js',
  './assets/sal-avatar.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sals-kitchen-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Show the saved copy right away (fast and offline-proof), and quietly
// fetch a fresh copy in the background for next time.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(fresh);
        return cached;
      }
      const res = await fresh;
      if (res) return res;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('You are offline and this file is not saved on this device yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })
  );
});
