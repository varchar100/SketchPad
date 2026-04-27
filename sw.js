const CACHE_NAME = 'pizzaboard-v1.7';
const ASSETS = [
  './index.html',
  './terms.html',
  './manifest.json',
  './style.css',
  './app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(response => response || fetch(e.request)));
});
