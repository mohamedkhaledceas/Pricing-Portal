/* kpi_scores — one row per (employee, quarter, metric). Only SQL here. */
const db = require('../../../db');
const { cairoQuarterExpr } = require('../../../utils/cairoQuarter');

function findByEmployeeAndQuarter(employeeId, quarter) {
  return db.prepare('SELECT * FROM kpi_scores WHERE employee_id = ? AND quarter = ?').all(employeeId, quarter);
}

function upsert({ employeeId, quarter, metricId, actualValue, computedScore, enteredBy, source, comment }) {
  db.prepare(`
    INSERT INTO kpi_scores (employee_id, quarter, metric_id, actual_value, computed_score, entered_by, entered_at, source, comment)
    VALUES (@employeeId, @quarter, @metricId, @actualValue, @computedScore, @enteredBy, CURRENT_TIMESTAMP, @source, @comment)
    ON CONFLICT(employee_id, quarter, metric_id) DO UPDATE SET
      actual_value = excluded.actual_value,
      computed_score = excluded.computed_score,
      entered_by = excluded.entered_by,
      entered_at = excluded.entered_at,
      source = excluded.source,
      comment = excluded.comment,
      updated_at = CURRENT_TIMESTAMP
  `).run({ employeeId, quarter, metricId, actualValue: String(actualValue), computedScore, enteredBy, source, comment: comment || null });
  return db.prepare('SELECT * FROM kpi_scores WHERE employee_id = ? AND quarter = ? AND metric_id = ?').get(employeeId, quarter, metricId);
}

// Distinct quarters this employee has at least one entered score in —
// drives the Performance History quarter picker (item 10). Pillar A's own
// quarters are unioned in by the service layer via
// pillarAReviewRepository.listQuartersWithData, not here, since the two
// tables have no FK relationship to join on.
function listQuartersWithData(employeeId) {
  return db.prepare('SELECT DISTINCT quarter FROM kpi_scores WHERE employee_id = ? ORDER BY quarter DESC')
    .all(employeeId)
    .map((row) => row.quarter);
}

// Same Cairo-local quarter math commercial-leads' dealRepository.getCurrentQuarter
// already uses (cairoQuarterExpr, shared via utils/cairoQuarter.js) — this
// module reuses the same SQL builder rather than re-deriving quarter math.
function getCurrentQuarter() {
  return db.prepare(`SELECT (${cairoQuarterExpr("datetime('now')")}) AS q`).get().q;
}

// How many of a profile's defined metrics this employee still has no score
// row for this quarter — backs Required Actions (item 12). One row per
// employee with kpi_profile set; missingCount is defsCount - enteredCount.
function findMissingCountsByQuarter(quarter) {
  return db.prepare(`
    SELECT
      e.id AS employee_id,
      e.kpi_profile AS kpi_profile,
      (SELECT COUNT(*) FROM kpi_definitions d WHERE d.kpi_profile = e.kpi_profile AND d.effective_quarter = ?) AS defs_count,
      (SELECT COUNT(*) FROM kpi_scores s WHERE s.employee_id = e.id AND s.quarter = ?) AS entered_count
    FROM employees e
    WHERE e.active = 1 AND e.kpi_profile IS NOT NULL
  `).all(quarter, quarter).filter((row) => row.entered_count < row.defs_count);
}

module.exports = { findByEmployeeAndQuarter, upsert, listQuartersWithData, getCurrentQuarter, findMissingCountsByQuarter };
