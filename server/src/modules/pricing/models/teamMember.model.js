function toTeamMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    role: row.role || '',
    salary: Number(row.salary || 0),
    extras: Number(row.extras || 0),
    hours: Number(row.hours || 176),
    util: Number(row.util || 70),
    override: row.override_value === null || row.override_value === undefined ? null : Number(row.override_value),
    cur: row.currency || 'EGP',
  };
}

module.exports = { toTeamMember };
