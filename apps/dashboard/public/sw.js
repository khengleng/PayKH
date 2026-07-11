// Minimal offline-first service worker: cache the app shell, network-first for
// navigations with a cached fallback so the merchant app opens offline.
const CACHE = 'paykh-v1';
const SHELL = ['/overview', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    e.respondWith(fetch(request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(request, cp)); return r; }).catch(() => caches.match(request).then((m) => m || caches.match('/overview'))));
  }
});
