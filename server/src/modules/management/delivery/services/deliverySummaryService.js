/* What the Control Room's Delivery page shows, from the ClickUp copy
   (migration 044): open work, overdue work (due before today, not closed),
   work by stage, by client and by person. Workspace-wide — ClickUp isn't
   split by company. Read-only. On-time delivery isn't here: which stage
   counts as "delivered" is awaiting a decision (tracker, phase 5). */
const { STAGE_ORDER } = require('../constants');

const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function createDeliverySummaryService({ deliveryRepository, now = () => new Date() }) {
  function getDeliverySummary() {
    const today = CAIRO_DATE.format(now());
    const weekEnd = addDays(today, 6);
    const totals = deliveryRepository.countOpen(today, weekEnd);
    const rank = (stage) => { const i = STAGE_ORDER.indexOf(stage); return i === -1 ? STAGE_ORDER.length : i; };
    const stages = deliveryRepository.openByStage(today)
      .sort((a, b) => rank(a.stage) - rank(b.stage) || b.open - a.open)
      .map((s) => ({ stage: titleCase(s.stage), open: s.open, overdue: s.overdue || 0 }));
    const daysLate = (due) => (due ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 864e5) : null);
    return {
      asOf: today,
      sync: deliveryRepository.getSyncState(),
      open: totals.open || 0,
      overdue: totals.overdue || 0,
      dueThisWeek: totals.dueThisWeek || 0,
      noDueDate: totals.noDueDate || 0,
      unassigned: deliveryRepository.countUnassignedOpen(today),
      stages,
      byClient: deliveryRepository.openByClient(today).map((c) => ({
        client: c.client || 'No client set', open: c.open, overdue: c.overdue || 0, withClient: c.withClient || 0,
        oldestOverdueDays: daysLate(c.oldestOverdue),
      })),
      byPerson: deliveryRepository.openByPerson(today, weekEnd).map((p) => ({
        name: p.name, open: p.open, overdue: p.overdue || 0, dueThisWeek: p.dueThisWeek || 0,
      })),
      overdueTasks: deliveryRepository.listOverdue(today, 25).map((t) => ({ ...t, daysLate: daysLate(t.dueDate) })),
    };
  }

  return { getDeliverySummary };
}

module.exports = createDeliverySummaryService;
