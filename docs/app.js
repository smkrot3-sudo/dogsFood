/* app.js — scanner page logic. */
(function () {
  'use strict';

  var resultEl = document.getElementById('result');
  var freshnessEl = document.getElementById('freshness');
  var startBtn = document.getElementById('startBtn');
  var stopBtn = document.getElementById('stopBtn');
  var scanStatus = document.getElementById('scanStatus');
  var searchForm = document.getElementById('searchForm');
  var searchInput = document.getElementById('searchInput');
  var hitsEl = document.getElementById('hits');

  var html5Qrcode = null;
  var scanning = false;
  var lastCode = null;
  var lastCodeTime = 0;

  function fmtPrice(p) {
    var n = parseFloat(p);
    if (!isFinite(n)) return p;
    // Trim trailing .00 -> integer, else keep 2 decimals.
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  function beep() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = 'square';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function renderNotFound(code) {
    resultEl.className = 'result notfound flash';
    resultEl.innerHTML =
      '<div class="title">לא נמצא ❌</div>' +
      '<div class="variant">הברקוד <span class="barcode-tag">' + escapeHtml(code) +
      '</span> לא קיים בקטלוג. ייתכן שזה קוד פנימי — נסה לחפש לפי שם המוצר למטה.</div>';
  }

  function renderProduct(entry, scannedCode) {
    var hasSale =
      entry.compareAtPrice &&
      parseFloat(entry.compareAtPrice) > parseFloat(entry.price);

    var priceBlock =
      '<div class="price-row">' +
        '<span class="price"><span class="cur">₪</span>' + fmtPrice(entry.price) + '</span>' +
        (hasSale
          ? '<span class="reg">מחיר רגיל <s>₪' + fmtPrice(entry.compareAtPrice) + '</s></span>' +
            '<span class="sale-badge">מבצע</span>'
          : '') +
      '</div>';

    var meta =
      '<div class="meta">' +
        (entry.barcode ? '<span class="barcode-tag">' + escapeHtml(entry.barcode) + '</span>' : '') +
        (entry.vendor ? '<span>' + escapeHtml(entry.vendor) + '</span>' : '') +
        (entry.available ? '' : '<span class="oos">אזל מהמלאי</span>') +
        (entry.url ? '<a class="prodlink" href="' + entry.url + '" target="_blank" rel="noopener">דף המוצר ↗</a>' : '') +
      '</div>';

    resultEl.className = 'result flash';
    resultEl.innerHTML =
      '<div class="title">' + escapeHtml(entry.title) + '</div>' +
      (entry.variant ? '<div class="variant">' + escapeHtml(entry.variant) + '</div>' : '') +
      priceBlock + meta;

    // Re-trigger flash animation.
    void resultEl.offsetWidth;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function handleCode(code, opts) {
    opts = opts || {};
    var entry = AnipetCatalog.findByBarcode(code);
    if (entry) {
      if (opts.beep !== false) beep();
      renderProduct(entry, code);
    } else {
      renderNotFound(code);
      if (opts.beep !== false && navigator.vibrate) navigator.vibrate([40, 60, 40]);
    }
  }

  /* ---------- Scanner ---------- */

  function onScanSuccess(decodedText) {
    var now = Date.now();
    var clean = String(decodedText).trim();
    // Debounce: ignore the same code within 2.5s so we don't spam while the
    // barcode stays in view. A different code shows immediately.
    if (clean === lastCode && now - lastCodeTime < 2500) return;
    lastCode = clean;
    lastCodeTime = now;
    handleCode(clean);
  }

  function startScan() {
    if (scanning) return;
    if (typeof Html5Qrcode === 'undefined') {
      scanStatus.textContent = 'ספריית הסריקה לא נטענה.';
      return;
    }
    html5Qrcode = new Html5Qrcode('reader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
      ],
      verbose: false,
    });
    var config = {
      fps: 12,
      qrbox: function (vw, vh) {
        var w = Math.min(vw, 380);
        return { width: Math.floor(w * 0.9), height: Math.floor(Math.min(vh * 0.5, 180)) };
      },
      aspectRatio: 1.4,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };
    scanStatus.textContent = 'מפעיל מצלמה…';
    html5Qrcode
      .start({ facingMode: 'environment' }, config, onScanSuccess, function () { /* ignore per-frame decode errors */ })
      .then(function () {
        scanning = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = '';
        scanStatus.textContent = 'כוון את המצלמה לברקוד…';
      })
      .catch(function (err) {
        scanStatus.textContent = 'לא ניתן להפעיל מצלמה: ' + err +
          '. ודא שנתת הרשאה ושאתה בגישה מאובטחת (https).';
      });
  }

  function stopScan() {
    if (!html5Qrcode || !scanning) return;
    html5Qrcode.stop().then(function () {
      html5Qrcode.clear();
      scanning = false;
      startBtn.style.display = '';
      stopBtn.style.display = 'none';
      scanStatus.textContent = '';
    }).catch(function () {});
  }

  startBtn.addEventListener('click', startScan);
  stopBtn.addEventListener('click', stopScan);

  /* ---------- Manual search ---------- */

  function renderHits(list) {
    hitsEl.innerHTML = '';
    if (!list.length) {
      hitsEl.innerHTML = '<div class="note">לא נמצאו מוצרים תואמים.</div>';
      return;
    }
    list.forEach(function (it) {
      var div = document.createElement('button');
      div.type = 'button';
      div.className = 'hit';
      div.innerHTML =
        '<span><span class="h-title">' + escapeHtml(it.title) +
        (it.variant ? ' · ' + escapeHtml(it.variant) : '') + '</span><br>' +
        '<span class="h-sub">' + escapeHtml(it.barcode) + '</span></span>' +
        '<span class="h-price">₪' + fmtPrice(it.price) + '</span>';
      div.addEventListener('click', function () {
        renderProduct(it, it.barcode);
        hitsEl.innerHTML = '';
        searchInput.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      hitsEl.appendChild(div);
    });
  }

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = searchInput.value.trim();
    if (!q) return;
    // Exact barcode? show directly in the big card.
    if (/^\d{6,14}$/.test(q)) {
      var hit = AnipetCatalog.findByBarcode(q);
      if (hit) { handleCode(q, { beep: false }); hitsEl.innerHTML = ''; return; }
    }
    var results = AnipetCatalog.search(q, 25);
    renderHits(results);
  });

  /* ---------- Boot ---------- */

  AnipetCatalog.load().then(function (info) {
    freshnessEl.className = 'freshness' + (info.source === 'cache' ? ' cache' : '');
    freshnessEl.innerHTML =
      '<span class="dot"></span>' +
      (info.source === 'cache' ? 'ממטמון מקומי' : 'מעודכן') +
      ' · ' + (info.updatedAt || '') + ' · ' + info.count + ' פריטים';
  }).catch(function (err) {
    freshnessEl.textContent = 'שגיאה בטעינת הקטלוג: ' + err.message;
  });

  // Register service worker for offline use (best effort).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
