/* Adds an optional comment/feedback field to a single Pillar B metric
   entry — item 9 ("KPI comments / feedback") needs per-metric context, not
   just the bare actual_value. A plain nullable column addition, no CHECK
   constraint involved, so unlike 011's department-FK change this doesn't
   need a table rebuild. */
function up(db) {
  db.exec('ALTER TABLE kpi_scores ADD COLUMN comment TEXT');
}

module.exports = { up };
