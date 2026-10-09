// Offline shell: cache the app files, never the API. Bump VERSION on every deploy.
const VERSION = 'amplify-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './vendor/supabase.js',
  './js/app.js', './js/api.js', './js/store.js', './js/ui.js',
  './js/views/auth.js', './js/views/home.js', './js/views/me.js', './js/views/admin-posts.js', './js/views/admin-people.js',
  './icons/mark.png', './icons/logo-ondark.png', './icons/icon-192.png', './icons/favicon-64.png',
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  // Stale-while-revalidate for the shell and fonts.
  event.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: sameOrigin });
    const network = fetch(request).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    }).catch(() => cached);
    return cached ?? network;
  }));
});
