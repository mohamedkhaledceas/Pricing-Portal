/* finance_data_checks (migration 045). Only SQL here. */
const db = require('../../../../db');

function record(checkKey, status, detail, at) {
  db.prepare(`
    INSERT INTO finance_data_checks (check_key, status, detail, checked_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (check_key) DO UPDATE SET status = excluded.status, detail = excluded.detail, checked_at = excluded.checked_at
  `).run(checkKey, status, detail, at);
}

function listAll() {
  return db.prepare('SELECT check_key AS key, status, detail, checked_at AS checkedAt FROM finance_data_checks ORDER BY check_key').all();
}

module.exports = { record, listAll };
