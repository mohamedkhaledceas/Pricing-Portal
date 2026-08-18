/* Single source for the role enum string values — every other file (the
   users table CHECK constraint, common/permissions.js, modules/auth/,
   create-user.js) reads from here instead of re-typing the literals.
   'employee' replaces the old generic 'user' role (the default role any new
   signup gets); manager/operations/finance/admin are unchanged this pass —
   see docs/adr/0005 for the larger role-enum swap this deliberately isn't
   doing yet. */
const ROLES = Object.freeze({
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  OPERATIONS: 'operations',
  FINANCE: 'finance',
  ADMIN: 'admin',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

module.exports = { ROLES, ALL_ROLES };
