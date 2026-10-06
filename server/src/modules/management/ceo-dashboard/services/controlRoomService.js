/* Builds the CEO Control Room payload: the prototype's sample data (the
   `D` object the frontend renders) with every block that has a real source
   overwritten from it. One payload per entity, because the Odoo figures are
   per company.

   Live sources (each read through its owner's public interface):
   - finance (management/finance, ADR-0013): invoiced revenue, receivables,
     aging, DSO, collection rate, client book — per Odoo company. 'all'
     (Consolidated) stays sample until live FX lands (step 3c).
   - pipeline (management/commercial-leads, ADR-0010): open deals by funnel
     stage + quarterly cohort figures. ClickUp isn't split by entity, so the
     same figures show under every entity.
   - people (employees): headcount by department, joiners, people away.
     Company-wide, same reasoning.
   - costs (marginPlannerSummary): monthly burn / payroll / fixed expenses.
     Ceas Comm only — the Margin Planner is single-company.

   `sources` says which blocks are real, so the frontend badges them
   instead of trusting a page-wide banner. A source that fails to read
   falls back to sample (logged, marked 'error') rather than failing the
   page. Everything not listed above is still the prototype's invented data.

   KPI targets for live figures are only the ones ADR-0013 carries over
   (DSO 55 days, collection rate 85%); the prototype's other targets were
   invented for its fictional agency and aren't applied to real numbers. */
const { ValidationError } = require('../../../../common/errors');

const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const CAIRO_LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const CAIRO_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
const CAIRO_DAY_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' });

const ENTITY_LIST = Object.freeze([
  // `short` labels the top-bar switcher, which has to fit on one line.
  { key: 'ceas', name: 'Ceas Comm', short: 'Ceas Comm', currency: 'EGP', note: 'Odoo company Ceas Comm (Egypt).' },
  { key: 'fze', name: 'Ceas Comm FZE', short: 'FZE', currency: 'AED', note: 'Odoo company Ceas Comm FZE (UAE), in AED.' },
  { key: 'lwm', name: 'Learn with Marie', short: 'LWM', currency: 'EGP', note: 'Odoo company Learn With Marie.' },
  { key: 'all', name: 'Consolidated', short: 'All', currency: 'EGP', note: 'All companies. Revenue is Odoo\'s own EGP conversion; everything else is sample.' },
]);

const LIVE_FINANCE_KPIS = ['revenue_total', 'dso', 'overdue_60_share', 'collection_rate'];
const COMPANY_SHORT = { ceas: 'Ceas Comm', fze: 'FZE', lwm: 'LWM' };

const pctText = (part, whole) => (whole > 0 ? `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%` : '—');

/* "All companies": revenue only, from Odoo's Invoices Analysis already
   converted into EGP by Odoo (finance getConsolidatedRevenue). Receivables,
   DSO and collections stay sample here — they exist per company only. */
function applyConsolidatedRevenue(D, f) {
  const rev = f.revenue;
  D.months = rev.months;
  D.revenue = {
    ...D.revenue,
    live: true,
    consolidated: true,
    actual: rev.actual,
    target: null,
    ytd: rev.ytd,
    ytdTarget: null,
    monthDay: rev.monthDay,
    documentCount: rev.documentCount,
    averageInvoice: rev.averageInvoice,
    largestInvoices: rev.largestInvoices,
    bySalesperson: rev.bySalesperson,
    // Odoo's other all-companies revenue: the Profit and Loss Revenue line.
    pnl: f.pnl,
  };
  Object.assign(D.kpis.find((k) => k.id === 'revenue_total'), {
    alt: { label: 'Odoo P&L', value: f.pnl.revenue, hint: `Odoo's Profit and Loss Revenue line for ${f.pnl.year}, AED at the year-average rate` },
    live: true,
    currency: f.currency,
    source: 'Odoo',
    tolerance: null,
    name: 'Revenue',
    actual: rev.ytd,
    target: null,
    query: 'Odoo Invoices Analysis, all three companies, converted into EGP by Odoo — Odoo Dashboards → Finance → Invoicing → "Invoiced" with every company selected (Period: this year)',
    formula: 'Year to date, invoice basis, converted by Odoo at about today\'s rate (Odoo\'s Invoicing dashboard). The second figure is Odoo\'s Profit and Loss Revenue line for the whole year: AED converted at the year\'s average of Odoo\'s daily rates, and income posted outside invoices included.',
  });
  delete D.series.revenue_total;
  delete D.yearMap.revenue_total;
  // The sample drill records describe invented clients — not under a live figure.
  delete D.records.revenue;
}

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

/* Sales orders (Odoo Sales Analysis via finance getSalesSummary), for one
   company or — under All — in Odoo's own EGP conversion. */
function applySales(D, s) {
  const cur = s.currency;
  const b = s.backlog;
  const overstated = b.invoicesWithoutOrder > 0
    ? `${b.invoicesWithoutOrder} of ${b.invoicesThisYear} invoices this year weren't made from a sales order, so Odoo still counts those orders as to invoice — the figure is overstated until invoicing goes through the sales order.`
    : 'Every invoice this year was made from a sales order.';
  D.sales = { live: true, ...s, backlogNote: overstated };
  const setKpi = (id, fields) => Object.assign(D.kpis.find((k) => k.id === id), { live: true, currency: cur, source: 'Odoo', tolerance: null, target: null }, fields);
  setKpi('backlog', {
    actual: b.value,
    drill: 'sales_backlog',
    query: 'Odoo Sales Analysis: untaxed amount still to invoice on confirmed sales orders, any order date',
    formula: `Work already sold and not yet invoiced. ${overstated}`,
  });
  setKpi('avg_deal_size', {
    actual: s.booked.averageOrder,
    drill: 'sales_booked',
    query: 'Odoo Dashboards → Sales → Sales → "Average Order" (Period: this year): confirmed orders\' untaxed value ÷ number of orders',
    formula: 'The average confirmed sales order this year. Separates "closing fewer deals" from "closing smaller ones".',
  });
  for (const id of ['backlog', 'avg_deal_size']) {
    delete D.series[id];
    delete D.yearMap[id];
  }
  const who = (o) => (o.company && s.consolidated ? `${o.customer} (${COMPANY_SHORT[o.company] || o.company})` : o.customer);
  D.records.sales_backlog = {
    columns: ['Order', 'Client', 'Order date', 'Salesperson', `To invoice (${cur})`, `Order value (${cur})`],
    rows: b.top.map((o) => [o.name, who(o), o.orderDate, o.salesperson || '—', o.toInvoice, o.value]),
    source: 'Odoo · Sales Analysis · confirmed orders',
    note: `Largest 20 of ${b.orders} orders with something left to invoice. ${overstated}`,
  };
  D.records.sales_booked = {
    columns: ['Order', 'Client', 'Order date', 'Salesperson', `Value (${cur})`],
    rows: s.booked.top.map((o) => [o.name, who(o), o.orderDate, o.salesperson || '—', o.value]),
    source: 'Odoo · Sales Analysis · confirmed orders this year',
    note: `Largest 20 of ${s.booked.orders} orders confirmed this year, untaxed.`,
  };
}

/* Saved budgets (budgetService, migration 041) replace the sample's
   P&L-line budgets and function plans; the seeds ride along so the page
   can mark what has been changed from the workbook. */
function applyBudgets(D, state) {
  for (const line of D.budget.lines) {
    const saved = state.lines[line.name];
    if (saved) Object.assign(line, { annual: saved.annual, seedAnnual: saved.seedAnnual });
  }
  for (const fn of D.functions) {
    for (const cat of fn.categories) {
      const saved = state.plans[fn.id] && state.plans[fn.id][cat.name];
      if (saved) Object.assign(cat, { plan: saved.plan, seedPlan: saved.seed });
    }
  }
  D.budgetSaved = true;
}

/* Saved targets for this view (targetService, migration 042) replace
   every KPI's target — they start empty, so a KPI with none saved shows
   "no target set" (user decision 2026-10-06). Hand-entered KPIs of this
   view are added as monitoring KPIs. Runs after the live overlays. */
const toCustomKpi = (c, target) => ({
  id: c.key,
  name: c.name,
  band: 'money',
  component: c.component,
  dept: 'exec',
  unit: c.unit,
  direction: c.direction,
  targetType: c.targetType,
  tolerance: c.targetType === 'exact' && target != null ? Math.max(Math.abs(target) * 0.05, 1) : null,
  agg: 'end_of_period',
  actual: c.actual,
  target,
  scored: false,
  drill: null,
  custom: true,
  source: 'Entered by hand',
  query: `Added on the Targets page on ${c.createdAt.slice(0, 10)}`,
  formula: 'Defined by hand; its actual is typed in, not read from Odoo or ClickUp.',
});

function applyTargets(D, state) {
  for (const k of D.kpis) k.target = state.targets[k.id] ?? null;
  for (const c of state.custom) D.kpis.push(toCustomKpi(c, state.targets[c.key] ?? null));
  D.targetsSaved = true;
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

function applyFinance(D, f, entity) {
  const cur = entity.currency;
  const { revenue: rev, collections: col } = f;
  const kpi = (id) => D.kpis.find((k) => k.id === id);
  const setKpi = (id, fields) => Object.assign(kpi(id), { live: true, currency: cur, source: 'Odoo', tolerance: null }, fields);

  D.months = rev.months;
  D.revenue = {
    ...D.revenue,
    live: true,
    actual: rev.actual,
    target: null,
    ytd: rev.ytd,
    ytdTarget: null,
    documentCount: rev.documentCount,
    averageInvoice: rev.averageInvoice,
    largestInvoices: rev.largestInvoices,
    bySalesperson: rev.bySalesperson,
    trailing90: rev.trailing90,
    concentration: rev.concentration,
    topClient: rev.topClient,
    monthDay: rev.monthDay,
    clients: rev.clients.map((c) => ({
      name: c.name, value: c.value, am: c.am, overdue: c.overdue, linked: c.linked,
      // Not in Odoo's invoice data — the client book shows "—" for these.
      type: null, reliability: null, repeat: null, avgPay: null,
    })),
  };
  D.workingCapital = {
    ...D.workingCapital,
    live: true,
    receivables: col.receivables,
    openInvoices: col.openInvoices,
    aging: col.aging,
    dso: col.dso,
    overdue60: col.overdue60plus,
    overdue60Pct: col.overdue60pct,
    withoutTermsPct: col.withoutTermsPct,
    billedMtd: col.billedMtd,
    collectedMtd: col.collectedMtd,
  };

  setKpi('revenue_total', {
    name: 'Revenue',
    actual: rev.ytd,
    target: null,
    query: 'Posted customer invoices minus credit notes, untaxed, by invoice date, company currency — Odoo Dashboards → Finance → Invoicing → "Invoiced" (Period: this year)',
    formula: 'Year to date, invoice basis. Revenue is the invoiced figure (user decision 2026-10-06, replacing the paid-sales-order definition).',
  });
  setKpi('dso', {
    actual: col.dso,
    target: col.dsoTarget,
    query: 'Open receivables ÷ the last 90 days of billing (VAT incl.) × 90',
    formula: 'Average days between invoicing and being paid. Target is ADR-0013\'s carried-over 55 days.',
  });
  setKpi('overdue_60_share', {
    actual: col.overdue60pct,
    target: null,
    query: 'Open residual more than 60 days past due date ÷ all open residual',
    formula: 'The share of the book that is genuinely late. No target agreed yet.',
  });
  setKpi('collection_rate', {
    actual: col.collectionRate,
    target: col.collectionRateTarget,
    query: 'Customer payments in state paid this month ÷ amount billed this month, both VAT incl.',
    formula: 'How much of this month\'s billing has arrived. Early in a month it swings on very few invoices.',
  });
  for (const id of LIVE_FINANCE_KPIS) {
    // No live history yet — a sample sparkline or prior-year value next to
    // a real figure would read as real.
    delete D.series[id];
    delete D.yearMap[id];
  }

  D.records.revenue = {
    columns: ['Client', `Trailing 90d (${cur})`, 'Share', 'Account manager', `Overdue (${cur})`],
    rows: rev.clients.map((c) => [c.name, c.value, pctText(c.value, rev.trailing90), c.am || '—', c.overdue]),
    source: 'Odoo · posted customer invoices',
    note: 'Trailing 90 days, untaxed. Customers linked to a portal client on the client-mapping page are grouped under it.',
  };
  D.records.receivables = {
    columns: ['Client', 'Account manager', `Overdue (${cur})`, 'Days past due', 'Invoices'],
    rows: col.detail.map((d) => [d.name, d.am || '—', d.value, d.days, d.invoices]),
    source: 'Odoo · open customer invoices',
    note: `${cur} ${col.receivables.toLocaleString('en-US')} open across ${col.openInvoices} invoices. `
      + `${col.withoutTermsPct ?? 0}% have no payment term, so they fall due on the invoice date.`,
  };
}

function applyPipeline(D, p) {
  D.pipeline = {
    ...D.pipeline,
    live: true,
    stages: p.open.map((s) => ({ name: s.name, count: s.count, value: s.count, prob: null })),
    openCount: p.open.reduce((sum, s) => sum + s.count, 0),
    quarters: p.quarters,
    stageDurations: p.stageDurations,
  };
}

function applyPeople(D, w) {
  D.people = {
    ...D.people,
    live: true,
    headcount: w.headcount,
    freelancers: w.freelancers,
    joinersYtd: w.joinersYtd,
    awayNext: w.awayNext,
    awayDays: w.awayDays,
    departments: w.departments,
  };
}

function createControlRoomService({
  sampleRepository, budgetService, targetService, escalationService, financeMetricsService, getPipelineSummary, getWorkforceSummary, getCompanyCostSummary,
  logger, now = () => new Date(),
}) {
  function entityOrThrow(entityKey) {
    const entity = ENTITY_LIST.find((e) => e.key === entityKey);
    if (!entity) throw new ValidationError(`Unknown entity "${entityKey}".`);
    return entity;
  }

  /* Runs one source's overlay; on failure the block stays sample. */
  function overlay(source, fn, sources) {
    try {
      fn();
      return true;
    } catch (error) {
      logger.error('Control Room: live read failed — block stays on sample data', { source, error: error.message });
      sources[source] = 'error';
      return false;
    }
  }

  /* `at` is short for the top-bar chip: the time for a sync earlier today,
     the date otherwise. */
  function syncLines(todayIso) {
    const odoo = financeMetricsService.getSyncStatus();
    const last = odoo.lastSuccessAt ? new Date(odoo.lastSuccessAt) : null;
    let at = null;
    if (last) at = CAIRO_DATE.format(last) === todayIso ? CAIRO_TIME.format(last) : CAIRO_DAY_MONTH.format(last);
    return [
      { source: 'Odoo', status: odoo.status, at },
      // Commercial Lead's cache is pushed by ClickUp webhooks plus a
      // reconciliation job; it has no single "last synced" stamp to show.
      { source: 'ClickUp', status: 'ok', at: null, note: 'webhooks' },
    ];
  }

  function getControlRoom(entityKey) {
    const entity = entityOrThrow(entityKey);
    const today = now();
    const todayIso = CAIRO_DATE.format(today);
    const D = structuredClone(sampleRepository.getSample());
    const sources = { finance: 'sample', pnl: 'sample', balance: 'sample', payables: 'sample', sales: 'sample', pipeline: 'sample', people: 'sample', costs: 'sample' };

    D.asOf = todayIso;
    D.asOfLabel = CAIRO_LONG_DATE.format(today);
    D.entity = entity;
    D.entityList = ENTITY_LIST;
    D.currency = entity.currency;

    overlay('budget', () => applyBudgets(D, budgetService.getState()), sources);

    if (financeMetricsService.isFinanceEntity(entity.key)) {
      overlay('finance', () => {
        applyFinance(D, financeMetricsService.getEntityFinance(entity.key), entity);
        sources.finance = 'odoo';
      }, sources);
    } else if (entity.key === 'all') {
      overlay('finance', () => {
        applyConsolidatedRevenue(D, financeMetricsService.getConsolidatedRevenue());
        sources.finance = 'odoo';
      }, sources);
    }
    if (financeMetricsService.isFinanceEntity(entity.key) || entity.key === 'all') {
      overlay('pnl', () => {
        applyPnl(D, financeMetricsService.getProfitAndLoss(entity.key));
        sources.pnl = 'odoo';
      }, sources);
      if (entity.key !== 'all') {
        overlay('balance', () => {
          applyBalance(D, financeMetricsService.getBalanceSheet(entity.key));
          sources.balance = 'odoo';
        }, sources);
        overlay('years', () => {
          applyYears(D, financeMetricsService.getYearHistory(entity.key));
          sources.years = 'odoo';
        }, sources);
        overlay('payables', () => {
          // Bills whose vendor is the company itself are flagged on the page.
          D.payablesLive = { ...financeMetricsService.getPayables(entity.key), companyName: entity.name };
          sources.payables = 'odoo';
        }, sources);
      }
      overlay('sales', () => {
        applySales(D, financeMetricsService.getSalesSummary(entity.key));
        sources.sales = 'odoo';
      }, sources);
    }
    overlay('pipeline', () => {
      applyPipeline(D, getPipelineSummary());
      sources.pipeline = 'clickup';
    }, sources);
    overlay('people', () => {
      applyPeople(D, getWorkforceSummary({ today: todayIso }));
      sources.people = 'portal';
    }, sources);
    if (entity.key === 'ceas') {
      overlay('costs', () => {
        D.costs = getCompanyCostSummary();
        sources.costs = 'planner';
      }, sources);
    }
    overlay('targets', () => applyTargets(D, targetService.getState(entity.key)), sources);
    // Saved escalation preferences (company-wide); the page copies them into its state.
    overlay('escalation', () => { D.prefs = escalationService.getPrefs(); }, sources);

    // A view without an Odoo year history never shows the sample's invented years.
    if (!D.yearsLive) currentYearOnly(D, todayIso);

    // The sample's own sync lines are invented times — never shown.
    D.sync = [];
    overlay('sync', () => { D.sync = syncLines(todayIso); }, sources);

    D.sources = sources;
    return D;
  }

  /* The Budget tab alone — for operations and people_culture, who may see
     nothing else on this page. Only the blocks the Budget tab renders are
     copied out, so revenue, clients, cash, people and payroll-by-person
     never leave the server for these roles. net_profit is the one KPI
     the tab shows. */
  function getBudget() {
    const today = now();
    const sample = sampleRepository.getSample();
    const netProfit = sample.kpis.find((k) => k.id === 'net_profit');
    const D = structuredClone({
      scope: 'budget',
      asOf: CAIRO_DATE.format(today),
      asOfLabel: CAIRO_LONG_DATE.format(today),
      currency: 'EGP',
      months2: sample.months2,
      elapsed: sample.elapsed,
      penalty: sample.penalty,
      budget: sample.budget,
      fnBudget: sample.fnBudget,
      functions: sample.functions,
      projects: { value: sample.projects.value, margin: sample.projects.margin },
      pnl: { netProfit: sample.pnl.netProfit },
      revenue: { ytd: sample.revenue.ytd, ytdTarget: sample.revenue.ytdTarget },
      kpis: [netProfit],
      series: {},
      yearMap: {},
      years: {},
      records: {},
      risks: [],
      decisions: [],
      components: [],
      sources: {},
      sync: [],
    });
    try {
      applyBudgets(D, budgetService.getState());
    } catch (error) {
      // Same rule as the Control Room's overlays: show the workbook figures rather than fail.
      logger.error('Budget tab: saved budgets unreadable — showing the workbook figures', { error: error.message });
    }
    return D;
  }

  return { getControlRoom, getBudget };
}

module.exports = createControlRoomService;
