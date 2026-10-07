/* Control Room budgets — phase 3, the first edits the page saves. Owned by
   modules/management/ceo-dashboard.

   Only the amounts people type are stored; every total, pace and variance
   on the Budget tab is recomputed from them on the page.

   - control_room_budget_lines: the annual budget per P&L line ("Payroll",
     "Office & utilities", …). Changed by ceo/admin only.
   - control_room_function_plans: one row per function × category × month
     (month 0 = January). Changed by ceo/admin, or by the role that owns
     the function (people_culture: people + hiring; operations: ops) —
     enforced in the service, not just the page.

   Both are seeded once, for 2026, from the budget workbook figures the
   Control Room prototype carried (user decision 2026-10-05: seed, don't
   start empty). seed_* keeps that starting figure so the page can still
   show what has been changed from the workbook. Changes are audited
   (control_room.budget_line.update / control_room.function_plan.update);
   rows are never deleted. */
const sample = require('../../modules/management/ceo-dashboard/repositories/data/controlRoomSample.json');

const SEED_YEAR = 2026;

function up(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS control_room_budget_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        line_name TEXT NOT NULL,
        annual NUMERIC NOT NULL CHECK (annual >= 0),
        seed_annual NUMERIC NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL,
        UNIQUE (year, line_name)
      );

      CREATE TABLE IF NOT EXISTS control_room_function_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        function_id TEXT NOT NULL,
        category TEXT NOT NULL,
        month INTEGER NOT NULL CHECK (month BETWEEN 0 AND 11),
        amount NUMERIC NOT NULL CHECK (amount >= 0),
        seed_amount NUMERIC NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL,
        UNIQUE (year, function_id, category, month)
      );
    `);

    const now = new Date().toISOString();
    const insertLine = db.prepare(`
      INSERT OR IGNORE INTO control_room_budget_lines (year, line_name, annual, seed_annual, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const line of sample.budget.lines) insertLine.run(SEED_YEAR, line.name, line.annual, line.annual, now);

    const insertPlan = db.prepare(`
      INSERT OR IGNORE INTO control_room_function_plans (year, function_id, category, month, amount, seed_amount, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fn of sample.functions) {
      for (const cat of fn.categories) {
        cat.plan.forEach((amount, month) => insertPlan.run(SEED_YEAR, fn.id, cat.name, month, amount, amount, now));
      }
    }
  })();
}

module.exports = { up };
