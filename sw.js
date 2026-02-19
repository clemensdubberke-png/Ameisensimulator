// Service Worker fuer Offline-Funktionalitaet
const CACHE_NAME = 'ameisensimulator-v4';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './game.js',
    './manifest.json',
    './assets/images/grass.png',
    './assets/images/queen.png',
    './assets/images/hole.png',
    './assets/images/underground.png',
];

// Installation: Alle Assets cachen
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    // Sofort aktivieren, ohne auf alte Tabs zu warten
    self.skipWaiting();
});

// Aktivierung: Alte Caches entfernen
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Zuerst Netzwerk, dann Cache (stellt sicher, dass Updates sofort ankommen)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Gueltige Antworten in den Cache legen
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                // Netzwerk nicht verfuegbar -> aus Cache laden (Offline-Modus)
                return caches.match(event.request);
            })
    );
});
