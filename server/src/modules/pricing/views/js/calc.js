import { state, S } from './state.js';
import { num, toBase } from './format.js';

/* ---------- model / maths ---------- */
export function personCalc(p) {
  const monthlyCost = toBase(p.salary, p.cur) + toBase(p.extras, p.cur);
  const hours = num(p.hours) || 0;
  const billable = hours * (num(p.util) / 100);
  const raw = hours > 0 ? monthlyCost / hours : 0;
  const recovery = billable > 0 ? monthlyCost / billable : 0;
  const auto = S().basis === 'raw' ? raw : recovery;
  const rate = (p.override !== null && p.override !== '' && isFinite(parseFloat(p.override)))
    ? toBase(p.override, p.cur) : auto;
  return { monthlyCost, hours, billable, raw, recovery, rate };
}
export function expMonthly(e) {
  const a = toBase(e.amount, e.cur);
  if (e.freq === 'year') return a / 12;
  if (e.freq === 'quarter') return a / 3;
  if (e.freq === 'week') return a * 52 / 12;
  if (e.freq === 'once') return 0;
  return a;
}
export function company() {
  let payroll = 0, billableHours = 0, workHours = 0;
  state.team.forEach((p) => { const c = personCalc(p); payroll += c.monthlyCost; billableHours += c.billable; workHours += c.hours; });
  const fixed = state.expenses.reduce((s, e) => s + expMonthly(e), 0);
  const burn = payroll + fixed;
  const ohPerHour = billableHours > 0 ? fixed / billableHours : 0;
  const blended = billableHours > 0 ? burn / billableHours : 0;
  return { payroll, fixed, burn, billableHours, workHours, ohPerHour, blended };
}
export function personById(id) { return state.team.find((p) => p.id === id) || null; }

/* ---------- capacity ---------- */
export function thisMonth() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
export function monthKeyOf(y, mIndex) {
  const d = new Date(y, mIndex, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
export function monthWindow(n) {
  const d = new Date(); const out = [];
  for (let i = 0; i < n; i++) out.push(monthKeyOf(d.getFullYear(), d.getMonth() + i));
  return out;
}
export function spreadMonths(p) { return Math.max(1, Math.ceil(num(p.months) || 1)); }
/* hours per person per calendar month, from every project that is not lost or archived */
export function bookings(includeQuoting) {
  const map = {};
  state.projects.forEach((p) => {
    if (p.status === 'Lost' || p.status === 'Archived') return;
    if (!includeQuoting && p.status === 'Quoting') return;
    const n = spreadMonths(p);
    const [y, m] = (p.start || thisMonth()).split('-').map(Number);
    (p.lines || []).forEach((l) => {
      const per = num(l.hours) / n;
      for (let i = 0; i < n; i++) {
        const key = monthKeyOf(y, m - 1 + i);
        (map[l.personId] = map[l.personId] || {});
        map[l.personId][key] = (map[l.personId][key] || 0) + per;
      }
    });
  });
  return map;
}
export function loadColour(u) { return u > 1.0001 ? 'var(--critical)' : (u > 0.85 ? 'var(--s4)' : 'var(--s1)'); }

export function projectCalc(proj, opts) {
  opts = opts || {};
  const hf = opts.hoursFactor === undefined ? 1 : opts.hoursFactor;
  const co = company();
  let labour = 0, hours = 0;
  const byPerson = [];
  (proj.lines || []).forEach((l) => {
    const per = personById(l.personId);
    const rate = per ? personCalc(per).rate : 0;
    const h = num(l.hours) * hf;
    labour += h * rate; hours += h;
    byPerson.push({ line: l, person: per, hours: h, rate, labour: h * rate, overhead: h * co.ohPerHour });
  });
  const overhead = hours * co.ohPerHour;
  const direct = (proj.direct || []).reduce((s, d) => s + toBase(d.amount, d.cur), 0)
    + toBase(opts.extraDirect || 0, S().currency);
  const base = labour + overhead + direct;
  const contPct = num(proj.cont) / 100;
  const contAmt = base * contPct;
  const cost = base + contAmt;
  const target = num(proj.target) / 100;
  const suggested = target < 0.95 ? cost / (1 - target) : cost;
  /* prices are typed in the project's quote currency; everything else is base */
  const qc = proj.cur || S().currency;
  let price = opts.price !== undefined && opts.price !== null && opts.price !== ''
    ? (opts.priceIsBase ? num(opts.price) : toBase(opts.price, qc))
    : (proj.price === null || proj.price === '' || proj.price === undefined ? suggested : toBase(proj.price, qc));
  const profit = price - cost;
  const margin = price > 0 ? profit / price : 0;
  const markup = cost > 0 ? profit / cost : 0;
  const effRate = hours > 0 ? price / hours : 0;
  const months = Math.max(num(proj.months) || 1, 0.25);
  const capShare = co.billableHours > 0 ? (hours / months) / co.billableHours : 0;
  return {
    co, byPerson, labour, hours, overhead, direct, base, contAmt, cost, qc,
    suggested, price, profit, margin, markup, effRate, capShare, months,
  };
}
export function currentProject() {
  return state.projects.find((p) => p.id === state.ui.currentProject) || state.projects[0] || null;
}

export function marginPill(m) {
  if (m >= 0.4) return '<span class="pill good">healthy</span>';
  if (m >= 0.25) return '<span class="pill good">ok</span>';
  if (m >= 0.1) return '<span class="pill warn">thin</span>';
  if (m > 0) return '<span class="pill bad">very thin</span>';
  return '<span class="pill bad">losing money</span>';
}
