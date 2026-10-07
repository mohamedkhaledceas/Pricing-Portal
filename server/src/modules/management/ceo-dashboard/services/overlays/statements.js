/* Odoo statements: the Profit and Loss, balance sheet and cash, and each
   company's closed years, laid over the Control Room payload. Pure. */
/* Odoo's Profit and Loss (finance getProfitAndLoss) — one company in its
   own currency, or All in Odoo's year-average conversion. The four profit
   KPIs come straight from its lines; their sample targets are dropped
   (targets arrive with phase 3). */
function applyPnl(D, p) {
  D.pnlLive = p;
  const c = p.current;
  const pctOf = (part) => (c.revenue ? Math.round((part / c.revenue) * 1000) / 10 : null);
  const where = p.consolidated
    ? `Odoo Accounting → Reporting → Profit and Loss, all companies, ${p.year} — AED at the year-average rate`
    : `Odoo Accounting → Reporting → Profit and Loss, ${p.year}`;
  const setKpi = (id, fields) => Object.assign(D.kpis.find((k) => k.id === id), {
    live: true, currency: p.currency, source: 'Odoo', tolerance: null, target: null, drill: 'pnl_live', query: where,
  }, fields);
  setKpi('gross_margin', { actual: pctOf(c.grossProfit), formula: 'Gross profit ÷ revenue (P&L lines Revenue and Less Costs of Revenue).' });
  setKpi('net_margin', { actual: pctOf(c.netProfit), formula: 'Net profit ÷ revenue (P&L line Net Profit, before allocations and withdrawals).' });
  setKpi('net_profit', { actual: c.netProfit, formula: 'P&L line Net Profit: revenue + other income − costs of revenue − operating and other expenses.' });
  setKpi('opex_ratio', { actual: pctOf(c.operatingExpenses), formula: 'Operating expenses ÷ revenue (P&L line Less Operating Expenses).' });
  for (const id of ['gross_margin', 'net_margin', 'net_profit', 'opex_ratio']) {
    delete D.series[id];
    delete D.yearMap[id];
  }
  const cur = p.currency;
  D.records.pnl_live = {
    columns: ['Month', `Revenue (${cur})`, `Gross profit (${cur})`, `Operating expenses (${cur})`, `Net profit (${cur})`],
    rows: p.months.map((m) => [m.month, m.revenue, m.grossProfit, m.operatingExpenses, m.netProfit]),
    source: 'Odoo · posted journal items on profit-and-loss accounts',
    note: p.consolidated ? `AED converted at Odoo's year-average rate (${Object.values(p.rates).map((r) => r.toFixed(4)).join(', ')}).` : `In ${cur}, as posted in Odoo.`,
  };
}

/* One company's balance sheet and cash (finance getBalanceSheet). The
   cash bridge becomes Odoo's own movements: opening, received, spent,
   closing. Not under All — see getBalanceSheet. */
function applyBalance(D, x) {
  D.bsLive = x;
  const c = x.cash;
  const setKpi = (id, fields) => Object.assign(D.kpis.find((k) => k.id === id), {
    live: true, currency: x.currency, source: 'Odoo', tolerance: null, target: null, drill: 'cash_accounts',
  }, fields);
  setKpi('cash_balance', {
    actual: c.closing,
    query: 'Odoo Dashboards → Finance → Accounting → "Closing bank balance": every bank, cash and credit-card account',
    formula: 'What is in the bank today, as posted in Odoo. Every bank account counts, including Alex Bank (Personal), until told otherwise.',
  });
  setKpi('cash_runway', {
    actual: c.runwayMonths,
    query: 'Closing bank balance ÷ average monthly cash spent over the last three full months',
    formula: 'The portal\'s own measure (Odoo has none). Cash spent includes transfers between the company\'s own bank accounts, as Odoo\'s "Cash spent" does, so it errs on the short side.',
  });
  for (const id of ['cash_balance', 'cash_runway']) {
    delete D.series[id];
    delete D.yearMap[id];
  }
  D.records.cash_accounts = {
    columns: ['Account', `Balance (${x.currency})`],
    rows: c.accounts.map((a) => [`${a.code || ''} ${a.name}`.trim(), a.balance]),
    source: 'Odoo · posted journal items on bank, cash and credit-card accounts',
    note: `Received ${c.received.toLocaleString('en-US')} and spent ${c.spent.toLocaleString('en-US')} this year; average monthly spend over the last three months ${c.averageMonthlySpent.toLocaleString('en-US')}.`,
  };
  D.cash = {
    ...D.cash,
    live: true,
    balance: c.closing,
    opening: c.opening,
    bridge: [
      { label: 'Opening cash · 1 Jan', value: c.opening, kind: 'total' },
      { label: 'Cash received', value: c.received, kind: 'up' },
      { label: 'Cash spent', value: -c.spent, kind: 'down' },
      { label: 'Cash today', value: c.closing, kind: 'total' },
    ],
  };
}

/* Closed years and year-on-year (phase 6) from finance getYearHistory —
   one company's own Odoo figures. Replaces the sample's invented years:
   the year review's rows are only what Odoo can answer, and only live
   KPIs whose history has the same definition get a "vs <year>" line (not
   DSO: the live card uses open invoices, history the balance sheet). */
const YEAR_ROWS = [
  { name: 'Revenue (invoiced)', unit: 'egp', grp: 'ytd', key: 'revenue', dir: 'higher' },
  { name: 'Cost of revenue', unit: 'egp', grp: 'ytd', key: 'directCost', dir: 'lower' },
  { name: 'Gross margin', unit: 'pct', grp: 'ytd', key: 'grossMargin', dir: 'higher' },
  { name: 'Operating expenses', unit: 'egp', grp: 'ytd', key: 'opex', dir: 'lower' },
  { name: 'OPEX ratio', unit: 'pct', grp: 'ytd', key: 'opexRatio', dir: 'lower' },
  { name: 'Net profit', unit: 'egp', grp: 'ytd', key: 'netProfit', dir: 'higher' },
  { name: 'Net margin', unit: 'pct', grp: 'ytd', key: 'netMargin', dir: 'higher' },
  { name: 'Cash', unit: 'egp', grp: 'at', key: 'cash', dir: 'higher' },
  { name: 'Cash runway', unit: 'mo', grp: 'at', key: 'runway', dir: 'higher' },
  { name: 'Receivables (balance sheet)', unit: 'egp', grp: 'at', key: 'receivables', dir: 'lower' },
  { name: 'DSO (balance-sheet receivables)', unit: 'd', grp: 'at', key: 'dso', dir: 'lower' },
];

const LIVE_YEAR_MAP = {
  revenue_total: ['ytd', 'revenue'],
  gross_margin: ['ytd', 'grossMargin'],
  net_profit: ['ytd', 'netProfit'],
  net_margin: ['ytd', 'netMargin'],
  opex_ratio: ['ytd', 'opexRatio'],
  cash_balance: ['at', 'cash'],
  cash_runway: ['at', 'runway'],
};

function applyYears(D, h) {
  D.years = h.years;
  D.currentYear = h.currentYear;
  D.booksStart = h.booksStart;
  D.yearRows = YEAR_ROWS;
  D.yearMap = LIVE_YEAR_MAP;
  D.yearsLive = true;
}

/* Under All there is no year history (see getYearHistory): only the
   current year, so the year selector offers nothing invented. */
function currentYearOnly(D, todayIso) {
  const y = todayIso.slice(0, 4);
  D.years = { [y]: { label: y, status: 'current', through: todayIso, ytd: {}, at: {}, full: null } };
  D.currentYear = y;
  D.yearRows = [];
  D.yearMap = {};
  D.yearsLive = false;
}

module.exports = { applyPnl, applyBalance, applyYears, currentYearOnly };
