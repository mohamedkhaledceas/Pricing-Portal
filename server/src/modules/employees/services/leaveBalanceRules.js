/* Pure, unit-testable functions — no DB, no req/res. Fixed company-wide
   leave-balance constants (not configurable, not prorated by joining_date —
   see the plan's "no new database table" rationale): 21 days/year splits
   into 14 Planned + 7 combined Emergency/Mental Health/Short-Notice, plus
   two separate monthly quotas (WFH days, Excuse hours). Sick/Unpaid/
   Public Holiday are deliberately uncapped and untracked here. */

const ANNUAL_PLANNED_DAYS = 14;
const ANNUAL_COMBINED_DAYS = 7;
const MONTHLY_WFH_DAYS = 1;
const MONTHLY_EXCUSE_HOURS = 4;

const COMBINED_TYPES = new Set(['emergency', 'mental_health', 'short_notice']);

const BUCKET_LABELS = {
  planned: 'Planned Leave',
  combined: 'Emergency / Mental Health / Short-Notice Leave',
  wfh: 'Work From Home',
  excuse: 'Excuse',
};

// null for sick/unpaid/public_holiday — uncapped, no balance tracked.
function bucketForType(leaveType) {
  if (leaveType === 'planned') return 'planned';
  if (COMBINED_TYPES.has(leaveType)) return 'combined';
  if (leaveType === 'wfh') return 'wfh';
  if (leaveType === 'excuse') return 'excuse';
  return null;
}

// partial_day counts as half a day; full_day/unavailable both count as a
// full day (they differ only in reachability, not duration).
function dayCountForRequest(row, countWorkingDaysInclusive) {
  const base = countWorkingDaysInclusive(new Date(`${row.start_date}T00:00:00`), new Date(`${row.end_date}T00:00:00`));
  return row.availability === 'partial_day' ? base / 2 : base;
}

/* requests: raw leave_requests rows (snake_case, as returned by
   leaveRequestRepository). Only status === 'approved' rows count (per the
   user's decision — pending/manager_approved requests don't reduce the
   displayed balance yet). Annual pools reset per calendar year, monthly
   pools per calendar month; a request is bucketed by its start_date only
   (a request spanning a year/month boundary isn't split). */
function computeBalances(requests, { today, countWorkingDaysInclusive }) {
  const year = today.getFullYear();
  const yearMonth = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  let plannedUsed = 0;
  let combinedUsed = 0;
  let wfhUsed = 0;
  let excuseUsedHours = 0;

  requests.forEach((row) => {
    if (row.status !== 'approved') return;
    const startYear = row.start_date.slice(0, 4);
    const startYearMonth = row.start_date.slice(0, 7);

    if (row.leave_type === 'planned' && startYear === String(year)) {
      plannedUsed += dayCountForRequest(row, countWorkingDaysInclusive);
    } else if (COMBINED_TYPES.has(row.leave_type) && startYear === String(year)) {
      combinedUsed += dayCountForRequest(row, countWorkingDaysInclusive);
    } else if (row.leave_type === 'wfh' && startYearMonth === yearMonth) {
      wfhUsed += 1;
    } else if (row.leave_type === 'excuse' && startYearMonth === yearMonth) {
      excuseUsedHours += 1;
    }
  });

  return {
    year,
    month: today.getMonth() + 1,
    planned: {
      label: BUCKET_LABELS.planned, used: plannedUsed, total: ANNUAL_PLANNED_DAYS,
      remaining: ANNUAL_PLANNED_DAYS - plannedUsed, unit: 'days', period: 'year',
    },
    combined: {
      label: BUCKET_LABELS.combined, used: combinedUsed, total: ANNUAL_COMBINED_DAYS,
      remaining: ANNUAL_COMBINED_DAYS - combinedUsed, unit: 'days', period: 'year',
    },
    wfh: {
      label: BUCKET_LABELS.wfh, used: wfhUsed, total: MONTHLY_WFH_DAYS,
      remaining: MONTHLY_WFH_DAYS - wfhUsed, unit: 'days', period: 'month',
    },
    excuse: {
      label: BUCKET_LABELS.excuse, used: excuseUsedHours, total: MONTHLY_EXCUSE_HOURS,
      remaining: MONTHLY_EXCUSE_HOURS - excuseUsedHours, unit: 'hours', period: 'month',
    },
  };
}

module.exports = {
  ANNUAL_PLANNED_DAYS,
  ANNUAL_COMBINED_DAYS,
  MONTHLY_WFH_DAYS,
  MONTHLY_EXCUSE_HOURS,
  COMBINED_TYPES,
  BUCKET_LABELS,
  bucketForType,
  computeBalances,
};
