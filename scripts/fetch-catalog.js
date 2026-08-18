// fetch-catalog.js
// Downloads the full Anipet product catalog from the public Shopify products.json feed,
// flattens it into a barcode-indexed catalog, and computes price changes vs. the
// previous run (today's diff + a cumulative history archive).
//
// Run:  node scripts/fetch-catalog.js
//
// Outputs (in ../data):
//   catalog.json         - full current catalog, indexed by barcode (the app reads this)
//   catalog-prev.json    - previous run's catalog (used for diffing)
//   price-changes.json   - changes detected in THIS run (today)
//   price-history.json   - cumulative archive of all change-runs over time
//   meta.json            - last update timestamp + counts

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://www.anipet.co.il';
const PER_PAGE = 250;
const DATA_DIR = path.join(__dirname, '..', 'docs', 'data');

// Israel local date (YYYY-MM-DD) regardless of server timezone.
function todayISR() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

function nowISR() {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'short', timeStyle: 'short',
  }).format(new Date());
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

async function fetchPage(page) {
  const url = `${BASE}/products.json?limit=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (anipet-price-scanner internal tool)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  const json = await res.json();
  return json.products || [];
}

async function fetchAllProducts() {
  const all = [];
  let page = 1;
  // Safety cap so a misbehaving feed can never loop forever.
  const MAX_PAGES = 500;
  while (page <= MAX_PAGES) {
    process.stdout.write(`\r  Fetching page ${page} ... (${all.length} products so far)   `);
    let products;
    try {
      products = await fetchPage(page);
    } catch (err) {
      // One retry, then give up on this page.
      await new Promise((r) => setTimeout(r, 1500));
      products = await fetchPage(page);
    }
    if (products.length === 0) break;
    all.push(...products);
    page += 1;
    // Be polite to the server.
    await new Promise((r) => setTimeout(r, 300));
  }
  process.stdout.write('\n');
  return all;
}

// Flatten products -> one entry per variant, indexed by barcode (SKU).
function buildCatalog(products) {
  const byBarcode = {};       // barcode -> entry
  const items = [];           // flat list (also holds items without a usable barcode)
  let withBarcode = 0;
  let withoutBarcode = 0;

  for (const p of products) {
    const variants = p.variants || [];
    for (const v of variants) {
      const rawSku = (v.sku || '').trim();
      const variantTitle = v.title && v.title !== 'Default Title' ? v.title : '';
      const entry = {
        barcode: rawSku,
        title: p.title,
        variant: variantTitle,
        price: v.price,                          // current selling price (string, e.g. "155.00")
        compareAtPrice: v.compare_at_price || null, // regular price before discount, if any
        available: v.available !== false,
        vendor: p.vendor || '',
        handle: p.handle,
        url: `${BASE}/products/${p.handle}`,
        productId: p.id,
        variantId: v.id,
      };
      items.push(entry);
      if (rawSku) {
        // If two variants share a barcode (rare), keep the first, note nothing fancy.
        if (!byBarcode[rawSku]) byBarcode[rawSku] = entry;
        withBarcode += 1;
      } else {
        withoutBarcode += 1;
      }
    }
  }

  return { byBarcode, items, stats: { withBarcode, withoutBarcode, total: items.length } };
}

// Compare current vs previous catalog (both indexed by barcode) -> list of changes.
function diffCatalogs(prevByBarcode, curByBarcode) {
  const changes = [];
  for (const [barcode, cur] of Object.entries(curByBarcode)) {
    const prev = prevByBarcode[barcode];
    if (!prev) continue; // new product -> not a "price change"; tracked separately below
    const oldPrice = parseFloat(prev.price);
    const newPrice = parseFloat(cur.price);
    if (!isFinite(oldPrice) || !isFinite(newPrice)) continue;
    if (oldPrice !== newPrice) {
      changes.push({
        barcode,
        title: cur.title,
        variant: cur.variant,
        oldPrice: prev.price,
        newPrice: cur.price,
        diff: (newPrice - oldPrice).toFixed(2),
        direction: newPrice > oldPrice ? 'up' : 'down',
        url: cur.url,
      });
    }
  }
  // Sort: biggest absolute change first.
  changes.sort((a, b) => Math.abs(parseFloat(b.diff)) - Math.abs(parseFloat(a.diff)));
  return changes;
}

async function main() {
  console.log('Anipet catalog fetch — starting');
  console.log('Downloading full product feed from ' + BASE + '/products.json ...');

  const products = await fetchAllProducts();
  console.log(`Downloaded ${products.length} products.`);

  const { byBarcode, items, stats } = buildCatalog(products);
  console.log(
    `Flattened to ${stats.total} variants — ${stats.withBarcode} with barcode, ` +
    `${stats.withoutBarcode} without.`
  );

  // Load previous catalog for diffing (this is the diff baseline).
  const prev = readJSON('catalog.json', null);
  const prevByBarcode = prev ? prev.byBarcode : {};

  const changes = prev ? diffCatalogs(prevByBarcode, byBarcode) : [];
  const date = todayISR();

  if (prev) {
    console.log(`Detected ${changes.length} price change(s) vs. previous catalog.`);
  } else {
    console.log('No previous catalog found — this is the first run (baseline). No diff.');
  }

  // Rotate: current -> prev, then write new current.
  if (prev) writeJSON('catalog-prev.json', prev);

  const catalog = {
    updatedAt: nowISR(),
    date,
    stats,
    byBarcode,
    items,
  };
  writeJSON('catalog.json', catalog);

  // Today's changes (overwrites — represents the most recent run).
  const todaysChanges = { date, updatedAt: nowISR(), count: changes.length, changes };
  writeJSON('price-changes.json', todaysChanges);

  // Cumulative history: prepend this run if it actually had changes (or if first run).
  const history = readJSON('price-history.json', { runs: [] });
  if (!prev) {
    history.runs.unshift({ date, updatedAt: nowISR(), note: 'baseline (first run)', count: 0, changes: [] });
  } else if (changes.length > 0) {
    history.runs.unshift({ date, updatedAt: nowISR(), count: changes.length, changes });
  }
  // Keep history from growing unbounded — cap at 400 runs.
  history.runs = history.runs.slice(0, 400);
  writeJSON('price-history.json', history);

  writeJSON('meta.json', { updatedAt: nowISR(), date, ...stats, lastChangeCount: changes.length });

  console.log('Done. Data written to /data.');
}

main().catch((err) => {
  console.error('\nFETCH FAILED:', err.message);
  process.exit(1);
});
