/* Pure, unit-testable functions — no DB, no req/res. Fixed company-wide
   leave-balance constants (not configurable, not prorated by joining_date —
   see the plan's "no new database table" rationale): 21 days/year splits
   into 14 Planned + 7 combined Emergency/Mental Health/Short-Notice, plus
   two separate monthly quotas (WFH days, Excuse hours). Sick/Unpaid are
   deliberately uncapped (tracked as a running total, no total/remaining —
   see computeBalances' own comment) and Public Holiday isn't tracked at
   all (automatic, no request needed). */

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
  sick: 'Sick Leave',
  unpaid: 'Unpaid Leave',
};

// Which key in computeBalances' return value a leave type's own usage
// lives under. null only for public_holiday, which has no request-driven
// balance at all (see timeOffService.listPcPending's leaveTypeUsage,
// which uses this to show the specific type a pending request is for,
// not a fixed set of buckets regardless of type).
function bucketForType(leaveType) {
  if (leaveType === 'planned') return 'planned';
  if (COMBINED_TYPES.has(leaveType)) return 'combined';
  if (leaveType === 'wfh') return 'wfh';
  if (leaveType === 'excuse') return 'excuse';
  if (leaveType === 'sick') return 'sick';
  if (leaveType === 'unpaid') return 'unpaid';
  return null;
}

// balances: a computeBalances() result. Returns just the one bucket this
// leaveType draws from (capped, with total/remaining — or sick/unpaid,
// uncapped, used only), or null for public_holiday.
function usageForLeaveType(balances, leaveType) {
  const key = bucketForType(leaveType);
  return key ? balances[key] : null;
}

// partial_day counts as half a day; full_day/unavailable both count as a
// full day (they differ only in reachability, not duration).
function dayCountForRequest(row, countWorkingDaysInclusive) {
  const base = countWorkingDaysInclusive(new Date(`${row.start_date}T00:00:00`), new Date(`${row.end_date}T00:00:00`));
  return row.availability === 'partial_day' ? base / 2 : base;
}

// Same rule as dayCountForRequest above, for a request already mapped to
// camelCase (leaveRequestModel.toLeaveRequest's shape) rather than a raw
// DB row — used by timeOffService to show managers/P&C the number of
// days a *pending* request represents, matching what it will actually
// count against balance once approved.
function requestedDaysFor({ startDate, endDate, availability }, countWorkingDaysInclusive) {
  const base = countWorkingDaysInclusive(new Date(`${startDate}T00:00:00`), new Date(`${endDate}T00:00:00`));
  return availability === 'partial_day' ? base / 2 : base;
}

// Sick leave is uncapped by default — UNLESS it already requires a doctor's
// note (over 2 consecutive working days, per timeOffRules'
// sickLeaveRequiresDoctorNote) and P&C confirmed none was provided
// (doctor_note_provided = 0). That case draws from the same 7-day combined
// pool Emergency/Mental Health/Short-Notice already share, not a pool of
// its own. Short sick leave (<=2 days) always stays free, regardless of
// doctor_note_provided, since it never required a note in the first place.
function sickCountsAgainstCombined(row, sickLeaveRequiresDoctorNote) {
  if (row.leave_type !== 'sick') return false;
  const requiresNote = sickLeaveRequiresDoctorNote({
    startDate: new Date(`${row.start_date}T00:00:00`),
    endDate: new Date(`${row.end_date}T00:00:00`),
  });
  return requiresNote && !row.doctor_note_provided;
}

/* requests: raw leave_requests rows (snake_case, as returned by
   leaveRequestRepository). Only status === 'approved' rows count (per the
   user's decision — pending/manager_approved requests don't reduce the
   displayed balance yet). Annual pools reset per calendar year, monthly
   pools per calendar month; a request is bucketed by its start_date only
   (a request spanning a year/month boundary isn't split). */
function computeBalances(requests, { today, countWorkingDaysInclusive, sickLeaveRequiresDoctorNote }) {
  const year = today.getFullYear();
  const yearMonth = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  let plannedUsed = 0;
  let combinedUsed = 0;
  let wfhUsed = 0;
  let excuseUsedHours = 0;
  let sickUsed = 0;
  let unpaidUsed = 0;

  requests.forEach((row) => {
    if (row.status !== 'approved') return;
    const startYear = row.start_date.slice(0, 4);
    const startYearMonth = row.start_date.slice(0, 7);
    if (startYear !== String(year)) return;

    if (row.leave_type === 'planned') {
      plannedUsed += dayCountForRequest(row, countWorkingDaysInclusive);
    } else if (COMBINED_TYPES.has(row.leave_type) || sickCountsAgainstCombined(row, sickLeaveRequiresDoctorNote)) {
      combinedUsed += dayCountForRequest(row, countWorkingDaysInclusive);
    } else if (row.leave_type === 'wfh' && startYearMonth === yearMonth) {
      wfhUsed += 1;
    } else if (row.leave_type === 'excuse' && startYearMonth === yearMonth) {
      excuseUsedHours += 1;
    }

    // Sick/unpaid are uncapped (no total/remaining, unlike the branches
    // above), so this is tracked separately from them, not instead of them:
    // a long sick leave with no doctor's note still both counts here (total
    // sick days taken) *and* draws from the combined pool above
    // (sickCountsAgainstCombined) — the two are orthogonal, not exclusive.
    if (row.leave_type === 'sick') {
      sickUsed += dayCountForRequest(row, countWorkingDaysInclusive);
    } else if (row.leave_type === 'unpaid') {
      unpaidUsed += dayCountForRequest(row, countWorkingDaysInclusive);
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
    // No total/remaining — uncapped, unlike the four buckets above. Their
    // absence here (rather than null) is the signal the frontend uses to
    // render "X taken" instead of "X/Y remaining" (see overview.js's
    // uncappedBalanceRow vs balanceRow).
    sick: { label: BUCKET_LABELS.sick, used: sickUsed, unit: 'days', period: 'year' },
    unpaid: { label: BUCKET_LABELS.unpaid, used: unpaidUsed, unit: 'days', period: 'year' },
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
  usageForLeaveType,
  requestedDaysFor,
  computeBalances,
};
