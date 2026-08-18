/* Row-mapper for commercial_lead_live_cache: snake_case DB <-> camelCase
   JSON. Extracted unchanged from the old commercialLead.js's parseCacheRow. */
function toDeal(row) {
  return {
    id: row.deal_id,
    name: row.name,
    status: row.status,
    fields: JSON.parse(row.fields_json || '{}'),
    subtasks: JSON.parse(row.subtasks_json || '[]'),
    // ClickUp's own dates — when the deal was actually created/edited there,
    // not when our sync last touched the row (see clickup_created_at
    // comment in db.js for why that distinction matters).
    clickupCreatedAt: row.clickup_created_at,
    clickupUpdatedAt: row.clickup_updated_at,
  };
}

module.exports = { toDeal };
