const CACHE_NAME = 'finca-pwa-v051-voz-local';
const VOICE_MODEL_CACHE = 'finca-voice-model-cache-v2';
const VOSK_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.5/dist/vosk.js?v=051';
const VOSK_PACKAGE_PREFIX = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.5/';
const CORE_ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/config.js', './js/api.js', './js/db.js', './js/voice.js',
  './js/camera.js', './js/sync.js', './js/app.js', './js/html5-qrcode.min.js'
];

async function cacheVoskRuntime(cache) {
  try {
    const existing = await cache.match(VOSK_URL);
    if (existing) return;
    const response = await fetch(VOSK_URL, { mode: 'cors', cache: 'no-cache' });
    if (response.ok) await cache.put(VOSK_URL, response.clone());
  } catch (error) {
    // La instalación de la PWA no se aborta. El estado de voz informará si el runtime no quedó guardado.
    console.warn('No se pudo guardar Vosk para uso offline:', error);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map(url => cache.add(url).catch(() => null)));
    await cacheVoskRuntime(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Nunca borrar el caché grande del modelo local.
    await Promise.all(keys.filter(k => (k.startsWith('finca-pwa-') && k !== CACHE_NAME) || k === 'finca-voice-model-cache-v1').map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const requested = url.href.split('?')[0];

  // Guardar tanto el bundle principal como cualquier recurso del paquete Vosk (worker/WASM)
  // que la versión publicada solicite, para que pueda reutilizarse en modo avión.
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
        throw new Error('Falta un recurso local del motor Vosk en el caché del teléfono. Conéctese y vuelva a preparar la voz.');
      }
    })());
    return;
  }

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
    // Primero caché: incluye recursos estáticos y respaldos de modelos/partes ya descargadas.
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(req);
    if (response && response.ok) await cache.put(new Request(req.url), response.clone());
    return response;
  })());
});
