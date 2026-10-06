/* odoo_invoice_report_lines — Odoo's Invoices Analysis lines with
   price_subtotal already converted by Odoo into EGP (migration 035). Only
   SQL here. The "All companies" revenue reads come from this table; each
   company's own figures come from odoo_invoices instead. */
const db = require('../../../../db');

const COLUMNS = [
  'odoo_id', 'move_id', 'move_name', 'move_type', 'company_id', 'invoice_date', 'partner_id', 'partner_name',
  'salesperson_name', 'product_name', 'category_name', 'price_subtotal_consolidated', 'consolidated_currency',
  'synced_at',
];

const insertStatement = db.prepare(`
  INSERT INTO odoo_invoice_report_lines (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
`);

// Called inside the sync's transaction — the conversion changes with
// Odoo's rates, so every run replaces the table rather than upserting.
function replaceAll(rows) {
  db.prepare('DELETE FROM odoo_invoice_report_lines').run();
  for (const row of rows) insertStatement.run(row);
}

function countAll() {
  return db.prepare('SELECT COUNT(*) AS n FROM odoo_invoice_report_lines').get().n;
}

function sumByMonth(fromDate, toDate) {
  return db.prepare(`
    SELECT substr(invoice_date, 1, 7) AS month, SUM(price_subtotal_consolidated) AS total
    FROM odoo_invoice_report_lines
    WHERE invoice_date BETWEEN ? AND ?
    GROUP BY month
  `).all(fromDate, toDate);
}

// Odoo's "Average Invoice" counts distinct documents, credit notes included.
function countDocuments(fromDate, toDate) {
  return db.prepare(`
    SELECT COUNT(DISTINCT move_id) AS n FROM odoo_invoice_report_lines WHERE invoice_date BETWEEN ? AND ?
  `).get(fromDate, toDate).n;
}

/* Largest invoices across all companies, by Odoo's converted untaxed
   amount (each company's own amount_total_signed is in its own currency,
   so it can't rank across companies). Payment state comes from the same
   document in odoo_invoices — the ids are Odoo's account.move ids. */
function listLargestInvoices(fromDate, toDate, limit) {
  return db.prepare(`
    SELECT l.move_id AS moveId, COALESCE(i.name, l.move_name) AS name, l.company_id AS companyId, l.invoice_date AS invoiceDate,
           -- The invoice's commercial partner (as everywhere else in the
           -- portal), falling back to the report line's own partner.
           COALESCE(i.partner_id, l.partner_id) AS partnerId, COALESCE(i.partner_name, l.partner_name) AS partnerName,
           l.salesperson_name AS salespersonName,
           SUM(l.price_subtotal_consolidated) AS untaxed, i.payment_state AS paymentState
    FROM odoo_invoice_report_lines l
    LEFT JOIN odoo_invoices i ON i.odoo_id = l.move_id
    WHERE l.move_type = 'out_invoice' AND l.invoice_date BETWEEN ? AND ?
    GROUP BY l.move_id
    ORDER BY untaxed DESC, l.move_id DESC
    LIMIT ?
  `).all(fromDate, toDate, limit);
}

function sumBySalesperson(fromDate, toDate) {
  return db.prepare(`
    SELECT salesperson_name AS salespersonName, SUM(price_subtotal_consolidated) AS total,
           COUNT(DISTINCT CASE WHEN move_type = 'out_invoice' THEN move_id END) AS invoices
    FROM odoo_invoice_report_lines
    WHERE invoice_date BETWEEN ? AND ?
    GROUP BY salesperson_name
    ORDER BY total DESC
  `).all(fromDate, toDate);
}

module.exports = {
  replaceAll, countAll, sumByMonth, countDocuments, listLargestInvoices, sumBySalesperson,
};
