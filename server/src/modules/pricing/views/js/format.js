import { S } from './state.js';

/* ---------- currency ----------
   Every stored figure is converted to the base currency (EGP) the moment it is read,
   so costs, margins and capacity are always compared like with like. Only the display
   layer converts back out. rates[X] = how many base units one X is worth. */
export const LOGO_LIGHT = '/logo-light.png';
export const LOGO_DARK = '/logo-dark.png';
export const CURS = ['EGP', 'AED', 'SAR', 'USD'];

export const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export const fmt = (n, d) => {
  d = d || 0;
  if (!isFinite(n)) n = 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

export function rateOf(c) {
  if (c === S().currency) return 1;
  const r = num((S().rates || {})[c]);
  return r > 0 ? r : 1;
}
export const toBase = (v, c) => num(v) * rateOf(c || S().currency);
export const fromBase = (v, c) => { const r = rateOf(c || S().currency); return r ? v / r : 0; };
export function disp() { return CURS.indexOf(S().display) >= 0 ? S().display : S().currency; }
/* decimals: whole numbers for anything sizeable, two places once a conversion
   makes the figure small (5.31 USD reads as money, "5" does not) */
export const autoDp = (v, d) => (d || (v !== 0 && Math.abs(v) < 100 ? 2 : 0));
/* money(baseValue) → a string in the display currency; pass cur to force one */
export const money = (n, d, cur) => {
  const v = fromBase(n, cur || disp());
  return fmt(v, autoDp(v, d)) + ' ' + (cur || disp());
};
/* plain number, no currency code, in the display currency */
export const m0 = (n, cur, d) => { const v = fromBase(n, cur || disp()); return fmt(v, autoDp(v, d)); };
export const curOpts = (sel) => CURS.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
export const pct = (n) => (isFinite(n) ? (n * 100) : 0).toFixed(1) + '%';
