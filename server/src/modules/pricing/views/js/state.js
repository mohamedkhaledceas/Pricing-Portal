import { uid } from './dom.js';

export const USER_MANAGER_ROLES = ['admin', 'manager', 'operations'];

export let state;
export let dirty = false;
export function setDirty(value) { dirty = value; }
export function S() { return state.settings; }

/* Pure one-line duplicate of calc.js's thisMonth() — deliberately NOT
   imported from there. calc.js needs `state`/`S` from this module for its
   real math (personCalc, company, projectCalc, ...), so this module
   importing calc.js back would create a circular import; this one date-math
   line is cheap enough to duplicate rather than restructure around. */
function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function sampleState() {
  const t = [
    { id: uid(), name: 'Marie', role: 'Managing director', salary: 35000, extras: 2000, hours: 176, util: 40, override: null, cur: 'EGP' },
    { id: uid(), name: 'Art director', role: 'Creative', salary: 25000, extras: 1500, hours: 176, util: 70, override: null, cur: 'EGP' },
    { id: uid(), name: 'Senior designer', role: 'Creative', salary: 18000, extras: 1200, hours: 176, util: 75, override: null, cur: 'EGP' },
    { id: uid(), name: 'Account manager', role: 'Client service', salary: 15000, extras: 1000, hours: 176, util: 65, override: null, cur: 'EGP' },
  ];
  const p = {
    id: uid(), name: 'Brand identity — sample', client: 'Sample client', months: 2, status: 'Quoting',
    start: currentMonthKey(), cur: 'EGP',
    lines: [{ id: uid(), personId: t[1].id, hours: 60 }, { id: uid(), personId: t[2].id, hours: 90 }, { id: uid(), personId: t[3].id, hours: 30 }],
    direct: [{ id: uid(), name: 'Stock images & fonts', amount: 4000, cur: 'EGP' }],
    cont: 10, target: 35, price: null,
    scenarios: [
      { id: uid(), name: 'As planned', hoursFactor: 100, extra: 0, price: null },
      { id: uid(), name: 'Client negotiates −15%', hoursFactor: 100, extra: 0, price: null, _pct: 0.85 },
      { id: uid(), name: 'Runs 25% over on hours', hoursFactor: 125, extra: 0, price: null },
      { id: uid(), name: 'Rush — extra freelancer', hoursFactor: 100, extra: 8000, price: null },
    ],
    quote: {
      num: 'Q-001', date: new Date().toISOString().slice(0, 10), valid: 30, detail: 'lump', disc: 0, vat: 14,
      scope: 'Full brand identity: discovery, three creative routes, two rounds of refinement, final logo suite, colour and type system, and a brand guidelines document.',
      terms: '50% on approval of this quotation, 50% on delivery of final files.\nPrices valid for 30 days. VAT not included above unless stated.',
      lines: [{ id: uid(), name: 'Phase 1 — discovery & strategy', amount: 0 }, { id: uid(), name: 'Phase 2 — identity design', amount: 0 }],
    },
  };
  return {
    settings: {
      company: 'Ceas comm.', currency: 'EGP', display: 'EGP', defaultHours: 176, defaultUtil: 70,
      targetMargin: 35, contingency: 10, basis: 'recovery', floorMargin: 15,
      rates: { EGP: 1, AED: 14.14, SAR: 13.85, USD: 51.93 }, ratesDate: '2026-08-02',
      logo: null, logoQuote: true,
    },
    security: { pinHash: null },
    team: t,
    expenses: [
      { id: uid(), name: 'Office rent', cat: 'Premises', amount: 15000, freq: 'month', cur: 'EGP' },
      { id: uid(), name: 'Utilities & internet', cat: 'Premises', amount: 3000, freq: 'month', cur: 'EGP' },
      { id: uid(), name: 'Adobe Creative Cloud', cat: 'Software', amount: 22000, freq: 'year', cur: 'EGP' },
      { id: uid(), name: 'Accountant', cat: 'Professional', amount: 2000, freq: 'month', cur: 'EGP' },
      { id: uid(), name: 'Cleaning & supplies', cat: 'Premises', amount: 1200, freq: 'month', cur: 'EGP' },
    ],
    projects: [p],
    ui: { currentProject: p.id, mode: 'admin' },
  };
}

export function emptyState() {
  const s = sampleState();
  s.team = []; s.expenses = []; s.projects = []; s.ui.currentProject = null;
  return s;
}

/* Normalizes a server team array (from any /api/team response) back into
   state.team after a create/update/delete round-trip. */
export function applyServerTeam(team) {
  if (!Array.isArray(team)) return false;
  state.team = team.map((member) => ({
    ...member,
    id: String(member.id),
    name: member.name || '',
    role: member.role || '',
    cur: member.cur || member.currency || S().currency,
    override: member.override === null || member.override === undefined ? null : Number(member.override),
    salary: Number(member.salary || 0),
    extras: Number(member.extras || 0),
    hours: Number(member.hours || S().defaultHours || 176),
    util: Number(member.util || S().defaultUtil || 70),
  }));
  return true;
}

/* Back-fills missing fields on any loaded blob (file import or server
   payload) to the current shape. */
export function migrate(d) {
  d.settings = Object.assign({
    company: '', currency: 'EGP', display: 'EGP', defaultHours: 176, defaultUtil: 70,
    targetMargin: 35, contingency: 10, basis: 'recovery', floorMargin: 15,
    rates: { EGP: 1, AED: 14.14, SAR: 13.85, USD: 51.93 }, ratesDate: '', logo: null, logoQuote: true,
  }, d.settings || {});
  d.settings.rates = Object.assign({ EGP: 1, AED: 14.14, SAR: 13.85, USD: 51.93 }, d.settings.rates || {});
  d.settings.rates[d.settings.currency] = 1;
  d.security = Object.assign({ pinHash: null }, d.security || {});
  d.team = d.team || []; d.expenses = d.expenses || []; d.projects = d.projects || [];
  const base = d.settings.currency;
  d.team.forEach((t) => { t.cur = t.cur || base; });
  d.expenses.forEach((x) => { x.cur = x.cur || base; });
  d.projects.forEach((p) => {
    p.lines = p.lines || []; p.direct = p.direct || []; p.scenarios = p.scenarios || [];
    p.start = p.start || currentMonthKey();
    p.cur = p.cur || base;
    p.direct.forEach((x) => { x.cur = x.cur || base; });
    p.quote = Object.assign({ num: '', date: '', valid: 30, detail: 'lump', disc: 0, vat: 0, scope: '', terms: '', lines: [] }, p.quote || {});
  });
  d.ui = d.ui || {};
  if (!d.ui.currentProject && d.projects.length) d.ui.currentProject = d.projects[0].id;
  /* a file with no PIN always opens in the owner view — this is the recovery path
     if a PIN is ever forgotten: keep one PIN-free backup somewhere safe */
  if (!d.security.pinHash) d.ui.mode = 'admin';
  if (d.ui.mode !== 'bd') d.ui.mode = 'admin';
  return d;
}

export function setState(next) { state = next; }

export function isBD() { return state.ui.mode === 'bd'; }

/* The team (BD) view hides every cost, salary and margin figure and leaves
   only the estimator. The PIN keeps those tabs out of sight in a shared
   file; it is not encryption, and Settings says so plainly. */
export function hashPin(s) {
  let h = 5381;
  const str = 'ceas' + String(s).trim();
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}

state = sampleState();
