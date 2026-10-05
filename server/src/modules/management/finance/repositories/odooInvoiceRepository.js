/* odoo_invoices — read-only mirror of Odoo customer invoices + credit notes
   (migration 032). Only SQL here. removeByIds exists on purpose: this is a
   cache of Odoo, so a record deleted in Odoo is removed here too. */
const db = require('../../../../db');
const { toOpenInvoice, toInvoice } = require('../models/odooRecord.model');

const COLUMNS = [
  'odoo_id', 'company_id', 'move_type', 'name', 'partner_id', 'partner_name', 'invoice_date', 'invoice_date_due',
  'state', 'payment_state', 'currency', 'amount_untaxed', 'amount_total', 'amount_residual',
  'amount_untaxed_signed', 'amount_total_signed', 'amount_residual_signed', 'salesperson_name',
  'odoo_write_date', 'synced_at',
];

const upsertStatement = db.prepare(`
  INSERT INTO odoo_invoices (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(odoo_id) DO UPDATE SET
    ${COLUMNS.filter((c) => c !== 'odoo_id').map((c) => `${c} = excluded.${c}`).join(',\n    ')}
`);

function upsertMany(rows) {
  for (const row of rows) upsertStatement.run(row);
}

function listIdsByCompanies(companyIds) {
  return db.prepare(`SELECT odoo_id FROM odoo_invoices WHERE company_id IN (${companyIds.map(() => '?').join(', ')})`)
    .all(...companyIds).map((r) => r.odoo_id);
}

function removeByIds(ids) {
  const statement = db.prepare('DELETE FROM odoo_invoices WHERE odoo_id = ?');
  for (const id of ids) statement.run(id);
}

/* Reads below are for the CEO dashboard's finance blocks (ADR-0013 §10).
   Only posted moves count; amounts are *_signed (company currency, credit
   notes negative) so a plain SUM nets refunds out. */
function sumUntaxedByMonth(companyId, fromDate, toDate) {
  return db.prepare(`
    SELECT substr(invoice_date, 1, 7) AS month, SUM(amount_untaxed_signed) AS total
    FROM odoo_invoices
    WHERE company_id = ? AND state = 'posted' AND invoice_date BETWEEN ? AND ?
    GROUP BY month
  `).all(companyId, fromDate, toDate);
}

function sumTotalSigned(companyId, fromDate, toDate) {
  return db.prepare(`
    SELECT COALESCE(SUM(amount_total_signed), 0) AS total
    FROM odoo_invoices
    WHERE company_id = ? AND state = 'posted' AND invoice_date BETWEEN ? AND ?
  `).get(companyId, fromDate, toDate).total;
}

/* salesperson_name comes from each partner's latest invoice: SQLite fills
   a bare column from the row that produced MAX() in the same group. */
function sumUntaxedByPartner(companyId, fromDate, toDate) {
  return db.prepare(`
    SELECT partner_id AS partnerId, partner_name AS partnerName,
           SUM(amount_untaxed_signed) AS total, MAX(invoice_date) AS lastInvoiceDate,
           salesperson_name AS salespersonName
    FROM odoo_invoices
    WHERE company_id = ? AND state = 'posted' AND invoice_date BETWEEN ? AND ?
    GROUP BY partner_id
    ORDER BY total DESC
  `).all(companyId, fromDate, toDate);
}

function listOpen(companyId) {
  return db.prepare(`
    SELECT * FROM odoo_invoices
    WHERE company_id = ? AND state = 'posted' AND amount_residual_signed != 0
  `).all(companyId).map(toOpenInvoice);
}

function listPartnerIds() {
  return db.prepare('SELECT DISTINCT partner_id FROM odoo_invoices WHERE partner_id IS NOT NULL').all().map((r) => r.partner_id);
}

/* Per-partner invoice summary for the client-mapping review: how many
   posted invoices, in which entities, and the latest invoice date. */
function summarizeByPartner() {
  return db.prepare(`
    SELECT partner_id AS partnerId, COUNT(*) AS invoiceCount,
           GROUP_CONCAT(DISTINCT company_id) AS companyIds, MAX(invoice_date) AS lastInvoiceDate
    FROM odoo_invoices
    WHERE state = 'posted' AND partner_id IS NOT NULL
    GROUP BY partner_id
  `).all();
}

/* Client book (CEO Control Room): one row per customer per company, all
   time, with this year's invoicing, what's still open and what's past due.
   The salesperson is the one on that customer's latest invoice there. */
function summarizeByPartnerAndCompany(yearStart, today) {
  return db.prepare(`
    SELECT i.partner_id AS partnerId, MAX(i.partner_name) AS partnerName, i.company_id AS companyId,
           SUM(CASE WHEN i.invoice_date >= ? THEN i.amount_untaxed_signed ELSE 0 END) AS invoicedYtd,
           SUM(i.amount_untaxed_signed) AS invoicedTotal,
           SUM(i.amount_residual_signed) AS openAmount,
           SUM(CASE WHEN i.invoice_date_due < ? THEN i.amount_residual_signed ELSE 0 END) AS overdueAmount,
           MAX(i.invoice_date) AS lastInvoiceDate,
           COUNT(*) AS invoiceCount,
           (SELECT l.salesperson_name FROM odoo_invoices l
             WHERE l.partner_id = i.partner_id AND l.company_id = i.company_id AND l.state = 'posted'
             ORDER BY l.invoice_date DESC, l.odoo_id DESC LIMIT 1) AS salespersonName
    FROM odoo_invoices i
    WHERE i.state = 'posted' AND i.partner_id IS NOT NULL
    GROUP BY i.partner_id, i.company_id
  `).all(yearStart, today);
}

function listPostedByPartners(partnerIds) {
  if (!partnerIds.length) return [];
  return db.prepare(`
    SELECT * FROM odoo_invoices
    WHERE state = 'posted' AND partner_id IN (${partnerIds.map(() => '?').join(', ')})
    ORDER BY invoice_date DESC, odoo_id DESC
  `).all(...partnerIds).map(toInvoice);
}

module.exports = {
  summarizeByPartnerAndCompany, listPostedByPartners,
  listPartnerIds, summarizeByPartner,
  upsertMany, listIdsByCompanies, removeByIds, sumUntaxedByMonth, sumTotalSigned, sumUntaxedByPartner, listOpen,
};
