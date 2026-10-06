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
  };
  Object.assign(D.kpis.find((k) => k.id === 'revenue_total'), {
    live: true,
    currency: f.currency,
    source: 'Odoo',
    tolerance: null,
    name: 'Revenue',
    actual: rev.ytd,
    target: null,
    query: 'Odoo Invoices Analysis, all three companies, converted into EGP by Odoo — Odoo Dashboards → Finance → Invoicing → "Invoiced" with every company selected (Period: this year)',
    formula: 'Year to date, invoice basis. The conversion is Odoo\'s own, at its current rates; Odoo\'s Profit and Loss converts at the year\'s average rate instead, so its Revenue line differs.',
  });
  delete D.series.revenue_total;
  delete D.yearMap.revenue_total;
  // The sample drill records describe invented clients — not under a live figure.
  delete D.records.revenue;
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
  sampleRepository, financeMetricsService, getPipelineSummary, getWorkforceSummary, getCompanyCostSummary,
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
    const sources = { finance: 'sample', pipeline: 'sample', people: 'sample', costs: 'sample' };

    D.asOf = todayIso;
    D.asOfLabel = CAIRO_LONG_DATE.format(today);
    D.entity = entity;
    D.entityList = ENTITY_LIST;
    D.currency = entity.currency;

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
    return structuredClone({
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
  }

  return { getControlRoom, getBudget };
}

module.exports = createControlRoomService;
