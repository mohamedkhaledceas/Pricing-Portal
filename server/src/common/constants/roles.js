/* Single source for the role enum string values — every other file (the
   users table CHECK constraint, common/permissions.js, modules/auth/,
   create-user.js) reads from here instead of re-typing the literals.
   'employee' replaces the old generic 'user' role (the default role any new
   signup gets). 'manager' was renamed to 'ceo' (migration 024) — this org
   has only ever had one 'manager'-role account and it always meant the
   CEO; the old name collided with the unrelated reporting-line-manager
   concept (manager_employee_id) elsewhere in the schema, which is why the
   Team KPI Summary bug existed. 'commercial' and 'account_management'
   (migration 025) are new for the CEAS Business Portal work — grounded in
   real data, not guessed: ClickUp's own deal fields already distinguish a
   'Sales Person' custom field from a separate 'Account Manager' one, with
   different real people populating each (docs/governance/
   business-portal-tracker.md §1). Assignable from this pass onward, but
   have no page-level permission gates yet — there's nothing for them to
   gate until the commercial/clients pages this enum change is preparing
   for actually exist. 'finance' remains a dead role for the same reason
   (its pages are Odoo-blocked) — not an oversight, see the tracker's §1
   status table. operations/admin are unchanged this pass — see
   docs/adr/0005 for the larger role-enum swap this deliberately isn't
   doing yet. */
const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  CEO: 'ceo',
  OPERATIONS: 'operations',
  FINANCE: 'finance',
  ADMIN: 'admin',
  PEOPLE_CULTURE: 'people_culture',
  COMMERCIAL: 'commercial',
  ACCOUNT_MANAGEMENT: 'account_management',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

module.exports = { ROLES, ALL_ROLES };
