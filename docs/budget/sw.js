/* Offline support for the budget page only (scope: this folder).
   Page files: network first, cached copy when offline, so a deploy shows up on the next visit.
   Supabase calls are never cached; the page keeps its own copy of the user's data. */
'use strict';
var CACHE = 'budget-v13';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-180.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k.indexOf('budget-') === 0 && k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var mine = url.origin === self.location.origin && url.pathname.indexOf(new URL('./', self.location).pathname) === 0;
  var cdn = /^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!mine && !cdn) return;
  // Own files skip the browser's HTTP cache (GitHub Pages allows 10 minutes), so a fix shows up on the very next open
  var net = mine ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req);
  e.respondWith(net.then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: mine }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    });
  }));
});
