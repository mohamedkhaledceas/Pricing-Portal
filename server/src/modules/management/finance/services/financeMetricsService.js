/* Revenue + Collections figures for one entity, computed from the Odoo
   cache tables (docs/adr/0013 §10). This is finance's public read
   interface — the CEO dashboard calls it, never the repositories.

   Definitions (ADR-0013, "Definitions"):
   - Revenue: posted customer invoices minus credit notes, by invoice date,
     untaxed (VAT excluded, media pass-through included), company currency.
   - Collection rate: cash collected in the period ÷ amount billed in the
     period × 100. Both sides include VAT — cash received does, so billing
     has to as well or the rate is understated by the VAT share.
   - Aging: by due date (most invoices have no payment term, so the share
     without one is reported alongside).
   - DSO: open receivables ÷ the last 90 days' billing × 90.

   Customers are grouped by portal client when a person has linked the
   Odoo customer to one (docs/adr/0013 §8) — so duplicate Odoo records for
   the same client add up, and concentration isn't understated — and by
   the Odoo customer itself otherwise. Links are read on every call, so a
   change on the client-mapping page shows here immediately.

   All dates are calendar dates in Africa/Cairo, as YYYY-MM-DD strings —
   the same form Odoo stores invoice_date / payment date in. */
const { ValidationError } = require('../../../../common/errors');
const {
  ENTITIES, CONSOLIDATION_CURRENCY, COLLECTED_PAYMENT_STATES, FINANCE_THRESHOLDS,
} = require('../constants');

const TOP_CLIENTS = 10;
const LARGEST_INVOICES = 10;
const TRAILING_DAYS = 90;
const AGING_BUCKETS = [
  { name: 'Not yet due', maxDays: 0 },
  { name: '1–30 days', maxDays: 30 },
  { name: '31–60 days', maxDays: 60 },
  { name: '61–90 days', maxDays: 90 },
  { name: '90+ days', maxDays: Infinity },
];


const { MONTH_LABELS, cairoToday, addDays, daysBetween, round, pct } = require('./metricsShared');
const createStatementsMetrics = require('./statementsMetrics');
const createSalesMetrics = require('./salesMetrics');

function createFinanceMetricsService({
  invoiceRepository, invoiceReportRepository, pnlRepository, saleReportRepository, balanceRepository, payablesRepository,
  paymentRepository, syncStateRepository, linkRepository, cashAccountTypes, today = cairoToday,
}) {
  /* partnerId -> { key, clientId, name } for this call. */
  function buildCustomerResolver() {
    const linked = new Map(linkRepository.listLinkedWithClientNames().map((l) => [l.odooPartnerId, l]));
    return (partnerId, partnerName) => {
      const link = linked.get(partnerId);
      return link
        ? { key: `client:${link.clientId}`, clientId: link.clientId, name: link.clientName }
        : { key: `partner:${partnerId}`, clientId: null, name: partnerName };
    };
  }

  function entityOrThrow(entityKey) {
    const entity = ENTITIES[entityKey];
    if (!entity) throw new ValidationError(`Unknown finance entity "${entityKey}".`);
    return entity;
  }
  const statements = createStatementsMetrics({
    pnlRepository, balanceRepository, invoiceRepository, cashAccountTypes, entityOrThrow, today,
  });
  const sales = createSalesMetrics({
    saleReportRepository, invoiceRepository, payablesRepository, entityOrThrow, buildCustomerResolver, today,
  });


  function buildRevenue(companyId, asOf, overdueByKey, resolve) {
    const year = asOf.slice(0, 4);
    const monthIndex = Number(asOf.slice(5, 7)) - 1;
    const byMonth = new Map(
      invoiceRepository.sumUntaxedByMonth(companyId, `${year}-01-01`, asOf).map((m) => [m.month, m.total]),
    );
    const months = MONTH_LABELS.slice(0, monthIndex + 1);
    const actual = months.map((_, i) => round(byMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`) || 0));
    const ytd = round(actual.reduce((sum, v) => sum + v, 0));

    // Same year-to-date basis as the Odoo Invoicing dashboard's cards.
    const yearStart = `${year}-01-01`;
    const documentCount = invoiceRepository.countPosted(companyId, yearStart, asOf);
    const largestInvoices = invoiceRepository.listLargestInvoices(companyId, yearStart, asOf, LARGEST_INVOICES).map((i) => {
      const who = resolve(i.partnerId, i.partnerName);
      return {
        name: i.name,
        customer: who.name,
        customerKey: who.key,
        invoiceDate: i.invoiceDate,
        untaxed: round(i.untaxed),
        paymentState: i.paymentState,
        salesperson: i.salespersonName,
      };
    });
    const bySalesperson = invoiceRepository.sumUntaxedBySalesperson(companyId, yearStart, asOf).map((s) => ({
      name: s.salespersonName,
      value: round(s.total),
      invoices: s.invoices,
    }));

    const trailingFrom = addDays(asOf, -(TRAILING_DAYS - 1));
    const byCustomer = new Map();
    for (const p of invoiceRepository.sumUntaxedByPartner(companyId, trailingFrom, asOf)) {
      const who = resolve(p.partnerId, p.partnerName);
      const c = byCustomer.get(who.key) || { ...who, partnerIds: [], total: 0, am: null, amShare: -Infinity };
      c.partnerIds.push(p.partnerId);
      c.total += p.total;
      // Salesperson of the Odoo record contributing most to this customer.
      if (p.total > c.amShare) { c.am = p.salespersonName; c.amShare = p.total; }
      byCustomer.set(who.key, c);
    }
    const customers = [...byCustomer.values()].sort((a, b) => b.total - a.total);
    const trailing90 = round(customers.reduce((sum, c) => sum + c.total, 0));
    const toClient = (c) => ({
      key: c.key,
      clientId: c.clientId,
      linked: c.clientId !== null,
      name: c.name,
      value: round(c.total),
      am: c.am,
      overdue: round(overdueByKey.get(c.key) || 0),
    });
    const clients = customers.slice(0, TOP_CLIENTS).map(toClient);
    const rest = customers.slice(TOP_CLIENTS);
    if (rest.length) {
      clients.push({
        key: null,
        clientId: null,
        linked: false,
        name: `Other (${rest.length} ${rest.length === 1 ? 'client' : 'clients'})`,
        value: round(rest.reduce((sum, c) => sum + c.total, 0)),
        am: null,
        overdue: round(rest.reduce((sum, c) => sum + (overdueByKey.get(c.key) || 0), 0)),
      });
    }
    const top = customers[0] || null;

    return {
      ytd,
      documentCount,
      averageInvoice: documentCount ? round(ytd / documentCount) : null,
      largestInvoices,
      bySalesperson,
      mtd: actual[monthIndex],
      monthDay: Number(asOf.slice(8, 10)),
      months,
      actual,
      trailing90,
      clients,
      topClient: top ? top.name : null,
      concentration: top && trailing90 > 0 ? pct(top.total, trailing90) : null,
      concentrationThreshold: FINANCE_THRESHOLDS.concentrationPct,
    };
  }

  function buildCollections(companyId, asOf, openInvoices, resolve) {
    const aging = AGING_BUCKETS.map((b) => ({ name: b.name, value: 0 }));
    const overdueByKey = new Map();
    const detailByKey = new Map();
    let receivables = 0;
    let past60 = 0;
    let withoutTerms = 0;

    for (const inv of openInvoices) {
      receivables += inv.residual;
      if (inv.invoiceDateDue === inv.invoiceDate) withoutTerms += 1;
      const daysPastDue = inv.invoiceDateDue ? daysBetween(inv.invoiceDateDue, asOf) : 0;
      aging[AGING_BUCKETS.findIndex((b) => daysPastDue <= b.maxDays)].value += inv.residual;
      if (daysPastDue > FINANCE_THRESHOLDS.agedWatchDays) past60 += inv.residual;
      if (daysPastDue > 0) {
        const who = resolve(inv.partnerId, inv.partnerName);
        overdueByKey.set(who.key, (overdueByKey.get(who.key) || 0) + inv.residual);
        const d = detailByKey.get(who.key) || {
          key: who.key, clientId: who.clientId, linked: who.clientId !== null, name: who.name,
          value: 0, days: 0, invoices: 0, am: inv.salespersonName,
        };
        d.value += inv.residual;
        d.days = Math.max(d.days, daysPastDue);
        d.invoices += 1;
        detailByKey.set(who.key, d);
      }
    }

    const monthStart = `${asOf.slice(0, 7)}-01`;
    const billedMtd = invoiceRepository.sumTotalSigned(companyId, monthStart, asOf);
    const collectedMtd = paymentRepository.sumCustomerCash(companyId, COLLECTED_PAYMENT_STATES, monthStart, asOf);
    const billed90 = invoiceRepository.sumTotalSigned(companyId, addDays(asOf, -(TRAILING_DAYS - 1)), asOf);

    const detail = [...detailByKey.values()]
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((d) => ({ ...d, value: round(d.value) }));

    return {
      collections: {
        receivables: round(receivables),
        openInvoices: openInvoices.length,
        aging: aging.map((a) => ({ ...a, value: round(a.value) })),
        // From the aging buckets, not `detail`: detail drops customers whose
        // credit notes leave them net negative, which would overstate this.
        overdue: round(aging.slice(1).reduce((sum, a) => sum + a.value, 0)),
        overdue60plus: round(past60),
        overdue60pct: pct(past60, receivables),
        withoutTermsPct: pct(withoutTerms, openInvoices.length),
        dso: billed90 > 0 ? Math.round((receivables / billed90) * TRAILING_DAYS) : null,
        dsoTarget: FINANCE_THRESHOLDS.dsoTargetDays,
        billedMtd: round(billedMtd),
        collectedMtd: round(collectedMtd),
        collectionRate: pct(collectedMtd, billedMtd),
        collectionRateTarget: FINANCE_THRESHOLDS.collectionRateTargetPct,
        agedRiskDays: FINANCE_THRESHOLDS.agedRiskDays,
        detail,
      },
      overdueByKey,
    };
  }

  function getEntityFinance(entityKey) {
    const { companyId, currency } = entityOrThrow(entityKey);
    const asOf = today();
    const resolve = buildCustomerResolver();
    const { collections, overdueByKey } = buildCollections(companyId, asOf, invoiceRepository.listOpen(companyId), resolve);
    return { asOf, currency, revenue: buildRevenue(companyId, asOf, overdueByKey, resolve), collections };
  }

  /* "All companies" revenue, year to date: Odoo's own Invoices Analysis
     lines, converted into EGP by Odoo (migration 035) — the same figures
     as Odoo's Invoicing dashboard with all three companies selected. Only
     revenue: receivables, DSO and collections stay per company. */
  function getConsolidatedRevenue() {
    const asOf = today();
    const year = asOf.slice(0, 4);
    const yearStart = `${year}-01-01`;
    const monthIndex = Number(asOf.slice(5, 7)) - 1;
    const byMonth = new Map(invoiceReportRepository.sumByMonth(yearStart, asOf).map((m) => [m.month, m.total]));
    const months = MONTH_LABELS.slice(0, monthIndex + 1);
    const actual = months.map((_, i) => round(byMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`) || 0));
    const ytd = round(actual.reduce((sum, v) => sum + v, 0));
    const documentCount = invoiceReportRepository.countDocuments(yearStart, asOf);
    const resolve = buildCustomerResolver();
    const companyById = new Map(Object.entries(ENTITIES).map(([key, e]) => [e.companyId, key]));
    return {
      asOf,
      currency: CONSOLIDATION_CURRENCY,
      revenue: {
        months,
        actual,
        ytd,
        monthDay: Number(asOf.slice(8, 10)),
        documentCount,
        averageInvoice: documentCount ? round(ytd / documentCount) : null,
        largestInvoices: invoiceReportRepository.listLargestInvoices(yearStart, asOf, LARGEST_INVOICES).map((i) => {
          const who = resolve(i.partnerId, i.partnerName);
          return {
            name: i.name,
            company: companyById.get(i.companyId) || null,
            customer: who.name,
            customerKey: who.key,
            invoiceDate: i.invoiceDate,
            untaxed: round(i.untaxed),
            paymentState: i.paymentState,
            salesperson: i.salespersonName,
          };
        }),
        bySalesperson: invoiceReportRepository.sumBySalesperson(yearStart, asOf).map((s) => ({
          name: s.salespersonName, value: round(s.total), invoices: s.invoices,
        })),
      },
      pnl: statements.getConsolidatedPnlRevenue(year),
    };
  }

  /* One status for Odoo as a whole: ok only when every synced model's last
     run succeeded; "as of" is the older of the models' last successes. The
     error text stays in the server log, not the response. */
  function getSyncStatus() {
    const states = syncStateRepository.listAll();
    if (!states.length) return { status: 'never', lastSuccessAt: null };
    const failed = states.some((s) => s.lastStatus === 'error');
    const successes = states.map((s) => s.lastSuccessAt).filter(Boolean).sort();
    return {
      status: failed ? 'error' : 'ok',
      lastSuccessAt: successes.length === states.length ? successes[0] : null,
    };
  }

  return {
    getEntityFinance,
    getConsolidatedRevenue,
    getSyncStatus,
    isFinanceEntity: (key) => Boolean(ENTITIES[key]),
    ...statements,
    ...sales,
  };
}

module.exports = createFinanceMetricsService;
