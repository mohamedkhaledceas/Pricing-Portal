function toDepartment(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    active: row.active !== 0,
    createdAt: row.created_at,
  };
}

module.exports = { toDepartment };
