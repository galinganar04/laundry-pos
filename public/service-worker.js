// ===== SERVICE WORKER FOR HAWI'S LOVADA POS =====
const CACHE_NAME = 'hawi-lovada-pos-v3';
const OFFLINE_URL = '/offline.html';

const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/login.html',
    '/offline.html',
    '/theme.js',
    '/role-guard.js',
    '/logo.png',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Caching essential files');
            return cache.addAll(FILES_TO_CACHE);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    console.log('Removing old cache:', key);
                    return caches.delete(key);
                }
            }));
        }).then(() => self.clients.claim())
    );
});

// Network-first for HTML, cache-first for assets
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('/api/')) return;

    const isHTML = event.request.mode === 'navigate' || event.request.url.endsWith('.html') || event.request.url.endsWith('/');

    if (isHTML) {
        // Network FIRST for HTML (always fetch fresh)
        event.respondWith(
            fetch(event.request).then(networkResponse => {
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            }).catch(() => {
                return caches.match(event.request).then(cached => cached || caches.match(OFFLINE_URL));
            })
        );
    } else {
        // Cache FIRST for assets
        event.respondWith(
            caches.match(event.request).then(response => {
                if (response) return response;
                return fetch(event.request).then(networkResponse => {
                    if (event.request.url.match(/\.(css|js|png|jpg|jpeg|svg|woff2?)$/)) {
                        return caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, networkResponse.clone());
                            return networkResponse;
                        });
                    }
                    return networkResponse;
                });
            })
        );
    }
});