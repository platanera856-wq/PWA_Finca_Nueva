const CACHE = "pwa-finca-inicial-v1";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./css/app.css", "./js/config.js", "./js/db.js", "./js/voice.js", "./js/camera.js", "./js/sync.js", "./js/app.js"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
 if (e.request.method !== "GET") return;
 e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
  if (res && res.ok && new URL(e.request.url).origin === self.location.origin) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
  return res;
 }).catch(() => caches.match("./index.html"))));
});
