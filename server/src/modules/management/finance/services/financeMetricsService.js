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

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

function cairoToday() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toUtc = (date) => Date.parse(`${date}T00:00:00Z`);
const addDays = (date, days) => new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
const round = (value) => Math.round(value);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/* Odoo's multi-company Profit and Loss converts each company's figures at
   the average of Odoo's daily rate over the report period: every day
   counts once, a day takes the latest rate dated on or before it (so
   future days carry today's), and days before the first stored rate count
   as 1 — Odoo has no AED rate before 2026-02-01, so January counts AED as
   EGP. Reproduced to the piastre against Odoo's own report on 2026-10-06
   (12.794048 for 2026); never a rate the portal chose. */
function periodAverageRate(rates, fromDate, toDate) {
  let sum = 0;
  let days = 0;
  let idx = -1;
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    while (idx + 1 < rates.length && rates[idx + 1].date <= d) idx += 1;
    sum += idx >= 0 ? rates[idx].inverseRate : 1;
    days += 1;
  }
  return days ? sum / days : 1;
}

/* Odoo's Profit and Loss lines (account.report 7) from account-type
   balances (debit − credit, so income is negative). */
function toPnlLines(b) {
  const v = (type) => b[type] || 0;
  const revenue = -v('income');
  const costOfRevenue = v('expense_direct_cost');
  const operatingExpenses = v('expense');
  const otherIncome = -v('income_other');
  const otherExpenses = v('expense_depreciation') + v('expense_other');
  const allocations = v('equity_unaffected');
  const grossProfit = revenue - costOfRevenue;
  const operatingIncome = grossProfit - operatingExpenses;
  const netProfit = operatingIncome + otherIncome - otherExpenses;
  const r = (n) => Math.round(n);
  return {
    revenue: r(revenue),
    costOfRevenue: r(costOfRevenue),
    grossProfit: r(grossProfit),
    operatingExpenses: r(operatingExpenses),
    operatingIncome: r(operatingIncome),
    otherIncome: r(otherIncome),
    otherExpenses: r(otherExpenses),
    netProfit: r(netProfit),
    allocations: r(allocations),
    netProfitAfterAllocations: r(netProfit - allocations),
  };
}

function createFinanceMetricsService({
  invoiceRepository, invoiceReportRepository, pnlRepository, saleReportRepository, balanceRepository, paymentRepository,
  syncStateRepository, linkRepository, cashAccountTypes, today = cairoToday,
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
      pnl: getConsolidatedPnlRevenue(year),
    };
  }

  /* The Revenue line of Odoo's Profit and Loss for all companies, for the
     whole calendar year (Odoo's "2026" filter): −(income balance) per
     company in its own currency, then other currencies converted the way
     Odoo's report does (periodAverageRate). Differs from the invoiced
     figure twice over: a different conversion, and income posted outside
     invoices counts here. */
  function getConsolidatedPnlRevenue(year) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const byCompany = new Map();
    for (const row of pnlRepository.sumByCompanyAndType(from, to)) {
      if (row.accountType === 'income') byCompany.set(row.companyId, -row.balance);
    }
    const rateCache = new Map();
    let total = 0;
    const rates = {};
    for (const entity of Object.values(ENTITIES)) {
      const own = byCompany.get(entity.companyId) || 0;
      if (entity.currency === CONSOLIDATION_CURRENCY) { total += own; continue; }
      if (!rateCache.has(entity.currency)) {
        rateCache.set(entity.currency, periodAverageRate(pnlRepository.listRates(entity.currency), from, to));
      }
      rates[entity.currency] = rateCache.get(entity.currency);
      total += own * rates[entity.currency];
    }
    return { year, revenue: round(total), rates };
  }

  /* Sales orders, year to date by order date — the same definitions as
     Odoo's Dashboards → Sales → Sales and → Product with Period = this
     year. entityKey 'all' reads Odoo's own EGP conversion. "Booked" is
     Odoo's "Revenue" card on that dashboard (confirmed orders, untaxed);
     named booked here so it is never mistaken for revenue, which is the
     invoiced figure. Backlog is not year-limited: every confirmed order's
     untaxed amount still to invoice. */
  function getSalesSummary(entityKey) {
    const consolidated = entityKey === 'all';
    const { companyId, currency } = consolidated
      ? { companyId: null, currency: CONSOLIDATION_CURRENCY }
      : entityOrThrow(entityKey);
    const asOf = today();
    const year = asOf.slice(0, 4);
    const yearStart = `${year}-01-01`;
    const monthIndex = Number(asOf.slice(5, 7)) - 1;
    const resolve = buildCustomerResolver();
    const companyKey = new Map(Object.entries(ENTITIES).map(([key, e]) => [e.companyId, key]));
    const toOrder = (o) => {
      const who = resolve(o.partnerId, o.partnerName);
      return {
        name: o.name,
        company: companyKey.get(o.companyId) || null,
        customer: who.name,
        customerKey: who.key,
        orderDate: o.orderDate,
        state: o.state,
        salesperson: o.salespersonName,
        value: round(o.value),
        toInvoice: round(o.toInvoice),
      };
    };

    const byState = new Map(saleReportRepository.summarizeByState(companyId, yearStart, asOf).map((r) => [r.state, r]));
    const get = (state) => byState.get(state) || { orders: 0, value: 0 };
    const quotationCount = get('draft').orders + get('sent').orders;
    const booked = get('sale');
    const byMonth = new Map(saleReportRepository.sumBookedByMonth(companyId, yearStart, asOf).map((m) => [m.month, m.total]));
    const months = MONTH_LABELS.slice(0, monthIndex + 1);
    const backlog = saleReportRepository.sumBacklog(companyId);
    const links = invoiceRepository.countSalesOrderLinks(companyId, yearStart, asOf);

    return {
      asOf,
      currency,
      consolidated,
      months,
      quotations: {
        count: quotationCount,
        drafts: get('draft').orders,
        sent: get('sent').orders,
        value: round(get('draft').value + get('sent').value),
        top: saleReportRepository.listOrders(companyId, 'quotation', yearStart, asOf, 'value', 10).map(toOrder),
      },
      booked: {
        orders: booked.orders,
        value: round(booked.value),
        averageOrder: booked.orders ? round(booked.value / booked.orders) : null,
        byMonth: months.map((_, i) => round(byMonth.get(`${year}-${String(i + 1).padStart(2, '0')}`) || 0)),
        top: saleReportRepository.listOrders(companyId, 'sale', yearStart, asOf, 'value', 20).map(toOrder),
      },
      backlog: {
        value: round(backlog.total),
        orders: backlog.orders,
        // Odoo only reduces "to invoice" through invoices made from the
        // order — invoices without one leave their orders counted here.
        invoicesThisYear: links.invoices,
        invoicesWithoutOrder: links.withoutOrder || 0,
        top: saleReportRepository.listOrders(companyId, 'sale', '0000-01-01', '9999-12-31', 'toInvoice', 20).map(toOrder),
      },
      products: saleReportRepository.sumByProduct(companyId, yearStart, asOf, 10).map((p) => ({
        name: p.productName, value: round(p.value), quantity: p.quantity, orders: p.orders,
      })),
    };
  }

  /* Odoo's Profit and Loss, the way Accounting → Reporting → Profit and
     Loss shows it for the calendar year (everything posted to date).
     One company: its own currency, with the same period last year (1 Jan
     to the same day) beside it. All: each company converted the way
     Odoo's multi-company report does (periodAverageRate over the year);
     no prior year, because Odoo holds no AED rate before 2026-02-01 and
     would count every 2025 AED as 1 EGP. Months under All use the year's
     rate, so they add up to the year. */
  function getProfitAndLoss(entityKey) {
    const consolidated = entityKey === 'all';
    const asOf = today();
    const year = Number(asOf.slice(0, 4));
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const companies = consolidated
      ? Object.values(ENTITIES)
      : [entityOrThrow(entityKey)];
    const rates = {};
    const factor = new Map();
    for (const e of companies) {
      if (!consolidated || e.currency === CONSOLIDATION_CURRENCY) { factor.set(e.companyId, 1); continue; }
      if (rates[e.currency] == null) rates[e.currency] = periodAverageRate(pnlRepository.listRates(e.currency), from, to);
      factor.set(e.companyId, rates[e.currency]);
    }
    const collect = (rows) => {
      const b = {};
      for (const row of rows) {
        const f = factor.get(row.companyId);
        if (f == null) continue;
        b[row.accountType] = (b[row.accountType] || 0) + row.balance * f;
      }
      return b;
    };

    const current = toPnlLines(collect(pnlRepository.sumByCompanyAndType(from, to)));
    const priorTo = `${year - 1}${asOf.slice(4)}`;
    const prior = consolidated ? null : toPnlLines(collect(pnlRepository.sumByCompanyAndType(`${year - 1}-01-01`, priorTo)));

    const monthly = new Map();
    for (const row of pnlRepository.sumByCompanyTypeAndMonth(from, asOf)) {
      const f = factor.get(row.companyId);
      if (f == null) continue;
      const m = monthly.get(row.month) || {};
      m[row.accountType] = (m[row.accountType] || 0) + row.balance * f;
      monthly.set(row.month, m);
    }
    const monthIndex = Number(asOf.slice(5, 7)) - 1;
    const months = MONTH_LABELS.slice(0, monthIndex + 1).map((label, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { month: label, ...toPnlLines(monthly.get(key) || {}) };
    });

    return {
      asOf,
      year,
      priorTo,
      currency: consolidated ? CONSOLIDATION_CURRENCY : companies[0].currency,
      consolidated,
      rates,
      current,
      prior,
      months,
    };
  }

  /* One company's balance sheet as at today, line for line as Odoo's
     Accounting → Reporting → Balance Sheet (account.report 4) builds it,
     plus the Accounting dashboard's Cash block for this year. Per company
     only: how Odoo converts a multi-company balance sheet hasn't been
     verified, and the portal never picks a rate.

     Signs follow the report: assets are debit balances, liabilities and
     equity credit balances shown positive. Equity's unallocated earnings
     are every P&L line since the books began (current year shown apart),
     so the sheet balances by construction of double entry — `balances`
     reports whether it does, as a check on the data. */
  function getBalanceSheet(entityKey) {
    const { companyId, currency } = entityOrThrow(entityKey);
    const asOf = today();
    const year = asOf.slice(0, 4);
    const fyStart = `${year}-01-01`;
    const BEGIN = '0000-01-01';

    const bs = {};
    for (const r of balanceRepository.sumByType(companyId, BEGIN, asOf)) {
      const key = r.nonTrade ? `${r.accountType}:non_trade` : r.accountType;
      bs[key] = (bs[key] || 0) + r.balance;
    }
    const b = (key) => bs[key] || 0;
    const pnlAll = Object.fromEntries(pnlRepository.sumByTypeForCompany(companyId, BEGIN, asOf).map((r) => [r.accountType, r.balance]));
    const pnlYear = Object.fromEntries(pnlRepository.sumByTypeForCompany(companyId, fyStart, asOf).map((r) => [r.accountType, r.balance]));
    const equityYear = balanceRepository.sumByType(companyId, fyStart, asOf)
      .filter((r) => r.accountType === 'equity').reduce((s, r) => s + r.balance, 0);
    const pnlTypes = ['income', 'income_other', 'expense_direct_cost', 'expense', 'expense_depreciation', 'expense_other'];
    const sumTypes = (o, types) => types.reduce((s, t) => s + (o[t] || 0), 0);

    const bank = b('asset_cash');
    const receivables = b('asset_receivable');
    const otherCurrentAssets = b('asset_current') + b('asset_receivable:non_trade');
    const prepayments = b('asset_prepayments');
    const currentAssets = bank + receivables + otherCurrentAssets + prepayments;
    const fixedAssets = b('asset_fixed');
    const nonCurrentAssets = b('asset_non_current');
    const assets = currentAssets + fixedAssets + nonCurrentAssets;

    const currentLiabilities = -(b('liability_current') + b('liability_credit_card') + b('liability_payable:non_trade'));
    const payables = -b('liability_payable');
    const nonCurrentLiabilities = -b('liability_non_current');
    const liabilities = currentLiabilities + payables + nonCurrentLiabilities;

    // CURR_YEAR_EARNINGS = net profit this year − allocations this year.
    const currentYearEarnings = -sumTypes(pnlYear, pnlTypes) - (pnlYear.equity_unaffected || 0);
    const allEarnings = -sumTypes(pnlAll, pnlTypes) - (pnlAll.equity_unaffected || 0);
    const previousYearsEarnings = allEarnings - currentYearEarnings;
    const currentRetained = -equityYear;
    const retained = -(b('equity') + b('equity:non_trade'));
    const previousRetained = retained - currentRetained;
    const equity = allEarnings + retained;

    const r = (n) => Math.round(n);
    const cashFlows = balanceRepository.sumCashFlows(companyId, cashAccountTypes, fyStart, asOf);
    const accounts = balanceRepository.listCashAccounts(companyId, cashAccountTypes, asOf)
      .filter((a) => Math.round(a.balance * 100) !== 0)
      .map((a) => ({ code: a.code, name: a.name, type: a.accountType, balance: r(a.balance) }));
    const closing = accounts.reduce((s, a) => s + a.balance, 0);

    // Cash runway: closing balance ÷ average monthly cash spent over the
    // last three full months. The portal's own definition — Odoo has none.
    const [y, m] = asOf.split('-').map(Number);
    const threeMonthsBack = new Date(Date.UTC(y, m - 4, 1)).toISOString().slice(0, 10);
    const lastMonthEnd = addDays(`${asOf.slice(0, 7)}-01`, -1);
    const spent3 = balanceRepository.sumCashFlowsByMonth(companyId, cashAccountTypes, threeMonthsBack, lastMonthEnd)
      .reduce((s, mo) => s + mo.spent, 0);
    const avgSpent = spent3 / 3;

    return {
      asOf,
      currency,
      balanceSheet: {
        bank: r(bank), receivables: r(receivables), otherCurrentAssets: r(otherCurrentAssets), prepayments: r(prepayments),
        currentAssets: r(currentAssets), fixedAssets: r(fixedAssets), nonCurrentAssets: r(nonCurrentAssets), assets: r(assets),
        currentLiabilities: r(currentLiabilities), payables: r(payables), nonCurrentLiabilities: r(nonCurrentLiabilities),
        liabilities: r(liabilities),
        currentYearEarnings: r(currentYearEarnings), previousYearsEarnings: r(previousYearsEarnings),
        currentRetained: r(currentRetained), previousRetained: r(previousRetained), equity: r(equity),
        liabilitiesAndEquity: r(liabilities + equity),
        balances: Math.abs(assets - (liabilities + equity)) < 1,
      },
      cash: {
        received: r(cashFlows.received),
        spent: r(cashFlows.spent),
        surplus: r(cashFlows.received - cashFlows.spent),
        opening: r(closing - (cashFlows.received - cashFlows.spent)),
        closing,
        accounts,
        averageMonthlySpent: r(avgSpent),
        runwayMonths: avgSpent > 0 ? Math.round((closing / avgSpent) * 10) / 10 : null,
      },
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
    getEntityFinance, getConsolidatedRevenue, getSalesSummary, getProfitAndLoss, getBalanceSheet, getSyncStatus, isFinanceEntity: (key) => Boolean(ENTITIES[key]),
  };
}

module.exports = createFinanceMetricsService;
