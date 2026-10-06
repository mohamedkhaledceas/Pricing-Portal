/* The Control Room's saved budgets (phase 3): annual P&L-line budgets and
   the monthly function plans. Who may change what is decided here, on the
   server — the page only hides controls the server would refuse:

   - P&L-line budgets: ceo, admin.
   - Function plans: ceo, admin for every function; people_culture for
     People & Culture and Hiring; operations for Operations (user decision
     2026-10-05). Marketing has no owning role, so ceo/admin only.

   Amounts are whole, non-negative EGP below 10 billion; a note is optional
   (≤ 300 characters). Every change is audited with its before/after. */
const { AppError, ValidationError } = require('../../../../common/errors');
const { ROLES } = require('../../../../common/constants/roles');

const BUDGET_YEAR = 2026; // the seeded year (migration 041); the page is a 2026 plan
const FULL_EDIT_ROLES = [ROLES.CEO, ROLES.ADMIN];
const FUNCTION_OWNERS = Object.freeze({
  people: [ROLES.PEOPLE_CULTURE],
  hiring: [ROLES.PEOPLE_CULTURE],
  ops: [ROLES.OPERATIONS],
});
const MAX_AMOUNT = 1e10;

function requireAmount(value, label) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n >= MAX_AMOUNT || !Number.isInteger(n)) {
    throw new ValidationError(`"${label}" must be a whole number of EGP from 0 to 9,999,999,999.`);
  }
  return n;
}

function cleanNote(note) {
  if (note == null || note === '') return null;
  if (typeof note !== 'string' || note.length > 300) throw new ValidationError('"note" must be text of 300 characters or fewer.');
  return note.trim() || null;
}

function createBudgetService({ budgetRepository, audit }) {
  const canEditFunction = (role, functionId) => FULL_EDIT_ROLES.includes(role)
    || (FUNCTION_OWNERS[functionId] || []).includes(role);

  /* Saved amounts for the page: { lines: {name: {annual, seedAnnual}},
     plans: {functionId: {category: {plan: [12], seed: [12]}}} }. */
  function getState() {
    const lines = Object.fromEntries(budgetRepository.listLines(BUDGET_YEAR)
      .map((l) => [l.name, { annual: l.annual, seedAnnual: l.seedAnnual }]));
    const plans = {};
    for (const p of budgetRepository.listPlans(BUDGET_YEAR)) {
      plans[p.functionId] = plans[p.functionId] || {};
      const cat = plans[p.functionId][p.category] || { plan: Array(12).fill(0), seed: Array(12).fill(0) };
      cat.plan[p.month] = p.amount;
      cat.seed[p.month] = p.seedAmount;
      plans[p.functionId][p.category] = cat;
    }
    return { year: BUDGET_YEAR, lines, plans };
  }

  function updateLine({ actor, name, annual, note, ip }) {
    if (!FULL_EDIT_ROLES.includes(actor.role)) throw new AppError('Only the CEO or an admin can change P&L-line budgets.', 403);
    if (typeof name !== 'string' || !name || name.length > 100) throw new ValidationError('"name" must be a budget line name.');
    const value = requireAmount(annual, 'annual');
    const why = cleanNote(note);
    const row = budgetRepository.findLine(BUDGET_YEAR, name);
    if (!row) throw new AppError(`No budget line "${name}" for ${BUDGET_YEAR}.`, 404);
    if (row.annual === value) return { name, annual: value, unchanged: true }; // nothing to save or audit
    budgetRepository.updateLine(row.id, value, actor.id);
    audit.record({
      userId: actor.id,
      action: 'control_room.budget_line.update',
      entityType: 'control_room_budget_line',
      entityId: String(row.id),
      details: { year: BUDGET_YEAR, line: name, from: row.annual, to: value, note: why },
      ip,
    });
    return { name, annual: value };
  }

  function updatePlan({ actor, functionId, category, month, amount, note, ip }) {
    if (typeof functionId !== 'string' || !/^[a-z_]{1,30}$/.test(functionId)) throw new ValidationError('"functionId" is not a function.');
    if (typeof category !== 'string' || !category || category.length > 100) throw new ValidationError('"category" must be a plan category.');
    const m = Number(month);
    if (!Number.isInteger(m) || m < 0 || m > 11) throw new ValidationError('"month" must be 0 (January) to 11 (December).');
    if (!canEditFunction(actor.role, functionId)) {
      throw new AppError('You can only change the plan of the function you own.', 403);
    }
    const value = requireAmount(amount, 'amount');
    const why = cleanNote(note);
    const row = budgetRepository.findPlan(BUDGET_YEAR, functionId, category, m);
    if (!row) throw new AppError('No such plan cell.', 404);
    if (row.amount === value) return { functionId, category, month: m, amount: value, unchanged: true };
    budgetRepository.updatePlan(row.id, value, actor.id);
    audit.record({
      userId: actor.id,
      action: 'control_room.function_plan.update',
      entityType: 'control_room_function_plan',
      entityId: String(row.id),
      details: { year: BUDGET_YEAR, functionId, category, month: m, from: row.amount, to: value, note: why },
      ip,
    });
    return { functionId, category, month: m, amount: value };
  }

  return { getState, updateLine, updatePlan };
}

module.exports = createBudgetService;
