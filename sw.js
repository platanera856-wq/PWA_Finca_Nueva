const CACHE_NAME = 'finca-pwa-v040-preguntas-automaticas';
const CORE_ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/config.js', './js/api.js', './js/db.js', './js/voice.js',
  './js/camera.js', './js/sync.js', './js/app.js', './js/html5-qrcode.min.js'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('finca-pwa-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const isAppAsset = req.mode === 'navigate' || /\.(?:html|js|css|webmanifest)$/.test(url.pathname);
    if (isAppAsset) {
      // Network-first while connected prevents old interview logic staying active after updates.
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const home = await caches.match('./index.html');
          if (home) return home;
        }
        throw new Error('Recurso no disponible sin conexión: ' + url.pathname);
      }
    }
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(req);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(req, response.clone());
    }
    return response;
  })());
});
