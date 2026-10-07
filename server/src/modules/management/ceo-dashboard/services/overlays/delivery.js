/* ClickUp delivery (management/delivery) laid over the Control Room payload. Pure. */
/* Delivery from the ClickUp copy (management/delivery, phase 5) —
   workspace-wide, so the same under every company view. Overdue tasks is
   live. On-time delivery and utilisation are marked "not measured"
   instead of showing the sample: on-time waits on the definition of
   "delivered", and nobody tracks time in ClickUp (0 hours logged). */
function applyDelivery(D, s) {
  D.deliveryLive = s;
  Object.assign(D.kpis.find((k) => k.id === 'overdue_tasks'), {
    live: true, actual: s.overdue, tolerance: null, source: 'ClickUp', drill: 'delivery_overdue',
    query: 'Open tasks in ClickUp\'s "Ceas Comm | Kitchen" space whose due date is before today',
    formula: `Includes ${s.stages.filter((x) => /client|rtp|approved/i.test(x.stage)).reduce((a, x) => a + x.overdue, 0)} tasks waiting on the client or ready to publish. Copied from ClickUp every 15 minutes.`,
  });
  const notMeasured = {
    on_time_delivery: 'Not measured yet: which ClickUp stage counts as "delivered" is waiting on a decision (tasks are closed in batches, so the close date doesn\'t show it).',
    utilisation: 'Not measured: nobody logs time in ClickUp (0 hours across 3,000 recent tasks), so there is no utilisation to show.',
  };
  for (const [id, why] of Object.entries(notMeasured)) {
    Object.assign(D.kpis.find((k) => k.id === id), { live: false, notMeasured: why, actual: null, target: null, source: 'Not measured', formula: why });
  }
  for (const id of ['overdue_tasks', 'on_time_delivery', 'utilisation']) {
    delete D.series[id];
    delete D.yearMap[id];
  }
  D.records.delivery_overdue = {
    columns: ['Task', 'Client', 'Stage', 'Due', 'Days late', 'Assigned to'],
    rows: s.overdueTasks.map((t) => [t.name, t.client || '—', t.status, t.dueDate, t.daysLate, t.assignees || '—']),
    source: 'ClickUp · Ceas Comm | Kitchen',
    note: `The ${s.overdueTasks.length} longest-overdue of ${s.overdue} open tasks past their due date.`,
  };
}

module.exports = { applyDelivery };
