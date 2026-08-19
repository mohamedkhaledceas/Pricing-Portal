/* kpi_definitions — the Pillar B framework, transcribed from
   KPI_Framework.xlsx (see kpiFrameworkSeed.data.js). Only SQL here. */
const db = require('../../../db');

function findByProfileAndQuarter(kpiProfile, quarter) {
  return db
    .prepare('SELECT * FROM kpi_definitions WHERE kpi_profile = ? AND effective_quarter = ? ORDER BY pillar, metric_id')
    .all(kpiProfile, quarter);
}

function existsForQuarter(quarter) {
  return !!db.prepare('SELECT id FROM kpi_definitions WHERE effective_quarter = ? LIMIT 1').get(quarter);
}

/* Idempotent bulk seed — INSERT OR IGNORE relies on the
   UNIQUE(kpi_profile, metric_id, effective_quarter) constraint, so calling
   this more than once (e.g. every server boot) never duplicates rows. */
function seedMany(rows) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO kpi_definitions
      (kpi_profile, pillar, metric_id, name, weight_pct, target_text, source_type, formula_config, effective_quarter)
    VALUES (@kpiProfile, @pillar, @metricId, @name, @weightPct, @targetText, @sourceType, @formulaConfig, @effectiveQuarter)
  `);
  const tx = db.transaction((defs) => {
    for (const row of defs) {
      insert.run({ ...row, formulaConfig: JSON.stringify(row.formulaConfig) });
    }
  });
  tx(rows);
}

module.exports = { findByProfileAndQuarter, existsForQuarter, seedMany };
