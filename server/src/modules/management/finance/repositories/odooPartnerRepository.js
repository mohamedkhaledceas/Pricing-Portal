/* odoo_partners — read-only mirror of the Odoo customers referenced by
   cached invoices (migration 033). Only SQL here. Same cache semantics as
   odooInvoiceRepository.js: rows Odoo no longer references are removed. */
const db = require('../../../../db');
const { toPartner } = require('../models/odooRecord.model');

const COLUMNS = ['odoo_id', 'name', 'email', 'website', 'vat', 'is_company', 'odoo_write_date', 'synced_at'];

const upsertStatement = db.prepare(`
  INSERT INTO odoo_partners (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(odoo_id) DO UPDATE SET
    ${COLUMNS.filter((c) => c !== 'odoo_id').map((c) => `${c} = excluded.${c}`).join(',\n    ')}
`);

function upsertMany(rows) {
  for (const row of rows) upsertStatement.run(row);
}

function listIds() {
  return db.prepare('SELECT odoo_id FROM odoo_partners').all().map((r) => r.odoo_id);
}

function removeByIds(ids) {
  const statement = db.prepare('DELETE FROM odoo_partners WHERE odoo_id = ?');
  for (const id of ids) statement.run(id);
}

function findById(odooId) {
  const row = db.prepare('SELECT * FROM odoo_partners WHERE odoo_id = ?').get(odooId);
  return row ? toPartner(row) : null;
}

function listAll() {
  return db.prepare('SELECT * FROM odoo_partners ORDER BY name COLLATE NOCASE').all().map(toPartner);
}

function findByIds(odooIds) {
  if (!odooIds.length) return [];
  return db.prepare(`SELECT * FROM odoo_partners WHERE odoo_id IN (${odooIds.map(() => '?').join(', ')})`)
    .all(...odooIds).map(toPartner);
}

module.exports = { upsertMany, listIds, removeByIds, findById, findByIds, listAll };
