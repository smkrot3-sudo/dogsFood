// Generates N simulated users: a persona, the ground truth of their money life, and the store the app would hold
// (what they actually typed/logged, mistakes included). Copied from the 600-user simulation of 2026-10-17.
const fs = require('fs');
let seed = 20261017;
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const R = (a, b) => a + rnd() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const P = (p) => rnd() < p;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function wpick(pairs) { const t = pairs.reduce((s, p) => s + p[1], 0); let x = rnd() * t; for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[0][0]; }
const pad = (n) => String(n).padStart(2, '0');
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const S = (dt) => dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const wd = (s) => D(s).getUTCDay();
const shiftM = (m, by) => { let [y, mo] = m.split('-').map(Number); mo += by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + pad(mo); };
const daysInM = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
let idc = 0; const uid = (p) => p + '-' + (++idc).toString(36) + '-' + Math.floor(rnd() * 1e9).toString(36);

// Israeli rest days 2024-2027 (independent list; the eve is the day before)
const HOL = ['2024-10-03', '2024-10-04', '2024-10-12', '2024-10-17', '2024-10-24', '2025-04-13', '2025-04-19', '2025-05-01', '2025-06-02',
  '2025-09-23', '2025-09-24', '2025-10-02', '2025-10-07', '2025-10-14', '2026-04-02', '2026-04-08', '2026-04-22', '2026-05-22',
  '2026-09-12', '2026-09-13', '2026-09-21', '2026-09-26', '2026-10-03', '2027-03-23', '2027-03-29', '2027-05-12', '2027-06-11'];
const isRest = (s) => wd(s) === 6 || HOL.includes(s);

const FIXED = [['שכר דירה', 2800, 6500, .55], ['ועד בית', 80, 350, .3], ['חשמל', 200, 600, .6], ['מים', 80, 250, .45], ['ארנונה', 250, 900, .45],
  ['טלפון', 30, 150, .85], ['אינטרנט', 60, 140, .55], ['ביטוח רכב', 200, 600, .3], ['ליסינג/הלוואת רכב', 900, 2500, .15],
  ['נטפליקס', 35, 70, .35], ['ספוטיפיי', 20, 30, .25], ['חדר כושר', 150, 350, .2], ['גן ילדים', 1500, 3800, .1], ['הלוואה', 400, 2500, .15],
  ['ביטוח בריאות', 60, 300, .3], ['אוכל לכלבים', 150, 450, .15], ['תרומה קבועה', 50, 400, .1], ['סופר (בסיסי)', 1200, 3500, .25]];
const CATS = [['אוכל בחוץ ומשלוחים', ['וולט', 'פיצה', 'שווארמה', 'סושי', 'בורגר', 'תן ביס']], ['קניות אונליין', ['עלי אקספרס', 'שיין', 'אמזון', 'KSP', 'טמו']],
  ['בילויים ויציאות', ['סרט', 'בר', 'הופעה', 'מסעדה', 'באולינג']], ['קפה ונשנושים', ['קפה', 'מאפה', 'שתייה', 'חטיף', 'אייס']],
  ['שונות', ['מתנה', 'מספרה', 'בית מרקחת', 'כביסה', 'קנס']], ['סופר', ['שופרסל', 'רמי לוי', 'יוחננוף', 'מכולת', 'ויקטורי']],
  ['דלק ותחבורה', ['דלק', 'רב קו', 'מונית', 'חניה', 'גט']], ['בגדים', ['זארה', 'קסטרו', 'נעליים', 'H&M']], ['סיגריות', ['סיגריות', 'טבק']],
  ['ילדים', ['חיתולים', 'צעצוע', 'חוג', 'בגדי ילדים']], ['כלב', ['אוכל לכלב', 'וטרינר', 'צעצוע לכלב', 'חטיפים לכלב']], ['בריאות', ['רופא', 'תרופות', 'רופא שיניים']]];
const amountFor = (cat) => ({ 'אוכל בחוץ ומשלוחים': [40, 180], 'קניות אונליין': [20, 400], 'בילויים ויציאות': [40, 300], 'קפה ונשנושים': [8, 35],
  'שונות': [15, 300], 'סופר': [40, 450], 'דלק ותחבורה': [12, 350], 'בגדים': [60, 450], 'סיגריות': [30, 45], 'ילדים': [30, 400], 'כלב': [30, 600], 'בריאות': [30, 700] })[cat] || [20, 200];

// Dates the simulation looks at: today mostly 17.10.2026, plus edge days
const SPECIAL_TODAY = ['2026-10-17', '2026-10-01', '2026-10-31', '2026-09-30', '2026-10-09', '2026-10-10', '2026-10-25', '2026-12-31', '2027-01-01',
  '2027-02-28', '2027-03-01', '2026-09-12', '2026-09-21', '2026-10-16', '2026-10-24', '2026-11-30'];
const TZ = [['Asia/Jerusalem', 95], ['America/New_York', 2], ['Europe/London', 2], ['Asia/Bangkok', 1]];

function genUser(i) {
  const u = { i, id: 'sim' + String(i).padStart(3, '0'), tags: [] };
  const tag = (t) => u.tags.push(t);
  // --- who ---
  u.gender = P(.5) ? 'f' : 'm';
  u.age = wpick([['18-22', 25], ['23-30', 35], ['31-45', 28], ['46+', 12]]);
  u.payType = wpick([['', 22], ['hourly', 36], ['salary', 26], ['both', 16]]);
  u.tone = wpick([['tough', 30], ['mid', 45], ['soft', 25]]);
  u.personality = wpick([['saver', 22], ['balanced', 38], ['spender', 25], ['impulsive', 10], ['chaotic', 5]]);
  u.logging = wpick([['all', 25], ['most', 30], ['half', 25], ['rare', 15], ['quit', 5]]); // 'quit' stops logging after a while
  u.logLate = P(.3); // logs in batches, sometimes with today's date instead of the real one
  u.history = wpick([[0, 6], [1, 14], [2, 14], [3, 20], [6, 22], [12, 16], [24, 8]]); // months of past data
  u.today = P(.65) ? '2026-10-17' : pick(SPECIAL_TODAY);
  u.hour = wpick([[12, 60], [8, 10], [23, 10], [0, 8], [21, 12]]);
  u.tz = wpick(TZ);
  u.keepsShabbat = P(u.age === '46+' ? .45 : .3);
  u.kids = u.age !== '18-22' && P(.35);
  u.dog = P(.18);
  u.smoker = P(.15);
  u.car = P(.5);
  u.livesWithParents = u.age === '18-22' ? P(.6) : P(.08);
  // --- display ---
  u.textSize = wpick([['1', 55], ['2', 30], ['3', 15]]);
  u.theme = wpick([['', 50], ['light', 25], ['dark', 25]]);
  u.palette = pick(['orig', 'orig', 'cream', 'ocean', 'forest', 'rose', 'night', 'sunset', 'mint', 'lavender', 'gold']);
  u.viewport = wpick([[[320, 640], 6], [[360, 740], 25], [[375, 667], 8], [[390, 844], 25], [[412, 915], 26], [[430, 932], 10]]);

  // --- money ---
  const legacy = u.payType === '';
  u.hourlyWork = u.payType === 'hourly' || u.payType === 'both' || (legacy && P(.75));
  u.wage = u.hourlyWork ? Math.round(R(32.7, u.age === '18-22' ? 48 : 80) * 100) / 100 : 0;
  if (u.hourlyWork && P(.08)) { u.wage = 32.7; tag('min-wage'); }
  u.salaryNet = (u.payType === 'salary' || u.payType === 'both' || (legacy && !u.hourlyWork) || (legacy && P(.3)))
    ? Math.round(R(u.payType === 'both' ? 3000 : 5500, u.age === '18-22' ? 8000 : 22000) / 50) * 50 : 0;
  u.payday = (u.payType === 'salary' || u.payType === 'both') ? wpick([[1, 15], [9, 25], [10, 25], [15, 5], [25, 5], [28, 5], [30, 8], [31, 12]]) : 0;
  u.startDay = u.payday ? Math.min(u.payday, 28) : (legacy ? wpick([[1, 60], [10, 30], [15, 5], [28, 5]]) : wpick([[1, 85], [10, 15]]));
  u.shiftIncome = u.hourlyWork ? (legacy ? wpick([['same', 45], ['prev', 45], ['off', 10]]) : wpick([['same', 55], ['prev', 35], ['off', 10]])) : 'same';
  u.otAfter = P(.12) ? 8 : 8.6;
  u.shiftsPerWeek = u.hourlyWork ? (u.payType === 'both' ? RI(1, 2) : wpick([[1, 8], [2, 12], [3, 20], [4, 22], [5, 28], [6, 10]])) : 0;
  u.pattern = u.hourlyWork ? wpick([['morning', 35], ['evening', 25], ['night', 10], ['mixed', 20], ['long12', 6], ['weekend', 4]]) : '';
  if (u.keepsShabbat && u.pattern === 'weekend') u.pattern = 'evening';
  u.breakMin = u.hourlyWork ? wpick([[0, 55], [30, 35], [45, 5], [60, 5]]) : 0;
  u.shiftLogging = u.hourlyWork ? wpick([['all', 60], ['most', 25], ['some', 15]]) : '';
  u.shiftTypes = u.hourlyWork && P(.15) ? [{ id: 't1', name: 'מוצ״ש', rate: 150, color: 'violet' }, ...(P(.3) ? [{ id: 't2', name: 'חג', rate: 200, color: 'orange' }] : [])] : [];
  // Typing mistakes and habits around income
  if (u.hourlyWork && !u.salaryNet) {
    // The signup asks "how much comes in a month, after tax" for everyone, so most hourly users have a typed salary line
    u.typedSalary = P(.8) ? Math.round(R(3000, 9000) / 100) * 100 : 0;
    if (u.typedSalary) tag('hourly-typed-income');
  }
  if (u.payType === 'both') { u.bothTypedFull = P(.4); if (u.bothTypedFull) tag('both-typed-full-payslip'); }
  if (u.payType === 'salary' || u.payType === 'both') { u.forgetsSalaryEntry = P(.3); if (u.forgetsSalaryEntry) tag('salary-not-typed-this-month'); u.salaryVaries = P(.25); }
  if (P(.04)) { u.typoX10 = true; tag('typo-x10'); }
  if (P(.03)) { u.hugeAmount = true; tag('huge-amount'); }
  if (P(.05)) { u.overCommitted = true; tag('fixed-over-income'); }
  if (P(.03)) { u.sameStartEnd = true; tag('shift-same-start-end'); }
  if (P(.05) && u.hourlyWork) { u.dupShift = true; tag('duplicate-shift'); }
  if (P(.04)) { u.longNotes = true; tag('long-texts'); }
  if (P(.04)) { u.manyCats = true; tag('many-categories'); }
  if (P(.06)) { u.subCats = true; tag('subcategories'); }
  if (P(.05)) { u.deletedCat = true; tag('deleted-category'); }
  if (P(.06)) { u.futureTx = true; tag('future-dated-expense'); }
  if (P(.04)) { u.decimals = true; tag('decimal-amounts'); }
  if (P(.03)) { u.goalZero = true; tag('goal-weird'); }
  if (P(.15)) tag('one-off-incomes');
  if (u.history === 0) tag('new-user');
  if (u.history >= 24) tag('heavy-history');
  if (u.tz !== 'Asia/Jerusalem') tag('abroad-timezone');
  if (u.hour === 0 || u.hour === 23) tag('near-midnight');
  if (u.today !== '2026-10-17') tag('edge-day');

  // --- build months ---
  const pOf = (s) => (+s.slice(8) >= u.startDay ? s.slice(0, 7) : shiftM(s.slice(0, 7), -1));
  const pStart = (m) => m + '-' + pad(u.startDay);
  const pEnd = (m) => add(pStart(shiftM(m, 1)), -1);
  const cur = pOf(u.today);
  const firstM = shiftM(cur, -u.history);
  const months = []; for (let m = firstM; m <= cur; m = shiftM(m, 1)) months.push(m);
  const firstDay = u.history === 0 ? add(u.today, -RI(0, Math.min(10, (D(u.today) - D(pStart(cur))) / 864e5))) : pStart(firstM);
  u.firstDay = firstDay;

  // categories
  let catDefs = CATS.slice(0, 5).map((c) => c[0]);
  if (P(.6)) catDefs.push('סופר');
  if (u.car) catDefs.push('דלק ותחבורה');
  if (P(.3)) catDefs.push('בגדים');
  if (u.smoker) catDefs.push('סיגריות');
  if (u.kids) catDefs.push('ילדים');
  if (u.dog) catDefs.push('כלב');
  if (P(.2)) catDefs.push('בריאות');
  if (u.manyCats) for (let k = 0; k < 14; k++) catDefs.push('קטגוריה נוספת ' + (k + 1));
  catDefs = [...new Set(catDefs)];
  const cats = catDefs.map((n, k) => ({ id: 'c' + k, name: u.longNotes && k === 1 ? 'קניות אונליין מכל מיני אתרים בחו״ל ובארץ כולל משלוחים ומכס' : n, budget: 0, _n: n }));
  if (u.subCats) { cats.push({ id: 'c90', name: 'וולט', budget: P(.5) ? 300 : 0, parent: 'c0', _n: 'אוכל בחוץ ומשלוחים' }); cats.push({ id: 'c91', name: 'מסעדות', budget: 0, parent: 'c0', _n: 'אוכל בחוץ ומשלוחים' }); }

  // fixed charges
  let fixed = [];
  FIXED.forEach(([n, a, b, p]) => {
    if (n === 'שכר דירה' && u.livesWithParents) return;
    if ((n === 'ביטוח רכב' || n === 'ליסינג/הלוואת רכב') && !u.car) return;
    if (n === 'גן ילדים' && !u.kids) return;
    if (n === 'אוכל לכלבים' && !u.dog) return;
    if (P(p)) fixed.push({ name: n, amount: Math.round(R(a, b) / 10) * 10 });
  });
  // --- true income per budget month (what really reaches the bank account) ---
  const shifts = []; const tx = []; const incomes = []; const truth = {};
  const netOf = (g) => g * (g < 6000 ? 0.88 : g < 10000 ? 0.83 : 0.78);
  // shifts per day
  const shiftDayP = u.shiftsPerWeek / 7;
  const startTimes = { morning: ['06:45', '07:00', '07:30', '08:00'], evening: ['14:00', '15:00', '16:00'], night: ['22:00', '23:00'], long12: ['07:00', '19:00'], weekend: ['08:00', '16:00', '23:00'] };
  const lens = { morning: [8, 9.5], evening: [6, 8.5], night: [8, 9], long12: [12, 12], weekend: [8, 9] };
  const histStart = firstDay;
  const lastShiftDay = add(u.today, 10); // a few planned ahead
  const grossByDay = {};
  if (u.hourlyWork) {
    for (let d = histStart; d <= lastShiftDay; d = add(d, 1)) {
      const w = wd(d);
      let p = shiftDayP;
      if (u.pattern === 'weekend') p = w === 5 || w === 6 ? .8 : shiftDayP * .6;
      if (u.keepsShabbat && (w === 6 || isRest(d))) p = 0;
      if (d > u.today && !P(.5)) p = 0;
      if (!P(p)) continue;
      let pat = u.pattern === 'mixed' ? pick(['morning', 'evening', 'night']) : u.pattern;
      if (u.keepsShabbat && w === 5 && (pat === 'evening' || pat === 'night')) pat = 'morning';
      let st = pick(startTimes[pat]);
      if (u.keepsShabbat && w === 6) continue;
      if (u.keepsShabbat && st >= '19:00' && (w === 5)) continue;
      const jitter = RI(-12, 12); let [h, m] = st.split(':').map(Number); let mins = h * 60 + m + jitter; mins = (mins + 1440) % 1440;
      const len = Math.round(R(...lens[pat]) * 60 + RI(-15, 25));
      const end = (mins + len) % 1440;
      const t = (x) => pad(Math.floor(x / 60)) + ':' + pad(x % 60);
      const row = { id: uid('s'), work_date: d, start_time: t(mins), end_time: t(end), break_min: u.breakMin, wage: u.wage, note: '', created_at: d + 'T20:00:00Z' };
      if (u.shiftTypes.length && w === 6 && st >= '19:00') { row.kind = 't1'; row.kind_rate = 150; }
      row._len = len;
      shifts.push(row);
    }
    if (u.sameStartEnd && shifts.length) { const r = shifts[shifts.length - 3] || shifts[0]; r.end_time = r.start_time; r._mistake = 'same-start-end'; }
    if (u.dupShift && shifts.length > 4) { const r = shifts[2]; shifts.push({ ...r, id: uid('s'), _mistake: 'duplicate' }); }
  }
  // Which shifts the user actually typed into the app
  const loggedShifts = shifts.filter((r) => r._mistake || u.shiftLogging === 'all' || (u.shiftLogging === 'most' ? P(.85) : P(.55)));

  // Pay is gross from the real shifts (the true count, including untyped ones); real salary net
  const realShifts = shifts.filter((r) => !r._mistake);
  const grossOfShift = (r) => { let L = r._len - r.break_min; return Math.max(L, 0) / 60 * r.wage * 1.08; }; // rough, premium avg ~8%
  months.forEach((m) => {
    const prevGross = realShifts.filter((r) => pOf(r.work_date) === shiftM(m, -1)).reduce((s, r) => s + grossOfShift(r), 0);
    const g = realShifts.filter((r) => pOf(r.work_date) === m).reduce((s, r) => s + grossOfShift(r), 0);
    const sal = u.salaryNet ? (u.salaryVaries ? Math.round(u.salaryNet * R(.92, 1.12) / 10) * 10 : u.salaryNet) : 0;
    // Reality: hourly pay for a month arrives on the 9th-10th of the next month
    truth[m] = { salary: sal, shiftGrossThis: Math.round(g), shiftGrossPrev: Math.round(prevGross), realIncome: Math.round(sal + netOf(prevGross)), fixed: 0, spent: 0, logged: 0, oneOff: 0 };
  });

  // Plan per month
  const plans = {};
  const fixedTotal = fixed.reduce((s, x) => s + x.amount, 0);
  months.forEach((m, k) => {
    const t = truth[m];
    const inc = [];
    if (u.salaryNet) {
      let typed = t.salary;
      if (u.payType === 'both' && u.bothTypedFull) typed = t.salary + Math.round(netOf(t.shiftGrossPrev));
      inc.push({ name: 'משכורת', amount: typed });
    } else if (u.typedSalary) inc.push({ name: 'משכורת', amount: u.typedSalary });
    else inc.push({ name: 'משכורת', amount: 0 });
    if (P(.06)) inc.push({ name: 'קצבת ילדים', amount: 170 * (u.kids ? 2 : 1) });
    if (P(.05)) inc.push({ name: 'עזרה מההורים', amount: Math.round(R(300, 1500) / 50) * 50 });
    let exps = fixed.map((x) => ({ ...x }));
    if (u.overCommitted) exps.push({ name: 'הלוואה גדולה', amount: 9000 });
    t.fixed = exps.reduce((s, x) => s + x.amount, 0);
    const income = (u.salaryNet || u.typedSalary) ? inc.reduce((s, x) => s + x.amount, 0) : t.realIncome;
    const free = Math.max(income - t.fixed, 0);
    const c = cats.map((x) => ({ id: x.id, name: x.name, budget: x.budget, ...(x.parent ? { parent: x.parent } : {}) }));
    const budgetMode = wpick([['none', 20], ['some', 30], ['full', 40], ['over', 10]]);
    const mains = c.filter((x) => !x.parent);
    mains.forEach((x, j) => {
      if (budgetMode === 'none') x.budget = 0;
      else if (budgetMode === 'some') x.budget = j % 2 ? 0 : Math.round(free * R(.05, .2) / 50) * 50;
      else x.budget = Math.round(free * (budgetMode === 'over' ? 1.4 : .95) / mains.length / 10) * 10;
    });
    plans[m] = { pct: 50, income: inc, expenses: exps, cats: c, _budgetMode: budgetMode };
  });

  // --- spending (truth) ---
  const quitDay = u.logging === 'quit' ? add(firstDay, RI(10, 40)) : null;
  const logP = { all: 1, most: .8, half: .5, rare: .2, quit: .9 }[u.logging];
  const spendFactor = { saver: R(.45, .75), balanced: R(.85, 1.02), spender: R(1.08, 1.45), impulsive: R(.9, 1.3), chaotic: R(.6, 1.6) }[u.personality];
  months.forEach((m) => {
    const t = truth[m], pl = plans[m];
    const income = pl.income.reduce((s, x) => s + x.amount, 0) + (u.salaryNet || u.typedSalary ? 0 : t.realIncome);
    const realFree = Math.max(t.realIncome - t.fixed, 600);
    const target = realFree * spendFactor;
    const a = pStart(m) < firstDay ? firstDay : pStart(m), b = pEnd(m) < u.today ? pEnd(m) : u.today;
    if (a > b) return;
    const days = Math.round((D(b) - D(a)) / 864e5) + 1;
    const fullDays = Math.round((D(pEnd(m)) - D(pStart(m))) / 864e5) + 1;
    let budget = target * days / fullDays;
    const mainCats = cats.filter((x) => !x.parent && !x._n.startsWith('קטגוריה נוספת'));
    let dd = a;
    while (budget > 0 && dd <= b) {
      const perDay = target / fullDays;
      let todaySpend = perDay * R(0.2, 1.8) * (wd(dd) === 4 || wd(dd) === 5 ? 1.3 : 1);
      if (u.personality === 'impulsive' && P(.06)) todaySpend += R(400, 2000);
      if (u.personality === 'chaotic' && P(.04)) todaySpend += R(800, 3500);
      // end of month crunch for spenders
      if (u.personality === 'spender' && +dd.slice(8) > 20 && P(.3)) todaySpend *= .4;
      const n = Math.max(1, Math.round(todaySpend / 90));
      for (let k = 0; k < n && budget > 0; k++) {
        const c = pick(mainCats);
        const [lo, hi] = amountFor(c._n);
        let amt = Math.min(Math.round(R(lo, hi)), Math.ceil(todaySpend / n * 1.6));
        amt = Math.max(amt, lo);
        if (u.decimals) amt = amt + pick([0.5, 0.9, 0.99, 0.25]);
        budget -= amt; t.spent += amt;
        const loggedNow = !(quitDay && dd > quitDay) && P(logP);
        if (!loggedNow) continue;
        let cat = c.id;
        if (u.subCats && c.id === 'c0' && P(.5)) cat = P(.7) ? 'c90' : 'c91';
        let spentOn = dd;
        if (u.logLate && P(.25)) spentOn = add(dd, RI(1, 3)) <= u.today ? add(dd, RI(1, 3)) : dd; // logged on the day they remembered
        let amount = amt;
        if (u.typoX10 && P(.03)) amount = amt * 10;
        const note = u.longNotes && P(.2) ? 'קניתי ' + pick(CATS.find((x) => x[0] === c._n)[1]) + ' עם חברים אחרי העבודה כי היה יום ארוך ומעייף ובסוף שילמתי על כולם' : pick(CATS.find((x) => x[0] === c._n)[1]);
        tx.push({ id: uid('t'), spent_on: spentOn, amount, category: cat, note, created_at: spentOn + 'T' + pad(RI(8, 22)) + ':' + pad(RI(0, 59)) + ':00Z', ...(P(.08) ? { tags: { nw: pick(['want', 'need']) } } : {}) });
        t.logged += amount;
      }
      dd = add(dd, 1);
    }
    if (u.tags.includes('one-off-incomes') && P(.5)) {
      const r = { id: uid('i'), received_on: add(a, RI(0, Math.max(0, days - 1))), amount: Math.round(R(100, 2500) / 10) * 10, kind: pick(['מתנה', 'החזר', 'בונוס', 'אחר']), note: pick(['יום הולדת', 'החזר מביט', 'בונוס חג', 'מכרתי ביד 2']), created_at: '2026-01-01T00:00:00Z' };
      incomes.push(r); t.oneOff += r.amount;
    }
  });
  if (u.hugeAmount) tx.push({ id: uid('t'), spent_on: add(u.today, -1) >= firstDay ? add(u.today, -1) : u.today, amount: 1250000, category: 'c0', note: 'טעות הקלדה', created_at: '2026-10-16T10:00:00Z' });
  if (u.futureTx) tx.push({ id: uid('t'), spent_on: add(u.today, RI(2, 8)), amount: RI(200, 1500), category: cats[0].id, note: 'טיסה (שילמתי מראש)', created_at: '2026-10-16T10:00:00Z' });
  if (u.deletedCat) tx.push({ id: uid('t'), spent_on: u.today, amount: 77, category: 'c-deleted', note: 'מקטגוריה שנמחקה', created_at: '2026-10-16T10:00:00Z' });

  // goals, wishlist
  const goals = [];
  if (P(.35)) goals.push({ id: 'g1', name: pick(['טיסה לחו״ל', 'קרן חירום', 'רכב', 'אייפון חדש', 'חתונה']), target: pick([3000, 5000, 10000, 40000]), saved: RI(0, 6000), created: firstDay });
  if (u.goalZero) goals.push({ id: 'g2', name: 'יעד מוזר', target: 1, saved: 50000, created: firstDay });
  const wishlist = P(.25) ? [{ id: 'w1', note: pick(['אוזניות', 'נעלי ריצה', 'קונסולה']), amount: RI(150, 2500), category: cats[1].id, addedAt: add(u.today, -RI(0, 6)) + 'T10:00:00.000Z', outcome: null }] : [];

  const settings = { gender: u.gender, tone: u.tone, startDay: u.startDay };
  if (u.wage) settings.wage = u.wage;
  if (u.hourlyWork) settings.shiftIncome = u.shiftIncome;
  if (u.payType) settings.payType = u.payType;
  if (u.payday) settings.payday = u.payday;
  if (u.otAfter !== 8.6) settings.otAfter = u.otAfter;
  if (!u.keepsShabbat) settings.shabbat = false;
  const salIn = {};
  if (u.payType === 'salary' || u.payType === 'both') months.forEach((m) => { if (m !== cur || !u.forgetsSalaryEntry) salIn[m] = pStart(m); });
  const storeMonths = {};
  months.forEach((m) => {
    const pl = plans[m];
    // a salary user who hasn't typed this month yet has no saved month: the app drafts it from last month
    if (m === cur && u.forgetsSalaryEntry && months.length > 1) return;
    storeMonths[m] = { pct: pl.pct, income: pl.income, expenses: pl.expenses, cats: pl.cats };
  });
  if (!Object.keys(storeMonths).length) storeMonths[cur] = { pct: 50, income: plans[cur].income, expenses: plans[cur].expenses, cats: plans[cur].cats };
  u.store = { settings, onboarded: true, months: storeMonths, tx, shifts: loggedShifts.map(({ _len, _mistake, ...r }) => r), incomes, goals, wishlist, shiftTypes: u.shiftTypes, salIn };
  u.truth = truth; u.cur = cur; u.months = months; u.plansMeta = Object.fromEntries(months.map((m) => [m, plans[m]._budgetMode]));
  u.counts = { tx: tx.length, shifts: loggedShifts.length, realShifts: realShifts.length, incomes: incomes.length, months: months.length };
  return u;
}

module.exports = (n, s) => { seed = s || 20261017; idc = 0; const users = []; for (let i = 0; i < n; i++) users.push(genUser(i)); return users; };
