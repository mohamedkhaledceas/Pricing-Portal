/* odoo_pnl_lines + odoo_currency_rates (migration 036) — Odoo's Profit
   and Loss inputs. Only SQL here; the Odoo sync replaces both tables whole
   (inside its transaction) on every run. */
const db = require('../../../../db');

const insertLine = db.prepare(`
  INSERT INTO odoo_pnl_lines (odoo_id, company_id, date, account_type, balance, synced_at)
  VALUES (@odoo_id, @company_id, @date, @account_type, @balance, @synced_at)
`);
const insertRate = db.prepare(`
  INSERT INTO odoo_currency_rates (odoo_id, currency, date, inverse_rate, synced_at)
  VALUES (@odoo_id, @currency, @date, @inverse_rate, @synced_at)
`);

function replaceLines(rows) {
  db.prepare('DELETE FROM odoo_pnl_lines').run();
  for (const row of rows) insertLine.run(row);
}

function replaceRates(rows) {
  db.prepare('DELETE FROM odoo_currency_rates').run();
  for (const row of rows) insertRate.run(row);
}

function countLines() {
  return db.prepare('SELECT COUNT(*) AS n FROM odoo_pnl_lines').get().n;
}

// Balance (debit − credit) per company and account type over a date range.
function sumByCompanyAndType(fromDate, toDate) {
  return db.prepare(`
    SELECT company_id AS companyId, account_type AS accountType, SUM(balance) AS balance
    FROM odoo_pnl_lines
    WHERE date BETWEEN ? AND ?
    GROUP BY company_id, account_type
  `).all(fromDate, toDate);
}

// Same, split by month (YYYY-MM).
function sumByCompanyTypeAndMonth(fromDate, toDate) {
  return db.prepare(`
    SELECT company_id AS companyId, account_type AS accountType, substr(date, 1, 7) AS month, SUM(balance) AS balance
    FROM odoo_pnl_lines
    WHERE date BETWEEN ? AND ?
    GROUP BY company_id, account_type, month
  `).all(fromDate, toDate);
}

// Balance per account type for one company over a range (all time when fromDate is '0000-01-01').
function sumByTypeForCompany(companyId, fromDate, toDate) {
  return db.prepare(`
    SELECT account_type AS accountType, SUM(balance) AS balance
    FROM odoo_pnl_lines
    WHERE company_id = ? AND date BETWEEN ? AND ?
    GROUP BY account_type
  `).all(companyId, fromDate, toDate);
}

function listRates(currency) {
  return db.prepare('SELECT date, inverse_rate AS inverseRate FROM odoo_currency_rates WHERE currency = ? ORDER BY date')
    .all(currency);
}

module.exports = {
  replaceLines, replaceRates, countLines, sumByCompanyAndType, sumByCompanyTypeAndMonth, sumByTypeForCompany, listRates,
};
