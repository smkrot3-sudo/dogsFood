/* changes.js — renders today's price changes + historical archive. */
(function () {
  'use strict';

  var freshnessEl = document.getElementById('freshness');
  var todayEl = document.getElementById('today');
  var todayCountEl = document.getElementById('todayCount');
  var historyEl = document.getElementById('history');

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtPrice(p) {
    var n = parseFloat(p);
    if (!isFinite(n)) return p;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  function changeRow(c) {
    var dir = c.direction === 'up' ? 'up' : 'down';
    var arrow = c.direction === 'up' ? '▲' : '▼';
    var sign = parseFloat(c.diff) > 0 ? '+' : '';
    return (
      '<div class="change ' + dir + '">' +
        '<span>' +
          '<span class="c-title">' + escapeHtml(c.title) +
            (c.variant ? ' · ' + escapeHtml(c.variant) : '') + '</span><br>' +
          '<span class="c-sub">' + escapeHtml(c.barcode) + '</span>' +
        '</span>' +
        '<span class="c-prices">' +
          '<span class="c-old">₪' + fmtPrice(c.oldPrice) + '</span> ' +
          '<span class="arrow">' + arrow + '</span> ' +
          '<span class="c-new">₪' + fmtPrice(c.newPrice) + '</span><br>' +
          '<span class="c-sub">' + sign + fmtPrice(c.diff) + ' ₪</span>' +
        '</span>' +
      '</div>'
    );
  }

  function renderList(container, changes) {
    if (!changes || !changes.length) {
      container.innerHTML = '<div class="empty">אין שינויים 🎉</div>';
      return;
    }
    container.innerHTML = changes.map(changeRow).join('');
  }

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Today's changes.
  getJSON('data/price-changes.json').then(function (d) {
    todayCountEl.textContent = d.count || 0;
    freshnessEl.innerHTML = '<span class="dot"></span>עודכן · ' + (d.updatedAt || '');
    renderList(todayEl, d.changes);
  }).catch(function () {
    todayEl.innerHTML = '<div class="empty">עדיין אין נתוני בדיקה. הרץ את הבדיקה היומית פעם אחת.</div>';
    freshnessEl.textContent = '';
  });

  // Historical archive.
  getJSON('data/price-history.json').then(function (d) {
    var runs = (d.runs || []).filter(function (r) { return r.count > 0; });
    if (!runs.length) {
      historyEl.innerHTML = '<div class="empty">אין עדיין היסטוריה של שינויים.</div>';
      return;
    }
    historyEl.innerHTML = runs.map(function (run) {
      return (
        '<div class="run-group">' +
          '<div class="run-date">📅 ' + escapeHtml(run.date || '') +
            ' — ' + run.count + ' שינויים' +
            (run.updatedAt ? ' · ' + escapeHtml(run.updatedAt) : '') + '</div>' +
          '<div class="change-list">' + run.changes.map(changeRow).join('') + '</div>' +
        '</div>'
      );
    }).join('');
  }).catch(function () {
    historyEl.innerHTML = '<div class="empty">אין עדיין היסטוריה.</div>';
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
