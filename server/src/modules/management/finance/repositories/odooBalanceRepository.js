/* odoo_balance_lines (migration 039) — balance-sheet journal items. Only
   SQL here; the Odoo sync replaces the table whole on every run. Every
   read is for one company, in its own currency. */
const db = require('../../../../db');

const COLUMNS = [
  'odoo_id', 'company_id', 'date', 'account_type', 'account_id', 'account_code', 'account_name', 'non_trade',
  'debit', 'credit', 'balance', 'synced_at',
];
const insertStatement = db.prepare(`
  INSERT INTO odoo_balance_lines (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
`);

function replaceAll(rows) {
  db.prepare('DELETE FROM odoo_balance_lines').run();
  for (const row of rows) insertStatement.run(row);
}

function countAll() {
  return db.prepare('SELECT COUNT(*) AS n FROM odoo_balance_lines').get().n;
}

// Balance (debit − credit) per account type and non-trade flag, dated within the range.
function sumByType(companyId, fromDate, toDate) {
  return db.prepare(`
    SELECT account_type AS accountType, non_trade AS nonTrade, SUM(balance) AS balance
    FROM odoo_balance_lines
    WHERE company_id = ? AND date BETWEEN ? AND ?
    GROUP BY account_type, non_trade
  `).all(companyId, fromDate, toDate);
}

// Running balance per bank / cash / credit-card account up to a date.
function listCashAccounts(companyId, cashTypes, toDate) {
  return db.prepare(`
    SELECT account_id AS accountId, account_code AS code, account_name AS name, account_type AS accountType,
           SUM(balance) AS balance
    FROM odoo_balance_lines
    WHERE company_id = ? AND account_type IN (${cashTypes.map(() => '?').join(', ')}) AND date <= ?
    GROUP BY account_id
    ORDER BY account_code
  `).all(companyId, ...cashTypes, toDate);
}

// Money in (debits) and out (credits) on those accounts within a period.
function sumCashFlows(companyId, cashTypes, fromDate, toDate) {
  return db.prepare(`
    SELECT COALESCE(SUM(debit), 0) AS received, COALESCE(SUM(credit), 0) AS spent
    FROM odoo_balance_lines
    WHERE company_id = ? AND account_type IN (${cashTypes.map(() => '?').join(', ')}) AND date BETWEEN ? AND ?
  `).get(companyId, ...cashTypes, fromDate, toDate);
}

// Same, per month — for the cash runway.
function sumCashFlowsByMonth(companyId, cashTypes, fromDate, toDate) {
  return db.prepare(`
    SELECT substr(date, 1, 7) AS month, COALESCE(SUM(debit), 0) AS received, COALESCE(SUM(credit), 0) AS spent
    FROM odoo_balance_lines
    WHERE company_id = ? AND account_type IN (${cashTypes.map(() => '?').join(', ')}) AND date BETWEEN ? AND ?
    GROUP BY month
  `).all(companyId, ...cashTypes, fromDate, toDate);
}

module.exports = { replaceAll, countAll, sumByType, listCashAccounts, sumCashFlows, sumCashFlowsByMonth };
