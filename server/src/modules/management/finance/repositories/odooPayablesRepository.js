/* odoo_vendor_bills + odoo_expenses (migration 040) — what each company
   owes. Only SQL here; the Odoo sync replaces both tables whole on every
   run. Every read is for one company, in its own currency. */
const db = require('../../../../db');

const BILL_COLUMNS = [
  'odoo_id', 'company_id', 'move_type', 'name', 'ref', 'partner_id', 'partner_name', 'invoice_date', 'invoice_date_due',
  'state', 'payment_state', 'untaxed', 'total', 'residual', 'synced_at',
];
const EXPENSE_COLUMNS = [
  'odoo_id', 'company_id', 'name', 'employee_name', 'date', 'state', 'payment_mode', 'total_amount', 'product_name',
  'synced_at',
];
const insert = (table, columns) => db.prepare(`
  INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})
`);
const insertBill = insert('odoo_vendor_bills', BILL_COLUMNS);
const insertExpense = insert('odoo_expenses', EXPENSE_COLUMNS);

function replaceBills(rows) {
  db.prepare('DELETE FROM odoo_vendor_bills').run();
  for (const row of rows) insertBill.run(row);
}

function replaceExpenses(rows) {
  db.prepare('DELETE FROM odoo_expenses').run();
  for (const row of rows) insertExpense.run(row);
}

function countBills() {
  return db.prepare('SELECT COUNT(*) AS n FROM odoo_vendor_bills').get().n;
}

// Posted bills and refunds with something left to pay, latest due first to settle.
function listOpenBills(companyId) {
  return db.prepare(`
    SELECT name, ref, move_type AS moveType, partner_name AS partnerName, invoice_date AS invoiceDate,
           invoice_date_due AS dueDate, payment_state AS paymentState, residual
    FROM odoo_vendor_bills
    WHERE company_id = ? AND state = 'posted' AND residual != 0
    ORDER BY invoice_date_due, odoo_id
  `).all(companyId);
}

// Untaxed amount billed per vendor in a date range, net of refunds.
function sumBilledByVendor(companyId, fromDate, toDate, limit) {
  return db.prepare(`
    SELECT partner_name AS partnerName, SUM(untaxed) AS total, SUM(CASE WHEN move_type = 'in_invoice' THEN 1 ELSE 0 END) AS bills
    FROM odoo_vendor_bills
    WHERE company_id = ? AND state = 'posted' AND invoice_date BETWEEN ? AND ?
    GROUP BY partner_id
    ORDER BY total DESC
    LIMIT ?
  `).all(companyId, fromDate, toDate, limit);
}

function sumBilled(companyId, fromDate, toDate) {
  return db.prepare(`
    SELECT COALESCE(SUM(untaxed), 0) AS total, COUNT(*) AS documents
    FROM odoo_vendor_bills
    WHERE company_id = ? AND state = 'posted' AND invoice_date BETWEEN ? AND ?
  `).get(companyId, fromDate, toDate);
}

// Expenses per state: count and amount.
function summarizeExpenses(companyId) {
  return db.prepare(`
    SELECT state, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total
    FROM odoo_expenses
    WHERE company_id = ?
    GROUP BY state
  `).all(companyId);
}

function listExpenses(companyId, states, limit) {
  return db.prepare(`
    SELECT name, employee_name AS employeeName, date, state, payment_mode AS paymentMode, total_amount AS total
    FROM odoo_expenses
    WHERE company_id = ? AND state IN (${states.map(() => '?').join(', ')})
    ORDER BY total_amount DESC, odoo_id DESC
    LIMIT ?
  `).all(companyId, ...states, limit);
}

module.exports = {
  replaceBills, replaceExpenses, countBills, listOpenBills, sumBilledByVendor, sumBilled, summarizeExpenses, listExpenses,
};
