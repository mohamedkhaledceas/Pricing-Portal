/* What the Control Room saves (phase 3): budgets, function plans, targets
   and hand-entered KPIs, laid over the payload. Pure. */
/* Saved budgets (budgetService, migration 041) replace the sample's
   P&L-line budgets and function plans; the seeds ride along so the page
   can mark what has been changed from the workbook. */
function applyBudgets(D, state) {
  for (const line of D.budget.lines) {
    const saved = state.lines[line.name];
    if (saved) Object.assign(line, { annual: saved.annual, seedAnnual: saved.seedAnnual });
  }
  for (const fn of D.functions) {
    for (const cat of fn.categories) {
      const saved = state.plans[fn.id] && state.plans[fn.id][cat.name];
      if (saved) Object.assign(cat, { plan: saved.plan, seedPlan: saved.seed });
    }
  }
  D.budgetSaved = true;
}

/* Saved targets for this view (targetService, migration 042) replace
   every KPI's target — they start empty, so a KPI with none saved shows
   "no target set" (user decision 2026-10-06). Hand-entered KPIs of this
   view are added as monitoring KPIs. Runs after the live overlays. */
const toCustomKpi = (c, target) => ({
  id: c.key,
  name: c.name,
  band: 'money',
  component: c.component,
  dept: 'exec',
  unit: c.unit,
  direction: c.direction,
  targetType: c.targetType,
  tolerance: c.targetType === 'exact' && target != null ? Math.max(Math.abs(target) * 0.05, 1) : null,
  agg: 'end_of_period',
  actual: c.actual,
  target,
  scored: false,
  drill: null,
  custom: true,
  source: 'Entered by hand',
  query: `Added on the Targets page on ${c.createdAt.slice(0, 10)}`,
  formula: 'Defined by hand; its actual is typed in, not read from Odoo or ClickUp.',
});

function applyTargets(D, state) {
  for (const k of D.kpis) k.target = state.targets[k.id] ?? null;
  for (const c of state.custom) D.kpis.push(toCustomKpi(c, state.targets[c.key] ?? null));
  D.targetsSaved = true;
}

module.exports = { applyBudgets, applyTargets };
