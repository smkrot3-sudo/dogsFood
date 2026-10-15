// Quick robot check of the budget page before/after each update: opens it at phone sizes and text sizes,
// in local mode (Supabase script blocked, so no real account or data is touched), clicks through the main
// screens and adds one expense. Fails on any page error or sideways scrolling.
// Run: python3 -m http.server 8765 --directory docs   then   node tests/budget-smoke.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/budget/index.html';
const SIZES = [[360, 740], [390, 844], [412, 915]];
const TEXT = ['1', '3'];

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const fails = [];
  for (const [w, h] of SIZES) for (const t of TEXT) {
    const tag = `${w}x${h} text ${t}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, locale: 'he-IL', serviceWorkers: 'block' });
    await ctx.addInitScript((size) => { try { localStorage.setItem('budget-textsize', size); } catch (e) {} }, t);
    await ctx.route(/supabase(\.min)?\.js|supabase\.co/, (r) => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const step = async (name, fn) => { try { await fn(); } catch (e) { errs.push(name + ': ' + e.message.split('\n')[0]); } };
    const esc = async () => { for (let i = 0; i < 4; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); } };
    const wide = async (where) => {
      const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) errs.push(`${where}: page scrolls sideways by ${o}px`);
    };

    await step('open', async () => { await p.goto(BASE, { waitUntil: 'load' }); await p.waitForSelector('#app:not([hidden])', { timeout: 15000 }); });
    await step('wizard', async () => { const s = p.getByText('דלג, אמלא לבד'); if (await s.count()) await s.first().click({ timeout: 3000 }); });
    await p.waitForTimeout(500); await esc();
    await wide('home');
    await step('add expense', async () => {
      await p.click('#fab'); await p.fill('#txAmount', '37'); await p.click('#txSave'); await p.waitForTimeout(500);
      if (!(await p.textContent('#app')).includes('37')) throw new Error('the new expense did not show up');
    });
    await esc();
    for (const v of ['shifts', 'calendar', 'friends', 'main']) {
      await step('tab ' + v, async () => { await p.click(`a[data-view="${v}"]`); await p.waitForTimeout(400); });
      await wide('tab ' + v);
    }
    await step('search', async () => { await p.click('#searchBtn'); await p.fill('#searchIn', '37'); await p.waitForTimeout(600); });
    await esc();
    await step('settings', async () => { await p.click('#gearBtn'); await p.waitForTimeout(400); });
    await wide('settings');
    await ctx.close();
    console.log((errs.length ? '✗ ' : '✓ ') + tag + (errs.length ? '\n    ' + errs.join('\n    ') : ''));
    if (errs.length) fails.push(tag);
  }
  await b.close();
  if (fails.length) { console.log('\nFAILED: ' + fails.join(', ')); process.exit(1); }
  console.log('\nall good');
})();
