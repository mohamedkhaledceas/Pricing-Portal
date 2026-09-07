/* kpi_clickup_lists — local cache of "what lists exist and what statuses
   each currently defines" for whichever lists any active mapping
   references. Refreshed periodically (see jobs/kpiClickupListSync.js) so
   the mapping-admin UI always shows real, current statuses to pick from
   instead of a stale hand-typed string — ClickUp status names can be
   renamed by whoever manages a list. */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_clickup_lists (
      clickup_list_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      space_name TEXT,
      folder_name TEXT,
      statuses_json TEXT NOT NULL DEFAULT '[]',
      last_synced_at TEXT
    );
  `);
}

module.exports = { up };
