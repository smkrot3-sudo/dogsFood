/* This preview address moved to ../ — remove the old offline worker and its cache. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k.indexOf('budget-') === 0) return caches.delete(k); }));
  }).then(function () { return self.registration.unregister(); }));
});
