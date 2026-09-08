/* kpi_clickup_lists — local cache of real ClickUp list/status shapes.
   Only SQL here. */
const db = require('../../../db');

function rowToList(row) {
  if (!row) return null;
  return { ...row, statuses: JSON.parse(row.statuses_json) };
}

function findAll() {
  return db.prepare('SELECT * FROM kpi_clickup_lists ORDER BY name').all().map(rowToList);
}

function findById(clickupListId) {
  return rowToList(db.prepare('SELECT * FROM kpi_clickup_lists WHERE clickup_list_id = ?').get(clickupListId));
}

function upsert({ clickupListId, name, spaceName, folderName, statuses }) {
  db.prepare(`
    INSERT INTO kpi_clickup_lists (clickup_list_id, name, space_name, folder_name, statuses_json, last_synced_at)
    VALUES (@clickupListId, @name, @spaceName, @folderName, @statusesJson, CURRENT_TIMESTAMP)
    ON CONFLICT(clickup_list_id) DO UPDATE SET
      name = excluded.name,
      space_name = excluded.space_name,
      folder_name = excluded.folder_name,
      statuses_json = excluded.statuses_json,
      last_synced_at = CURRENT_TIMESTAMP
  `).run({ clickupListId, name, spaceName: spaceName || null, folderName: folderName || null, statusesJson: JSON.stringify(statuses || []) });
  return findById(clickupListId);
}

module.exports = { findAll, findById, upsert };
