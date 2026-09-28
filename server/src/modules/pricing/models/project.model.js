/* Replaces toProjectLine/project_lines — employeeId is a real employees.id
   now (migration 030, tracker §4 item 8), not team_members' free-text
   person_id. Deliberately renamed the field, not just the source table:
   calling this personId would misrepresent it as compatible with the old
   shape, which it isn't (different id space entirely) — the pre-existing
   frontend will need its own rework to match, which is expected, not an
   oversight (see the tracker's own item 8b note). */
function toProjectAssignment(row) {
  return { id: row.id, employeeId: row.employee_id, hours: Number(row.hours || 0), roleOnProject: row.role_on_project || null };
}

function toDirectCost(row) {
  return { id: row.id, name: row.name || '', amount: Number(row.amount || 0), cur: row.currency || 'EGP' };
}

function toScenario(row) {
  return {
    id: row.id,
    name: row.name || '',
    hoursFactor: Number(row.hours_factor || 100),
    extra: Number(row.extra || 0),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
  };
}

function toQuoteLine(row) {
  return { id: row.id, name: row.name || '', amount: Number(row.amount || 0) };
}

// quote_json holds quote *metadata* only — quote.lines always comes from
// the quote_lines table rows passed in separately below, never from here.
function toQuoteMeta(quoteJson) {
  let parsed = {};
  try {
    parsed = quoteJson ? JSON.parse(quoteJson) : {};
  } catch {
    parsed = {};
  }
  return {
    num: parsed.num || '',
    date: parsed.date || '',
    valid: Number(parsed.valid || 30),
    detail: parsed.detail || 'lump',
    disc: Number(parsed.disc || 0),
    vat: Number(parsed.vat || 0),
    scope: parsed.scope || '',
    terms: parsed.terms || '',
  };
}

function toProject(row, { lines = [], directCosts = [], scenarios = [], quoteLines = [] } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    client: row.client || '',
    months: Number(row.months || 1),
    status: row.status || 'Quoting',
    start: row.start_month || '',
    cur: row.currency || 'EGP',
    cont: Number(row.contingency || 0),
    target: Number(row.target || 35),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    lines: lines.map(toProjectAssignment),
    direct: directCosts.map(toDirectCost),
    scenarios: scenarios.map(toScenario),
    quote: { ...toQuoteMeta(row.quote_json), lines: quoteLines.map(toQuoteLine) },
  };
}

module.exports = { toProject, toProjectAssignment, toDirectCost, toScenario, toQuoteLine, toQuoteMeta };
