function toHistoryEntry(row) {
  return {
    id: row.id,
    username: row.username,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details ? JSON.parse(row.details) : null,
    createdAt: row.created_at,
  };
}

module.exports = { toHistoryEntry };
