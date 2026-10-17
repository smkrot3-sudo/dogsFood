// Robot of 50 simulated users, run before every update next to the quick robot (tests/budget-smoke.js).
// Each user has months of realistic made-up data (gen.js) and opens the real page in local mode, at their own
// "today", timezone, screen and text size. Nothing touches the real server: Supabase is blocked.
// Fails when: a page error, broken text (NaN, undefined, Infinity...), sideways scrolling, or a number that
// doesn't match the independent calculation in oracle.js (income, allowed today, shift pay).
// Run: node tests/budget-sim/run.js   (serves docs/ by itself; USERS=n to change how many)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const gen = require('./gen.js');
const O = require('./oracle.js');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const N = +process.env.USERS || 50;
const PAR = +process.env.PAR || 4;
const PORT = 8790;

// The page with a small test window (window.__T) to read its numbers, added only in the robot's copy
const HOOK = `  window.__T = { get store(){return store}, get month(){return month}, get todayWhy(){return todayWhy},
    tx, shifts, plan, shiftPay, goMonth, thisMonth, todayStr, settings, incTotal, setView };
`;
const ANCHOR = '  if (!SUPABASE_URL || !SUPABASE_KEY || !window.supabase) {';
const page = fs.readFileSync(path.join(DOCS, 'budget', 'index.html'), 'utf8');
if (!page.includes(ANCHOR)) { console.log('✗ the robot could not find where to attach in index.html (the local-mode start line moved)'); process.exit(1); }
const patched = page.replace(ANCHOR, HOOK + ANCHOR);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(DOCS, p);
  if (!f.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
  if (/\/budget\/(index\.html)?$/.test(p)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(patched); return; }
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});
const BASE = `http://localhost:${PORT}/budget/index.html`;

function wallToUtc(date, hour, min, tz) {
  const [y, m, d] = date.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, hour, min);
  for (let k = 0; k < 3; k++) {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
    const g = (x) => +p.find((q) => q.type === x).value;
    t += Date.UTC(y, m - 1, d, hour, min) - Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  }
  return t;
}
const SCAN = () => {
  const app = document.getElementById('app'), txt = app ? app.innerText : '', bad = [];
  const re = /NaN|undefined|Infinity|\[object|null₪|₪null|₪-0\b|−₪0\b|-₪0\b/g; let m;
  while ((m = re.exec(txt))) bad.push(txt.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' '));
  return { bad: bad.slice(0, 3), over: document.documentElement.scrollWidth - window.innerWidth };
};
const SNAP = () => {
  const T = window.__T, p = T.plan();
  return { month: T.month, cur: T.thisMonth(), today: T.todayStr(), inc: p.inc, shiftInc: p.shiftInc, why: T.todayWhy ? { left: T.todayWhy.left, aside: T.todayWhy.aside } : null };
};

async function runUser(b, u) {
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: u.viewport[0], height: u.viewport[1] }, isMobile: true, hasTouch: true, locale: 'he-IL', timezoneId: u.tz, serviceWorkers: 'block' });
  await ctx.route(/supabase(\.min)?\.js|supabase\.co|googleapis|gstatic|jsdelivr|cdnjs/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('page error: ' + e.message.split('\n')[0]));
  const t0 = wallToUtc(u.today, u.hour, 30, u.tz);
  await p.clock.install({ time: t0 });
  await p.addInitScript(([s, ts, th, pal]) => {
    if (sessionStorage.getItem('sim-init')) return; sessionStorage.setItem('sim-init', '1');
    localStorage.setItem('budget-app-v1', JSON.stringify(s)); localStorage.setItem('budget-textsize', ts);
    if (th) localStorage.setItem('budget-theme', th); if (pal !== 'orig') localStorage.setItem('budget-palette', pal);
    localStorage.setItem('budget-layhint', '99');
  }, [u.store, u.textSize, u.theme, u.palette]);
  const check = (s, where) => {
    if (!s.snap || s.snap.month !== s.snap.cur) return;
    const m = O.model(u.store, s.snap.month, s.snap.today);
    if (Math.abs(m.inc - s.snap.inc) > 1) errs.push(`${where} ${s.snap.today}: income ${s.snap.inc}, should be ${m.inc}`);
    else if (s.snap.why && m.left != null && Math.abs(m.left - s.snap.why.left) > 1) errs.push(`${where} ${s.snap.today}: allowed today ${Math.round(s.snap.why.left)}, should be ${Math.round(m.left)}`);
    (s.scan.bad || []).forEach((x) => errs.push(`${where}: broken text "${x}"`));
    if (s.scan.over > 1) errs.push(`${where}: page scrolls sideways by ${s.scan.over}px`);
  };
  const grab = async (where) => check({ snap: await p.evaluate(SNAP), scan: await p.evaluate(SCAN) }, where);
  try {
    await p.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await p.waitForFunction(() => window.__T && window.__T.tx[window.__T.month], null, { timeout: 30000 });
    await p.clock.runFor(1500);
    for (let k = 0; k < 4; k++) await p.keyboard.press('Escape');
    await grab('today');
    // shift pay, every logged shift, against the labor-law calculation
    const pays = await p.evaluate(() => { const st = window.__T.settings(); return (window.__T.store.shifts || []).map((r) => [r.id, window.__T.shiftPay(r, st).gross]); });
    const sh = Object.fromEntries(u.store.shifts.map((x) => [x.id, x]));
    pays.forEach(([id, g]) => {
      const x = sh[id]; if (!x) return;
      const o = O.pay(x, u.store.settings).gross;
      if (Math.abs(o - g) > Math.max(3, o * 0.01)) errs.push(`shift ${x.work_date} ${x.start_time}-${x.end_time}: pay ₪${Math.round(g)}, should be ₪${Math.round(o)}`);
    });
    // a few past months
    for (const m of u.months.slice().reverse().slice(1, 4)) {
      await p.evaluate((mm) => window.__T.goMonth(mm), m);
      await p.waitForFunction((mm) => window.__T.tx[mm] && window.__T.shifts[mm], m, { timeout: 10000 }).catch(() => errs.push('month never loaded ' + m));
      await p.clock.runFor(300);
      const sc = await p.evaluate(SCAN);
      (sc.bad || []).forEach((x) => errs.push(`month ${m}: broken text "${x}"`));
    }
    // days of the current month: start, middle, the last 3 days
    const sd = u.startDay, start = u.cur + '-' + String(sd).padStart(2, '0');
    const addD = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
    const nextStart = (() => { const [y, m] = u.cur.split('-').map(Number); return new Date(Date.UTC(y, m, sd)).toISOString().slice(0, 10); })();
    const end = addD(nextStart, -1);
    for (const d of [...new Set([start, addD(start, 14), addD(end, -2), end])]) {
      await p.clock.setSystemTime(wallToUtc(d, 13, 0, u.tz));
      await p.evaluate(() => window.__T.goMonth(window.__T.thisMonth()));
      await p.waitForFunction(() => window.__T.tx[window.__T.month] && window.__T.shifts[window.__T.month], null, { timeout: 10000 }).catch(() => errs.push('day never loaded ' + d));
      await p.clock.runFor(300);
      await grab('day');
    }
    await p.clock.setSystemTime(t0 + 60000);
    await p.evaluate(() => window.__T.goMonth(window.__T.thisMonth()));
    await p.clock.runFor(500);
    for (const v of ['shifts', 'calendar', 'friends', 'main']) {
      const shown = await p.evaluate((vv) => { const a = document.querySelector('a[data-view="' + vv + '"]'); if (!a || a.offsetParent === null) return false; window.__T.setView(vv); return true; }, v);
      if (!shown) continue;
      await p.clock.runFor(300);
      const sc = await p.evaluate(SCAN);
      (sc.bad || []).forEach((x) => errs.push(`tab ${v}: broken text "${x}"`));
      if (sc.over > 1) errs.push(`tab ${v}: page scrolls sideways by ${sc.over}px`);
    }
  } catch (e) { errs.push('run: ' + e.message.split('\n')[0]); }
  await ctx.close();
  return errs;
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  // 600 made-up people, every 12th one: a fixed, varied sample (salary, hourly, both, abroad, edge days, text sizes)
  const all = gen(600), step = Math.max(1, Math.floor(all.length / N));
  const list = all.filter((u, i) => i % step === 0).slice(0, N);
  // some brand-new users who signed up mid-month: their first month counts only the days left
  list.forEach((u, k) => { if (k % 7 === 3) { const d = +u.today.slice(8), sd = u.startDay; const frac = Math.round((1 - Math.max(0, (d - sd + 30) % 30) / 30) * 100) / 100; if (frac > 0 && frac < 0.95) u.store.firstMonth = { m: u.cur, frac }; } });
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  let k = 0; const fails = [];
  async function worker() {
    while (k < list.length) {
      const u = list[k++];
      let errs; try { errs = await runUser(b, u); } catch (e) { errs = ['fatal: ' + e.message.split('\n')[0]]; }
      const tag = `user ${u.i} (${u.payType || 'legacy'}, ${u.viewport[0]}px, text ${u.textSize}, ${u.today})`;
      console.log((errs.length ? '✗ ' : '✓ ') + tag + (errs.length ? '\n    ' + [...new Set(errs)].slice(0, 6).join('\n    ') : ''));
      if (errs.length) fails.push(tag);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAR, list.length) }, worker));
  await b.close(); server.close();
  console.log(fails.length ? `\n${fails.length} of ${list.length} simulated users had problems` : `\nAll ${list.length} simulated users passed`);
  process.exit(fails.length ? 1 : 0);
})();
