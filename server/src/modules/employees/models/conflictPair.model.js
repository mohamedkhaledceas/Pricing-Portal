function toConflictPair(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeIdA: row.employee_id_a,
    employeeIdB: row.employee_id_b,
    active: row.active !== 0,
    createdAt: row.created_at,
  };
}

module.exports = { toConflictPair };
