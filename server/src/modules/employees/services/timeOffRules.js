/* Pure, unit-testable functions — no DB, no req/res. Implements
   Time_off.pdf's notice-window and auto-reject rules (§1, §3's deadline
   summary), plus the one deduction the PDF marks as automatic ("System
   (auto)" in the breach table, §8). Everything else in that breach table
   (unauthorized-absence flagging, the sick-leave doctor's-note-to-unpaid
   conversion, team-conflict unpaid agreements) describes actions initiated
   by a manager/P&C *outside* the request-submission flow, not something
   this module auto-computes — see timeOffService for what's in scope this
   pass and what's deliberately deferred.

   Leave types: the PDF's 6 official types (planned, short_notice, sick,
   emergency, mental_health, public_holiday) plus 3 extra in-house types
   carried over from the old prototype (wfh, excuse, unpaid) that aren't in
   the PDF at all — per the decision to keep them, excuse/unpaid are mapped
   onto the closest official type's notice rule (excuse -> short_notice's
   1-day rule, unpaid -> planned's 3-day rule, matching the old app's own
   mapping); wfh has no notice-window rule of its own, only a monthly quota
   checked in timeOffService (it needs to query existing requests, not just
   do date math, so it doesn't belong in this pure-function module). */

// Egypt work week: Friday+Saturday weekend, Sunday-Thursday working —
// a fixed business assumption, not configurable, matching the old app.
function isWorkingDay(date) {
  const d = date.getDay(); // 0=Sun ... 5=Fri, 6=Sat
  return d !== 5 && d !== 6;
}

// EXCLUSIVE of `from` — "how many working days between submission and
// start" for notice-window checks. Submitting today for tomorrow (the
// PDF's own worked example, §3) must count as exactly 1.
function countWorkingDaysExclusive(from, to) {
  let count = 0;
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkingDay(cur)) count += 1;
  }
  return count;
}

// INCLUSIVE of both ends — for duration/day-count purposes (e.g. is this
// sick leave longer than 2 consecutive days).
function countWorkingDaysInclusive(start, end) {
  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cur <= stop) {
    if (isWorkingDay(cur)) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

const SAME_DAY_NOTICE_TYPES = new Set(['short_notice', 'mental_health', 'excuse']);
const MIN_3_DAY_NOTICE_TYPES = new Set(['planned', 'unpaid']);
// sick/emergency: no advance-notice rule at all, both are explicitly
// same-day-eligible in the PDF (§5, §6). public_holiday: "No request
// needed — automatic" (§1) — exempt from notice checks entirely. wfh:
// handled separately in timeOffService (monthly quota, not a date check).

const LEAVE_TYPE_LABELS = {
  planned: 'Planned Leave',
  short_notice: 'Short-Notice Leave',
  sick: 'Sick Leave',
  emergency: 'Emergency Leave',
  mental_health: 'Mental Health Day',
  public_holiday: 'Public Holiday',
  wfh: 'Work From Home',
  excuse: 'Excuse',
  unpaid: 'Unpaid Leave',
};

/* Determines whether a request should be auto-rejected purely from its
   notice window. Returns { autoReject: false } or
   { autoReject: true, reason, salaryDeduction }.
   submittedAt/startDate are JS Date objects (already parsed by the caller). */
function checkNoticeWindow({ leaveType, submittedAt, startDate }) {
  if (leaveType === 'sick' || leaveType === 'emergency' || leaveType === 'public_holiday' || leaveType === 'wfh') {
    return { autoReject: false };
  }

  const noticeWorkingDays = countWorkingDaysExclusive(submittedAt, startDate);

  if (SAME_DAY_NOTICE_TYPES.has(leaveType)) {
    if (noticeWorkingDays < 1) {
      return {
        autoReject: true,
        reason: `${LEAVE_TYPE_LABELS[leaveType]} must be submitted at least 1 full working day before. Same-day requests are not accepted per policy.`,
        /* Half-day deduction is explicitly automatic only for short_notice/
           mental_health — the PDF's breach table row 1 names exactly those
           two ("System (auto)"). Excuse isn't a PDF-defined type at all,
           so its deduction (if any) is left to P&C's manual judgement at
           confirmation time, not auto-applied here. */
        salaryDeduction: leaveType === 'excuse' ? 'none' : 'half_day',
      };
    }
    return { autoReject: false };
  }

  if (MIN_3_DAY_NOTICE_TYPES.has(leaveType)) {
    if (noticeWorkingDays < 3) {
      return {
        autoReject: true,
        reason: `${LEAVE_TYPE_LABELS[leaveType]} requires 3 working days notice. Only ${noticeWorkingDays} working day(s) notice given.`,
        salaryDeduction: 'none',
      };
    }
    return { autoReject: false };
  }

  return { autoReject: false };
}

/* Sick leave >2 consecutive (working) days needs a doctor's note within 2
   working days of return, per Time_off.pdf §6 — this only flags that the
   note will be required; whether one was actually submitted, and the
   resulting days-3+-unpaid conversion if not, is a manual P&C action (see
   timeOffService), not something computed from the request alone. */
function sickLeaveRequiresDoctorNote({ startDate, endDate }) {
  return countWorkingDaysInclusive(startDate, endDate) > 2;
}

module.exports = {
  isWorkingDay,
  countWorkingDaysExclusive,
  countWorkingDaysInclusive,
  checkNoticeWindow,
  sickLeaveRequiresDoctorNote,
  LEAVE_TYPE_LABELS,
};
