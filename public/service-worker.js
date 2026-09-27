// ===== SERVICE WORKER FOR HAWI'S LOVADA POS =====
const CACHE_VERSION = 'hawi-v5';
const STATIC_CACHE = 'hawi-static-' + CACHE_VERSION;
const DATA_CACHE = 'hawi-data-' + CACHE_VERSION;

const STATIC_FILES = [
    '/',
    '/index.html',
    '/login.html',
    '/orders.html',
    '/offline.html',
    '/manifest.json',
    '/logo.png',
    '/theme.js',
    '/role-guard.js',
    '/offline-sync.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            console.log('[SW] Caching static files');
            return cache.addAll(STATIC_FILES).catch(err => {
                console.log('[SW] Some files failed to cache:', err);
            });
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => {
                if (key !== STATIC_CACHE && key !== DATA_CACHE) {
                    console.log('[SW] Removing old cache:', key);
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = event.request.url;

    if (event.request.method !== 'GET') return;
    if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return;
    if (!url.startsWith(self.location.origin) && !url.includes('cdn.jsdelivr.net')) return;

    const isHTML = event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/');
    const isAPI = url.includes('/api/');

    if (isAPI) {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(DATA_CACHE).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                return caches.match(event.request).then(cached => {
                    if (cached) return cached;
                    return new Response(JSON.stringify({ offline: true, error: 'Offline' }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
            })
        );
        return;
    }

    if (isHTML) {
        event.respondWith(
            fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(STATIC_CACHE).then(cache => cache.put(event.request, clone));
                return response;
            }).catch(() => {
                return caches.match(event.request).then(cached => cached || caches.match('/offline.html'));
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(STATIC_CACHE).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});