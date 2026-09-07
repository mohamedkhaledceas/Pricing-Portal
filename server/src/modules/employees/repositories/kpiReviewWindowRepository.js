/* kpi_review_windows — only SQL here. */
const db = require('../../../db');

function findByQuarter(quarter) {
  return db.prepare('SELECT * FROM kpi_review_windows WHERE quarter = ?').get(quarter);
}

function upsert({ quarter, opensAt, closesAt, setBy }) {
  db.prepare(`
    INSERT INTO kpi_review_windows (quarter, opens_at, closes_at, set_by)
    VALUES (@quarter, @opensAt, @closesAt, @setBy)
    ON CONFLICT(quarter) DO UPDATE SET
      opens_at = excluded.opens_at,
      closes_at = excluded.closes_at,
      set_by = excluded.set_by,
      updated_at = CURRENT_TIMESTAMP
  `).run({ quarter, opensAt, closesAt, setBy });
  return findByQuarter(quarter);
}

module.exports = { findByQuarter, upsert };
