// Service Worker fuer Offline-Funktionalitaet
const CACHE_NAME = 'ameisensimulator-v18';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './game.js?v=17',
    './manifest.json',
    './assets/images/grass.png',
    './assets/images/queen.png',
    './assets/images/hole.png',
    './assets/images/underground.png',
    './assets/images/underground_deep.png',
    './assets/images/leaf.png',
];

// Installation: Assets einzeln cachen - eine fehlende Datei bricht nicht alles ab
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all(
                ASSETS_TO_CACHE.map((url) =>
                    cache.add(url).catch(() => {
                        // Einzelne Datei konnte nicht gecacht werden - kein Problem
                        console.warn('[SW] Konnte nicht cachen:', url);
                    })
                )
            );
        })
    );
    self.skipWaiting();
});

// Aktivierung: Alle alten Caches entfernen
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
                return caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    // Kein Cache-Eintrag -> Browser-Standard-Fehler
                    return Response.error();
                });
            })
    );
});
