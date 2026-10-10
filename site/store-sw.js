const CACHE_NAME = 'marketos-store-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './storefront.html',
  './storefront.css',
  './storefront.js',
  './track-order.html',
  './track-order.css',
  './track-order.js',
  './store-manifest.webmanifest',
  './store-icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('marketos-store-') && key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || /\/api\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request, {ignoreSearch:true}).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request, {ignoreSearch:true}).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }))
  );
});
