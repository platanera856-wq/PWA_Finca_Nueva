const CACHE_NAME = 'finca-pwa-v030-catalogos-voz';
const CORE_ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/config.js', './js/api.js', './js/db.js', './js/voice.js',
  './js/camera.js', './js/sync.js', './js/app.js'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // No abortar toda la instalación si por un momento falla un recurso secundario.
    await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(() => null)));
    // La biblioteca QR debe estar alojada en el propio proyecto para trabajar sin CDN.
    await cache.add('./js/html5-qrcode.min.js').catch(() => null);
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
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(req, {ignoreSearch: true});
    if (cached) {
      // Revalidate assets quietly when online; return cached copy immediately for reliability.
      fetch(req).then(async response => { if (response && response.ok) { const cache = await caches.open(CACHE_NAME); await cache.put(req, response.clone()); } }).catch(() => {});
      return cached;
    }
    try {
      const response = await fetch(req);
      if (response && response.ok) { const cache = await caches.open(CACHE_NAME); await cache.put(req, response.clone()); }
      return response;
    } catch (e) {
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw e;
    }
  })());
});
