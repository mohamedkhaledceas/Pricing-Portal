/* odoo_payments — read-only mirror of Odoo account.payment (migration 032).
   Only SQL here. Same cache semantics as odooInvoiceRepository.js. */
const db = require('../../../../db');
const { toPayment } = require('../models/odooRecord.model');

const COLUMNS = [
  'odoo_id', 'company_id', 'partner_id', 'partner_name', 'partner_type', 'payment_type', 'date', 'state',
  'is_reconciled', 'currency', 'amount', 'amount_company_currency_signed', 'journal_name',
  'odoo_write_date', 'synced_at',
];

const upsertStatement = db.prepare(`
  INSERT INTO odoo_payments (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(odoo_id) DO UPDATE SET
    ${COLUMNS.filter((c) => c !== 'odoo_id').map((c) => `${c} = excluded.${c}`).join(',\n    ')}
`);

function upsertMany(rows) {
  for (const row of rows) upsertStatement.run(row);
}

function listIdsByCompanies(companyIds) {
  return db.prepare(`SELECT odoo_id FROM odoo_payments WHERE company_id IN (${companyIds.map(() => '?').join(', ')})`)
    .all(...companyIds).map((r) => r.odoo_id);
}

function removeByIds(ids) {
  const statement = db.prepare('DELETE FROM odoo_payments WHERE odoo_id = ?');
  for (const id of ids) statement.run(id);
}

/* Customer cash in the company currency. Refunds paid out to customers are
   outbound with a negative signed amount, so they net out of the SUM. */
function sumCustomerCash(companyId, states, fromDate, toDate) {
  return db.prepare(`
    SELECT COALESCE(SUM(amount_company_currency_signed), 0) AS total
    FROM odoo_payments
    WHERE company_id = ? AND partner_type = 'customer'
      AND state IN (${states.map(() => '?').join(', ')})
      AND date BETWEEN ? AND ?
  `).get(companyId, ...states, fromDate, toDate).total;
}

/* Client book detail: a customer's payments, cancelled ones excluded. */
function listCustomerByPartners(partnerIds) {
  if (!partnerIds.length) return [];
  return db.prepare(`
    SELECT * FROM odoo_payments
    WHERE partner_type = 'customer' AND state != 'canceled'
      AND partner_id IN (${partnerIds.map(() => '?').join(', ')})
    ORDER BY date DESC, odoo_id DESC
  `).all(...partnerIds).map(toPayment);
}

module.exports = { upsertMany, listIdsByCompanies, removeByIds, sumCustomerCash, listCustomerByPartners };
