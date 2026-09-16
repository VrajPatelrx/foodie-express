const CACHE_NAME = 'foodie-express-v5';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/customer.html',
  '/vendor.html',
  '/rider.html',
  '/admin.html',
  '/showcase.html',
  '/css/style.css',
  '/js/api.js',
  '/js/login.js',
  '/js/customer.js',
  '/js/vendor.js',
  '/js/rider.js',
  '/js/admin.js',
  '/js/showcase.js',
  '/manifest.json',
  '/icons/icon.svg'
];

// 1. Install Event: Cache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW pre-cache warning:', err);
      });
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Clean up outdated cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: Intelligent Interception
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Non-GET requests (POST, PATCH) cannot be cached
  if (req.method !== 'GET') {
    return;
  }

  // Real-time API & Socket.io traffic: Network-First (always fresh live data)
  if (url.pathname.startsWith('/api/') || url.pathname.includes('socket.io')) {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match(req);
      })
    );
    return;
  }

  // Static Assets (CSS, JS, Images, HTML): Stale-While-Revalidate / Cache-First
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      // Return cached asset immediately if found, while fetching update in background
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
