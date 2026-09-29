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
    active: row.active !== 0,
    jobTitle: row.job_title,
    employmentType: row.employment_type,
    joiningDate: row.joining_date,
    workLocation: row.work_location,
    isTeamHead: !!row.is_team_head,
    // Once true, self-service edits (rosterService.updateMine) go through
    // the pending-approval queue instead of applying directly — see
    // employee_profile_change_requests (migration 008).
    profileLocked: !!row.profile_locked,
    photoUrl: row.photo_url,
    // Raw stored value only — 'active' | 'remote'. The 'on_leave' override
    // is never stored; it's applied on top of this by rosterService at
    // read time (see decorateStatus there).
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* Narrower than toEmployee — no auth role or account-active status. This is
   what any authenticated employee can see about a colleague: enough for the
   Teams directory (email as a mailto: contact link, manager lookup) and the
   handover/manager-picker use this already served, but still not the
   roster-management view (toEmployee), which stays gated to P&C/admin/
   ceo/operations. isCompanyManager is a narrow, purpose-named exception
   to "no auth role" above — the org chart (teamsDirectory.js) needs to
   anchor its single root at the one real 'ceo'-role account (renamed from
   'manager' in migration 024 — see docs — this org's single top-level exec
   role, not a generic line-manager role) regardless of that account's own
   manager_employee_id, which a flat boolean answers without exposing the
   full role string/other roles. */
function toDirectoryEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id, // cross-referenced against common/realtime's live socket presence — see rosterService.listDirectory
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    email: row.user_email,
    department: row.department,
    jobTitle: row.job_title,
    photoUrl: row.photo_url,
    status: row.status,
    isTeamHead: !!row.is_team_head,
    isCompanyManager: row.user_role === 'ceo',
    managerEmployeeId: row.manager_employee_id,
    online: false, // overwritten in rosterService.listDirectory with real-time presence; default here only in case that's ever skipped
  };
}

/* Minimal, pre-auth shape — used only by the signup wizard's Assigned
   Manager dropdown (see routes/index.js's unauthenticated /employees/
   team-heads endpoint). Deliberately just id + name, nothing else: this is
   reachable before login, so it gets the narrowest exposure of any mapper
   in this module. */
function toTeamHeadOption(row) {
  if (!row) return null;
  return { id: row.id, firstName: row.user_first_name, lastName: row.user_last_name };
}

/* For modules/pricing's Team & Salaries tab / Estimator staffing — exposed
   through this module's own public interface (plannerExportService), never
   by pricing reaching into this module's repository directly. name/jobTitle
   are always included (harmless — pricing needs someone to pick from a
   dropdown); the compensation fields (migrations 028-029) are the whole
   reason this mapper exists as its own function rather than just widening
   toEmployee — includeCompensation is resolved by the caller from
   common/permissions.js's canViewCompensation(actorRole) before this is
   ever called, so an unauthorized role's HTTP response never contains
   these fields at all, not just a UI that hides them. */
function toPlannerEntry(row, { includeCompensation }) {
  if (!row) return null;
  const base = {
    id: row.id,
    name: `${row.user_first_name || ''} ${row.user_last_name || ''}`.trim(),
    jobTitle: row.job_title,
    department: row.department,
  };
  if (!includeCompensation) return base;
  return {
    ...base,
    salary: row.salary === null || row.salary === undefined ? null : Number(row.salary),
    currency: row.currency,
    defaultHours: row.default_hours === null || row.default_hours === undefined ? null : Number(row.default_hours),
    defaultUtilizationPct: row.default_utilization_pct === null || row.default_utilization_pct === undefined ? null : Number(row.default_utilization_pct),
    overrideRate: row.override_rate === null || row.override_rate === undefined ? null : Number(row.override_rate),
  };
}

module.exports = { toEmployee, toDirectoryEntry, toTeamHeadOption, toPlannerEntry };
