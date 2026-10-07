/* ClickUp pipeline and the employee roster laid over the Control Room payload. Pure. */
function applyPipeline(D, p) {
  D.pipeline = {
    ...D.pipeline,
    live: true,
    stages: p.open.map((s) => ({ name: s.name, count: s.count, value: s.count, prob: null })),
    openCount: p.open.reduce((sum, s) => sum + s.count, 0),
    quarters: p.quarters,
    stageDurations: p.stageDurations,
  };
}

function applyPeople(D, w) {
  D.people = {
    ...D.people,
    live: true,
    headcount: w.headcount,
    freelancers: w.freelancers,
    joinersYtd: w.joinersYtd,
    awayNext: w.awayNext,
    awayDays: w.awayDays,
    departments: w.departments,
  };
}

module.exports = { applyPipeline, applyPeople };
