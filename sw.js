const CACHE_NAME = 'finca-pwa-v055-manual-offline';
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
    // Borrar todos los cachés antiguos, incluido el del modelo Vosk pesado
    await Promise.all(keys.filter(k => k.startsWith('finca-pwa-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await Promise.all(keys.filter(k => k.startsWith('finca-voice-model-')).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;
  
  event.respondWith((async () => {
    const reqUrl = new URL(req.url);
    const isAppAsset = req.mode === 'navigate' || /\.(?:html|js|css|webmanifest)$/.test(reqUrl.pathname);
    const cache = await caches.open(CACHE_NAME);
    
    if (isAppAsset) {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh && fresh.ok) await cache.put(new Request(req.url), fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const home = await caches.match('./index.html');
          if (home) return home;
        }
        throw new Error('Recurso no disponible sin conexión: ' + reqUrl.pathname);
      }
    }
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(req);
    if (response && response.ok) await cache.put(new Request(req.url), response.clone());
    return response;
  })());
});
