/* sw.js — offline support.
   Strategy:
   - App shell (HTML/CSS/small JS/manifest): NETWORK-FIRST with cache fallback,
     so when online the user always gets the latest UI; when offline, the cached
     copy is served. This avoids stale-design problems after a deploy.
   - Heavy/rarely-changing static assets (the scanner library, images):
     CACHE-FIRST for speed (they are effectively immutable).
   - Data JSON (catalog / price changes): NETWORK-FIRST with cache fallback. */
'use strict';

var CACHE = 'dogsfood-scanner-v4';
var SHELL = [
  'index.html',
  'changes.html',
  'styles.css',
  'catalog-loader.js',
  'app.js',
  'changes.js',
  'icon.svg',
  'anipet-logo.png',
  'manifest.webmanifest',
  'vendor-html5-qrcode.min.js',
];

// Assets that basically never change — safe (and fast) to serve cache-first.
var CACHE_FIRST = /(vendor-html5-qrcode\.min\.js|\.png|\.svg|\.ico)(\?|$)/;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { /* ignore individual failures */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function cachePut(req, res) {
  var copy = res.clone();
  caches.open(CACHE).then(function (c) { c.put(req, copy); });
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Cache-first for heavy, immutable assets.
  if (CACHE_FIRST.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (res) { return cachePut(req, res); });
      })
    );
    return;
  }

  // Everything else (shell + data): network-first, cache fallback.
  e.respondWith(
    fetch(req)
      .then(function (res) { return cachePut(req, res); })
      .catch(function () { return caches.match(req); })
  );
});
