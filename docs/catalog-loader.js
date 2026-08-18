/* catalog-loader.js — shared catalog loading + barcode matching.
   Exposes a global `AnipetCatalog`. Classic script (no modules) for simplicity. */
(function () {
  'use strict';

  var CATALOG_URL = 'data/catalog.json';
  var LS_KEY = 'anipet_catalog_cache_v1';

  var state = {
    loaded: false,
    updatedAt: null,
    items: [],
    index: null, // Map of normalized-barcode -> entry
  };

  // Generate the set of normalized barcode forms for a raw code. Handles the
  // common UPC-A <-> EAN-13 leading-zero mismatch that scanners introduce.
  function candidates(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var out = [];
    if (!s) return out;
    var seen = {};
    function add(v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } }
    add(s);
    add(s.replace(/^0+/, '') || '0');           // without leading zeros
    if (/^\d{12}$/.test(s)) add('0' + s);       // UPC-A -> EAN-13
    if (/^\d{13}$/.test(s) && s.charAt(0) === '0') add(s.slice(1)); // EAN-13 -> UPC-A
    if (/^\d{11}$/.test(s)) add('0' + s);       // pad to 12
    return out;
  }

  function buildIndex(items) {
    var idx = new Map();
    for (var i = 0; i < items.length; i++) {
      var entry = items[i];
      var keys = candidates(entry.barcode);
      for (var k = 0; k < keys.length; k++) {
        if (!idx.has(keys[k])) idx.set(keys[k], entry);
      }
    }
    return idx;
  }

  function applyData(data) {
    state.items = data.items || [];
    state.updatedAt = data.updatedAt || null;
    state.date = data.date || null;
    state.stats = data.stats || null;
    state.index = buildIndex(state.items);
    state.loaded = true;
  }

  // Load catalog: try network first, fall back to localStorage cache (offline).
  function load() {
    return fetch(CATALOG_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        applyData(data);
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
        return { source: 'network', updatedAt: state.updatedAt, count: state.items.length };
      })
      .catch(function (netErr) {
        // Offline / server down — use cached copy if present.
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
        if (cached) {
          applyData(cached);
          return { source: 'cache', updatedAt: state.updatedAt, count: state.items.length };
        }
        throw netErr;
      });
  }

  function findByBarcode(code) {
    if (!state.index) return null;
    var forms = candidates(code);
    for (var i = 0; i < forms.length; i++) {
      if (state.index.has(forms[i])) return state.index.get(forms[i]);
    }
    return null;
  }

  // Free-text search over product titles (and exact barcode). Returns up to `limit`.
  function search(query, limit) {
    limit = limit || 25;
    var q = String(query || '').trim();
    if (!q) return [];

    // If it looks like a barcode, try exact match first.
    var results = [];
    if (/^\d{6,14}$/.test(q)) {
      var hit = findByBarcode(q);
      if (hit) results.push(hit);
    }

    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (var i = 0; i < state.items.length && results.length < limit; i++) {
      var it = state.items[i];
      if (results.indexOf(it) !== -1) continue;
      var hay = (it.title + ' ' + (it.variant || '') + ' ' + (it.vendor || '')).toLowerCase();
      var ok = true;
      for (var t = 0; t < tokens.length; t++) {
        if (hay.indexOf(tokens[t]) === -1) { ok = false; break; }
      }
      if (ok) results.push(it);
    }
    return results;
  }

  window.AnipetCatalog = {
    load: load,
    findByBarcode: findByBarcode,
    search: search,
    get: function () { return state; },
  };
})();
