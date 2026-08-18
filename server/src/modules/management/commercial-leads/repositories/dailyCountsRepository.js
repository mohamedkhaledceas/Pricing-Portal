/* commercial_lead_daily_counts — recomputed (not incrementally patched)
   from the live cache every time something relevant changes. Extracted
   unchanged from clickupSync.js/commercialLead.js. */
const db = require('../../../../db');

// Full delete+reinsert of today's rows for this list — a dimension/value
// pair that drops to zero has to disappear, not linger at its last count.
function replaceForDate({ date, listId, counts }) {
  const del = db.prepare('DELETE FROM commercial_lead_daily_counts WHERE date = ? AND list_id = ?');
  const insert = db.prepare(`
    INSERT INTO commercial_lead_daily_counts (date, list_id, dimension, value, count)
    VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    del.run(date, listId);
    for (const [dimension, values] of Object.entries(counts)) {
      for (const [value, count] of Object.entries(values)) {
        insert.run(date, listId, dimension, String(value), count);
      }
    }
  });
  tx();
}

function findSince({ listId, sinceDate }) {
  return db
    .prepare(
      `SELECT date, dimension, value, count FROM commercial_lead_daily_counts
       WHERE list_id = ? AND date >= ?
       ORDER BY date ASC`
    )
    .all(listId, sinceDate);
}

module.exports = { replaceForDate, findSince };
