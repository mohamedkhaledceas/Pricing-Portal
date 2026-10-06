/* Odoo sales orders (Sales Analysis) and what each company owes (vendor
   bills, staff expenses) for the Control Room. Composed into
   financeMetricsService, finance's public read interface. */
const { ENTITIES, CONSOLIDATION_CURRENCY } = require('../constants');
const { invoicesOpen } = require('./reportMath');
const { MONTH_LABELS, round } = require('./metricsShared');

function createSalesMetrics({
  saleReportRepository, invoiceRepository, payablesRepository, entityOrThrow, buildCustomerResolver, today,
}) {
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

  /* What one company owes: open vendor bills (overdue = past their due
     date), this year's biggest suppliers, and employee expenses in the
     buckets Odoo's Dashboards → Finance → Expenses shows — to report
     (draft), to validate (submitted for approval; "reported" in older
     Odoo) and to reimburse (approved). Per company, own currency. */
  function getPayables(entityKey) {
    const { companyId, currency } = entityOrThrow(entityKey);
    const asOf = today();
    const yearStart = `${asOf.slice(0, 4)}-01-01`;
    const r = (n) => Math.round(n);

    const open = invoicesOpen(payablesRepository.listOpenBills(companyId), asOf);
    const billed = payablesRepository.sumBilled(companyId, yearStart, asOf);
    const byState = new Map(payablesRepository.summarizeExpenses(companyId).map((s) => [s.state, s]));
    const bucket = (states) => states.reduce((acc, st) => {
      const s = byState.get(st);
      return s ? { count: acc.count + s.count, total: acc.total + s.total } : acc;
    }, { count: 0, total: 0 });
    const toReport = bucket(['draft']);
    const toValidate = bucket(['reported', 'submitted']);
    const toReimburse = bucket(['approved']);

    return {
      asOf,
      currency,
      bills: {
        open: open.rows.map((b) => ({ ...b, residual: r(b.residual) })),
        openTotal: r(open.total),
        overdueTotal: r(open.overdue),
        overdueCount: open.overdueCount,
        billedThisYear: r(billed.total),
        topSuppliers: payablesRepository.sumBilledByVendor(companyId, yearStart, asOf, 6)
          .map((s) => ({ name: s.partnerName, value: r(s.total), bills: s.bills })),
      },
      expenses: {
        toReport: { count: toReport.count, total: r(toReport.total) },
        toValidate: { count: toValidate.count, total: r(toValidate.total) },
        toReimburse: { count: toReimburse.count, total: r(toReimburse.total) },
        pending: payablesRepository.listExpenses(companyId, ['approved', 'reported', 'submitted', 'draft'], 5)
          .map((e) => ({ ...e, total: r(e.total) })),
      },
    };
  }

  return { getSalesSummary, getPayables };
}

module.exports = createSalesMetrics;
