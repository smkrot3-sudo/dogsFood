// Independent re-implementation (kept apart from the app on purpose) of the money model and the Israeli shift-pay rules, used to check what the app shows.
const pad = (n) => String(n).padStart(2, '0');
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const S = (t) => { const d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
const add = (s, n) => S(D(s) + n * 864e5);
const between = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const shiftM = (m, by) => { let [y, mo] = m.split('-').map(Number); mo += by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + pad(mo); };
const wd = (s) => new Date(D(s)).getUTCDay();

// Rest days (Shabbat + the legal holidays) for 2024-2027, typed in by hand from the Hebrew calendar
const HOL = { '2024-10-03': 'ר"ה', '2024-10-04': 'ר"ה', '2024-10-12': 'כיפור', '2024-10-17': 'סוכות', '2024-10-24': 'שמח"ת', '2025-04-13': 'פסח', '2025-04-19': 'שביעי',
  '2025-05-01': 'עצמאות', '2025-06-02': 'שבועות', '2025-09-23': 'ר"ה', '2025-09-24': 'ר"ה', '2025-10-02': 'כיפור', '2025-10-07': 'סוכות', '2025-10-14': 'שמח"ת',
  '2026-04-02': 'פסח', '2026-04-08': 'שביעי', '2026-04-22': 'עצמאות', '2026-05-22': 'שבועות', '2026-09-12': 'ר"ה', '2026-09-13': 'ר"ה', '2026-09-21': 'כיפור',
  '2026-09-26': 'סוכות', '2026-10-03': 'שמח"ת', '2027-03-23': 'פסח', '2027-03-29': 'שביעי', '2027-05-12': 'עצמאות', '2027-06-11': 'שבועות' };
const restDay = (s) => wd(s) === 6 || !!HOL[s];

// NOAA sunset for Tel Aviv, minutes after local midnight in Israel time (DST: last Friday of March to last Sunday of October)
function israelOffset(s) {
  const y = +s.slice(0, 4);
  const lastDow = (mo, dow) => { let d = new Date(Date.UTC(y, mo + 1, 0)); while (d.getUTCDay() !== dow) d = new Date(d - 864e5); return S(d); };
  const start = lastDow(2, 5), end = lastDow(9, 0);
  return s >= start && s < end ? 180 : 120;
}
function sunsetMin(s) {
  const lat = 32.08, lng = 34.78, rad = Math.PI / 180;
  const [y, m, d] = s.split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  const g = 2 * Math.PI / 365 * (n - 1 + (18 - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
  const utc = 720 - 4 * (lng - ha) - eqt; // sunset in minutes UTC
  return Math.round(utc + israelOffset(s));
}
// Is minute `min` of day `day` inside Shabbat/holiday (18 min before sunset on the eve to 40 min after sunset)?
function restAt(day, min) {
  if (restDay(day) && min < sunsetMin(day) + 40) return true;
  if (restDay(add(day, 1)) && min >= sunsetMin(day) - 18) return true;
  return false;
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
// Israel's UTC offset at a wall-clock minute: the clocks move at 02:00 (spring Friday, autumn Sunday)
const offAt = (day, min) => (min < 120 && israelOffset(add(day, -1)) !== israelOffset(day) ? israelOffset(add(day, -1)) : israelOffset(day));
function pay(r, st) {
  const s = toMin(r.start_time); let len = toMin(r.end_time) - s; if (len <= 0) len += 1440;
  // a shift through the night the clocks move is an hour longer (autumn) or shorter (spring)
  const endAbs = s + len, dst = offAt(r.work_date, s) - offAt(add(r.work_date, Math.floor(endAbs / 1440)), endAbs % 1440);
  if (Math.abs(dst) === 60 && len + dst > 0) len += dst;
  const brk = Math.min(+r.break_min || 0, len), bf = Math.floor((len - brk) / 2);
  const paid = []; let night = 0;
  for (let i = 0; i < len; i++) {
    if (i >= bf && i < bf + brk) continue;
    const abs = s + i, day = add(r.work_date, Math.floor(abs / 1440)), mod = abs % 1440;
    if (mod >= 22 * 60 || mod < 6 * 60) night++;
    paid.push(restAt(day, mod));
  }
  const base = (st && st.otAfter > 0 ? +st.otAfter : 8.6);
  const dayLen = (night >= 120 ? Math.min(7, base) : base) * 60;
  let g = 0;
  paid.forEach((rest, i) => {
    const tier = i < dayLen ? 0 : i < dayLen + 120 ? 1 : 2;
    const rate = Math.max((rest ? [150, 175, 200] : [100, 125, 150])[tier], +r.kind_rate || 100);
    g += (+r.wage || 0) / 60 * rate / 100;
  });
  return { gross: g, paidMin: paid.length, len, rest: paid.some(Boolean) };
}

// The money model as described to the owner: free money = income (+ shift pay per setting) - fixed charges;
// one-off incomes join it; allowed today = what is left for the rest of the period, split per day, minus today.
function model(store, month, today) {
  const st = store.settings || {};
  const sd = st.startDay >= 1 && st.startDay <= 28 ? +st.startDay : 1;
  const pOf = (s) => (+s.slice(8) >= sd ? s.slice(0, 7) : shiftM(s.slice(0, 7), -1));
  const pStart = (m) => m + '-' + pad(sd), pEnd = (m) => add(pStart(shiftM(m, 1)), -1);
  // no plan for this month: the last earlier month that has one
  const earlier = Object.keys(store.months).filter((k) => k < month && !store.months[k].example).sort();
  const plan = store.months[month] || store.months[earlier[earlier.length - 1]] || { income: [], expenses: [] };
  const isCur = pOf(today) === month, days = between(pStart(month), pEnd(month)) + 1;
  const payOf = (list) => list.reduce((s, r) => s + pay(r, st).gross, 0);
  const salaried = st.payType === 'salary';
  const mode = ['same', 'prev', 'off'].includes(st.shiftIncome) ? st.shiftIncome : 'same';
  let shiftInc = 0;
  if (!salaried && mode !== 'off') {
    const pm = mode === 'prev' ? shiftM(month, -1) : month;
    let total = payOf((store.shifts || []).filter((r) => pOf(r.work_date) === pm));
    // same month, current month: the rest of the month is guessed from last month until the shifts catch up
    if (mode === 'same' && isCur) {
      const last = payOf((store.shifts || []).filter((r) => pOf(r.work_date) === shiftM(month, -1)));
      const dayNum = between(pStart(month), today) + 1;
      const g = payOf((store.shifts || []).filter((r) => pOf(r.work_date) === month && r.work_date <= today)) + last * Math.max(days - dayNum, 0) / days;
      if (last > 0 && g > total) total = g;
    }
    shiftInc = Math.round(total);
  }
  const typed = plan.income.reduce((s, x) => s + (+x.amount || 0), 0);
  const inc = typed + shiftInc;
  const exp = plan.expenses.reduce((s, x) => s + (+x.amount || 0), 0);
  // a new user's first month: only the share of days left after signing up
  const fm = store.firstMonth, part = fm && fm.m === month && fm.frac > 0 && fm.frac < 1 ? fm.frac : 1;
  const free = part < 1 ? Math.round((typed - exp) * part) + shiftInc : inc - exp;
  const spend = Math.max(free, 0);
  const oneOff = (store.incomes || []).filter((r) => pOf(r.received_on) === month).reduce((s, r) => s + r.amount, 0);
  // one-off income first covers fixed charges that are bigger than the income
  const money = Math.max(spend + oneOff + Math.min(free, 0), 0);
  const list = (store.tx || []).filter((r) => pOf(r.spent_on) === month);
  const spent = list.reduce((s, r) => s + r.amount, 0);
  const out = { inc, exp, spend, shiftInc, oneOff, spent, money };
  if (isCur) {
    const sToday = list.filter((r) => r.spent_on === today).reduce((s, r) => s + r.amount, 0);
    const sFut = list.filter((r) => r.spent_on > today).reduce((s, r) => s + r.amount, 0);
    const daysLeft = between(today, pEnd(month)) + 1;
    const pool = money - (spent - sToday - sFut) - sFut;
    let allowance = Math.max(pool, 0) / daysLeft, aside = 0;
    // the last 3 days: a normal day's money, the rest is set aside
    if (daysLeft <= 3 && money > 0 && allowance > money / days) { aside = Math.round((allowance - money / days) * daysLeft); allowance = money / days; }
    out.left = allowance - sToday; out.daysLeft = daysLeft; out.aside = aside;
  }
  return out;
}
module.exports = { pay, model, sunsetMin, restDay, HOL, add, shiftM };
