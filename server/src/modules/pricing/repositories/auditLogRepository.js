/* audit_log — read-only from this module's perspective (writes go through
   common/audit.js, called from the services). Only SQL here. */
const db = require('../../../db');

const HISTORY_LIMIT = 200;

// Every sub-entity's audit rows (project_line/direct_cost/scenario/quote_line)
// carry the parent projectId inside `details`, since their own entityId is
// the line item's id, not the project's — json_extract pulls it back out to
// scope the history to one project without a schema change.
function findProjectHistory(projectId) {
  return db.prepare(`
    SELECT id, username, action, entity_type, entity_id, details, created_at
    FROM audit_log
    WHERE (entity_type = 'project' AND entity_id = ?)
       OR (entity_type IN ('project_line', 'direct_cost', 'scenario', 'quote_line')
           AND json_extract(details, '$.projectId') = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ${HISTORY_LIMIT}
  `).all(projectId, projectId);
}

module.exports = { findProjectHistory };
