/* Row-mapper: snake_case DB columns <-> camelCase JSON, per the project's
   convention (docs/coding-standards.md) — services/controllers never see a
   raw DB row. Two shapes, matching the two the current app already
   returns: toPublicUser (a user describing themselves — /api/me, login,
   register, refresh) and toAccount (an admin's view of any account, adds
   isActive/timestamps — GET /api/users and friends). */
function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
  };
}

function toAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    isActive: row.is_active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { toPublicUser, toAccount };
