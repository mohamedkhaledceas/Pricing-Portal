/* The employees module's exposed interface for the CEO Control Room's
   People blocks (modules/management/ceo-dashboard). Aggregates only —
   counts by department and employment type, joiners, people away — no
   names, no compensation, so nothing here widens who can see personal data.
   The caller gates the route (ceo/admin); this module has no opinion on who
   may call it, same as plannerExportService.

   Leave types that don't take a person out of work (wfh, a partial-day
   excuse) or that apply to everyone (public holidays) aren't "away". */
const NOT_AWAY_LEAVE_TYPES = Object.freeze(['wfh', 'excuse', 'public_holiday']);
const AWAY_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function createWorkforceSummaryService({ employeeRepository, leaveRequestRepository }) {
  /* today: YYYY-MM-DD, the caller's calendar date (Africa/Cairo for the
     dashboard) — leave dates are stored and compared as the same text form. */
  function getSummary({ today }) {
    const rows = employeeRepository.countActiveByDepartmentAndType();
    const byDepartment = new Map();
    let headcount = 0;
    let freelancers = 0;
    for (const r of rows) {
      headcount += r.n;
      if (r.employment_type === 'freelancer') freelancers += r.n;
      byDepartment.set(r.department, (byDepartment.get(r.department) || 0) + r.n);
    }
    const departments = [...byDepartment]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return {
      asOf: today,
      headcount,
      freelancers,
      departments,
      joinersYtd: employeeRepository.countActiveJoinedBetween(`${today.slice(0, 4)}-01-01`, today),
      awayDays: AWAY_WINDOW_DAYS,
      awayNext: leaveRequestRepository.countEmployeesAwayBetween({
        fromDate: today,
        toDate: addDays(today, AWAY_WINDOW_DAYS - 1),
        excludeTypes: [...NOT_AWAY_LEAVE_TYPES],
      }),
    };
  }

  return { getSummary };
}

module.exports = createWorkforceSummaryService;
