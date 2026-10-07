/* control_room_budget_lines + control_room_function_plans (migration 041).
   Only SQL here. Rows are seeded by the migration and only ever updated. */
const db = require('../../../../db');

function listLines(year) {
  return db.prepare('SELECT * FROM control_room_budget_lines WHERE year = ? ORDER BY id').all(year).map((r) => ({
    id: r.id, name: r.line_name, annual: r.annual, seedAnnual: r.seed_annual, updatedBy: r.updated_by, updatedAt: r.updated_at,
  }));
}

function listPlans(year) {
  return db.prepare('SELECT * FROM control_room_function_plans WHERE year = ? ORDER BY function_id, category, month').all(year)
    .map((r) => ({
      id: r.id, functionId: r.function_id, category: r.category, month: r.month, amount: r.amount, seedAmount: r.seed_amount,
    }));
}

function findLine(year, name) {
  return db.prepare('SELECT id, annual FROM control_room_budget_lines WHERE year = ? AND line_name = ?').get(year, name) || null;
}

function findPlan(year, functionId, category, month) {
  return db.prepare(`
    SELECT id, amount FROM control_room_function_plans WHERE year = ? AND function_id = ? AND category = ? AND month = ?
  `).get(year, functionId, category, month) || null;
}

function updateLine(id, annual, userId) {
  db.prepare('UPDATE control_room_budget_lines SET annual = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(annual, userId, new Date().toISOString(), id);
}

function updatePlan(id, amount, userId) {
  db.prepare('UPDATE control_room_function_plans SET amount = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(amount, userId, new Date().toISOString(), id);
}

module.exports = { listLines, listPlans, findLine, findPlan, updateLine, updatePlan };
