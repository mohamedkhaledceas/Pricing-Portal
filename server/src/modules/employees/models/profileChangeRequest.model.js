/* Row-mapper: snake_case DB (joined with employees/users twice, once for
   the requesting employee and once for whichever reviewer decided it) <->
   camelCase JSON. */
function toChangeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: `${row.employee_first_name} ${row.employee_last_name}`,
    changes: JSON.parse(row.changes),
    status: row.status,
    reviewedByName: row.reviewer_first_name ? `${row.reviewer_first_name} ${row.reviewer_last_name}` : null,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toChangeRequest };
