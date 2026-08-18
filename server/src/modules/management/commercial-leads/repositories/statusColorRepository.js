/* commercial_lead_status_colors — mirrors ClickUp's own status hex colors.
   Extracted unchanged from clickupSync.js/commercialLead.js. */
const db = require('../../../../db');

// Upserts every status ClickUp currently has, removes any row for a status
// ClickUp no longer has (same "seenIds" staleness pattern as deal reconciliation).
function replaceForList({ listId, statuses }) {
  const upsert = db.prepare(`
    INSERT INTO commercial_lead_status_colors (list_id, status, color, orderindex, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(list_id, status) DO UPDATE SET
      color = excluded.color,
      orderindex = excluded.orderindex,
      updated_at = excluded.updated_at
  `);
  const del = db.prepare('DELETE FROM commercial_lead_status_colors WHERE list_id = ? AND status = ?');

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const seen = new Set();
    for (const s of statuses) {
      seen.add(s.status);
      upsert.run(listId, s.status, s.color, s.orderindex ?? 0, now);
    }
    const existing = db.prepare('SELECT status FROM commercial_lead_status_colors WHERE list_id = ?').all(listId);
    for (const row of existing) {
      if (!seen.has(row.status)) del.run(listId, row.status);
    }
  });
  tx();
}

function findByListId(listId) {
  return db.prepare('SELECT status, color FROM commercial_lead_status_colors WHERE list_id = ?').all(listId);
}

module.exports = { replaceForList, findByListId };
