/* Odoo receivables, collections and invoiced revenue (finance's
   getEntityFinance / getConsolidatedRevenue) laid over the Control Room
   payload. Pure: each function only edits the payload it is given. */
const LIVE_FINANCE_KPIS = ['revenue_total', 'dso', 'overdue_60_share', 'collection_rate'];

const pctText = (part, whole) => (whole > 0 ? `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%` : '—');

const PER_COMPANY_KPIS = ['dso', 'overdue_60_share', 'collection_rate'];

/* "All companies": revenue only, from Odoo's Invoices Analysis already
   converted into EGP by Odoo (finance getConsolidatedRevenue). Receivables,
   DSO and collections exist per company only, so they are blanked and
   labelled per company — never left on the sample's figures. */
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

  const why = 'Shown per company only: pick Ceas Comm, FZE or LWM. Odoo gives receivables per company, and the portal doesn\'t add currencies together itself.';
  for (const id of PER_COMPANY_KPIS) {
    Object.assign(D.kpis.find((k) => k.id === id), {
      live: false, perCompany: why, actual: null, tolerance: null, drill: null, source: 'Per company', formula: why,
    });
    delete D.series[id];
    delete D.yearMap[id];
  }
  delete D.records.receivables;
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

module.exports = { LIVE_FINANCE_KPIS, applyConsolidatedRevenue, applyFinance };
