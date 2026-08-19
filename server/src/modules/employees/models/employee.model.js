/* Row-mapper: snake_case DB (joined with users) <-> camelCase JSON. */
function toEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    email: row.user_email,
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    authRole: row.user_role,
    isAccountActive: row.user_is_active !== 0,
    clickupUserId: row.clickup_user_id,
    department: row.department,
    kpiProfile: row.kpi_profile,
    managerEmployeeId: row.manager_employee_id,
    isPeopleCulture: row.is_people_culture !== 0,
    active: row.active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* Deliberately narrower than toEmployee — no email, auth role, or account
   status. This is what any authenticated employee can see about a
   colleague (to pick a handover teammate, see who manages whom), not the
   roster-management view, which stays gated to P&C/admin via toEmployee. */
function toDirectoryEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    department: row.department,
    managerEmployeeId: row.manager_employee_id,
  };
}

module.exports = { toEmployee, toDirectoryEntry };
