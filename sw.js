const CACHE_NAME = 'finca-pwa-v053-voz-local'; // Versión actualizada
const VOICE_MODEL_CACHE = 'finca-voice-model-cache-v3';
const VOSK_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.5/dist/vosk.js?v=051';
const VOSK_PACKAGE_PREFIX = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.5/';

const CORE_ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/config.js', './js/api.js', './js/db.js', './js/voice.js',
  './js/camera.js', './js/sync.js', './js/app.js', './js/html5-qrcode.min.js'
];

const VOICE_MODEL_ASSETS = [
  './vosk-model-small-es-0.42.part01',
  './vosk-model-small-es-0.42.part02'
];

async function cacheVoskRuntime(cache) {
  try {
    const existing = await cache.match(VOSK_URL);
    if (existing) return;
    const response = await fetch(VOSK_URL, { mode: 'cors', cache: 'no-cache' });
    if (response.ok) await cache.put(VOSK_URL, response.clone());
  } catch (error) {
    console.warn('No se pudo guardar Vosk para uso offline:', error);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(() => null)));
    await cacheVoskRuntime(cache);
    await Promise.all(VOICE_MODEL_ASSETS.map(url => cache.add(url).catch(err => console.warn('Error guardando modelo:', err))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('finca-pwa-') && k !== CACHE_NAME) || k === 'finca-voice-model-cache-v2').map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.href.startsWith(VOSK_PACKAGE_PREFIX)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const key = new Request(req.url, { method: 'GET', mode: 'cors', credentials: 'omit' });
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh && fresh.ok) {
          try { await cache.put(key, fresh.clone()); } catch (_) {}
        }
        return fresh;
      } catch (_) {
        const cached = await cache.match(key) || await cache.match(req.url.split('?')[0]);
        if (cached) return cached;
        throw new Error('Falta un recurso local del motor Vosk.');
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const reqUrl = new URL(req.url);
    const isAppAsset = req.mode === 'navigate' || /\.(?:html|js|css|webmanifest|part01|part02)$/.test(reqUrl.pathname);
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
