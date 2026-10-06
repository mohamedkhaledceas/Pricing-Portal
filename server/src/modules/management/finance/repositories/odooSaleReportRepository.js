/* odoo_sale_report_lines — Odoo's Sales Analysis lines (migration 037).
   Only SQL here. Every read takes companyId: a number reads that company's
   own-currency amounts, null reads all companies in Odoo's EGP
   conversion. The column names below are chosen from fixed pairs, never
   from input. */
const db = require('../../../../db');

const COLUMNS = [
  'odoo_id', 'order_id', 'order_name', 'company_id', 'order_date', 'state', 'partner_id', 'partner_name',
  'salesperson_name', 'product_name', 'category_name', 'quantity', 'subtotal_company', 'to_invoice_company',
  'subtotal_consolidated', 'to_invoice_consolidated', 'synced_at',
];

const insertStatement = db.prepare(`
  INSERT INTO odoo_sale_report_lines (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
`);

const QUOTATION_STATES = "('draft', 'sent')";

// [amount column, to-invoice column, WHERE clause, params] for one scope.
function scope(companyId) {
  return companyId == null
    ? { amount: 'subtotal_consolidated', toInvoice: 'to_invoice_consolidated', where: '1 = 1', params: [] }
    : { amount: 'subtotal_company', toInvoice: 'to_invoice_company', where: 'company_id = ?', params: [companyId] };
}

// Called inside the sync's transaction; the table is replaced every run.
function replaceAll(rows) {
  db.prepare('DELETE FROM odoo_sale_report_lines').run();
  for (const row of rows) insertStatement.run(row);
}

function countAll() {
  return db.prepare('SELECT COUNT(*) AS n FROM odoo_sale_report_lines').get().n;
}

// Orders and value per state, by order date — Odoo's Sales dashboard cards.
function summarizeByState(companyId, fromDate, toDate) {
  const s = scope(companyId);
  return db.prepare(`
    SELECT state, COUNT(DISTINCT order_id) AS orders, SUM(${s.amount}) AS value
    FROM odoo_sale_report_lines
    WHERE ${s.where} AND order_date BETWEEN ? AND ?
    GROUP BY state
  `).all(...s.params, fromDate, toDate);
}

function sumBookedByMonth(companyId, fromDate, toDate) {
  const s = scope(companyId);
  return db.prepare(`
    SELECT substr(order_date, 1, 7) AS month, SUM(${s.amount}) AS total
    FROM odoo_sale_report_lines
    WHERE ${s.where} AND state = 'sale' AND order_date BETWEEN ? AND ?
    GROUP BY month
  `).all(...s.params, fromDate, toDate);
}

// One row per order. states: 'quotation' (draft + sent) or 'sale'.
function listOrders(companyId, kind, fromDate, toDate, orderBy, limit) {
  const s = scope(companyId);
  const stateClause = kind === 'quotation' ? `state IN ${QUOTATION_STATES}` : "state = 'sale'";
  const sort = orderBy === 'toInvoice' ? 'toInvoice' : 'value';
  return db.prepare(`
    SELECT order_id AS orderId, order_name AS name, company_id AS companyId, MIN(order_date) AS orderDate,
           state, partner_id AS partnerId, partner_name AS partnerName, salesperson_name AS salespersonName,
           SUM(${s.amount}) AS value, SUM(${s.toInvoice}) AS toInvoice
    FROM odoo_sale_report_lines
    WHERE ${s.where} AND ${stateClause} AND order_date BETWEEN ? AND ?
    GROUP BY order_id
    HAVING ${sort} > 0
    ORDER BY ${sort} DESC, order_id DESC
    LIMIT ?
  `).all(...s.params, fromDate, toDate, limit);
}

/* Contracted backlog: Odoo's "untaxed amount to invoice" on confirmed
   orders, whatever their date — sold, not yet invoiced. */
function sumBacklog(companyId) {
  const s = scope(companyId);
  return db.prepare(`
    SELECT COALESCE(SUM(${s.toInvoice}), 0) AS total, COUNT(DISTINCT CASE WHEN ${s.toInvoice} > 0 THEN order_id END) AS orders
    FROM odoo_sale_report_lines
    WHERE ${s.where} AND state = 'sale'
  `).get(...s.params);
}

// Odoo's Product dashboard: confirmed sales by product.
function sumByProduct(companyId, fromDate, toDate, limit) {
  const s = scope(companyId);
  return db.prepare(`
    SELECT product_name AS productName, SUM(${s.amount}) AS value, SUM(quantity) AS quantity,
           COUNT(DISTINCT order_id) AS orders
    FROM odoo_sale_report_lines
    WHERE ${s.where} AND state = 'sale' AND order_date BETWEEN ? AND ?
    GROUP BY product_name
    ORDER BY value DESC
    LIMIT ?
  `).all(...s.params, fromDate, toDate, limit);
}

function listPartnerIds() {
  return db.prepare('SELECT DISTINCT partner_id FROM odoo_sale_report_lines WHERE partner_id IS NOT NULL').all()
    .map((r) => r.partner_id);
}

/* One customer's quotations and orders (not cancelled), newest first, in
   each company's own currency — for the client drawer. */
function listOrdersByPartners(partnerIds) {
  if (!partnerIds.length) return [];
  return db.prepare(`
    SELECT order_id AS orderId, order_name AS name, company_id AS companyId, MIN(order_date) AS orderDate, state,
           salesperson_name AS salespersonName, SUM(subtotal_company) AS value, SUM(to_invoice_company) AS toInvoice
    FROM odoo_sale_report_lines
    WHERE state != 'cancel' AND partner_id IN (${partnerIds.map(() => '?').join(', ')})
    GROUP BY order_id
    ORDER BY orderDate DESC, order_id DESC
  `).all(...partnerIds);
}

module.exports = {
  replaceAll, countAll, summarizeByState, sumBookedByMonth, listOrders, sumBacklog, sumByProduct,
  listPartnerIds, listOrdersByPartners,
};
