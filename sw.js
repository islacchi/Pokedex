const CACHE_NAME = 'pokedex-v2';
const IMAGE_CACHE_NAME = 'pokedex-images-v1';
const MAX_IMAGE_ENTRIES = 600;

// Keep the dedicated image cache bounded by evicting oldest entries.
function pruneImageCache(cache, maxEntries) {
  return cache.keys().then((keys) => {
    if (keys.length <= maxEntries) return;
    return Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
  });
}
const CORE_ASSETS = [
  './',
  './index.html',
  './css/main.css',
  './js/app.js',
  './manifest.json',
  './assets/images/icono-pokemon.png'
];

// Image domains to cache separately
const IMAGE_HOSTNAMES = [
  'raw.githubusercontent.com',
  'play.pokemonshowdown.com'
];

// Install: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== IMAGE_CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Check if request is an image
function isImageRequest(url) {
  return IMAGE_HOSTNAMES.some(host => url.hostname.includes(host));
}

// Fetch: network-first for API, cache-first for static assets, dedicated image cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Images: cache-first with background refresh
  if (isImageRequest(url)) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          // Return cached immediately, refresh in background
          const fetchPromise = fetch(event.request).then((response) => {
            cache.put(event.request, response.clone()).then(() => pruneImageCache(cache, MAX_IMAGE_ENTRIES));
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // API requests: network-first with cache fallback
  if (url.hostname.includes('pokeapi.co')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
