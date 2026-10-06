/* Odoo sales orders (Sales Analysis) laid over the Control Room payload. Pure. */
const COMPANY_SHORT = { ceas: 'Ceas Comm', fze: 'FZE', lwm: 'LWM' };

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

module.exports = { applySales };
