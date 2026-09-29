// Requests Center — Portal §21. Gathers what used to be scattered across
// three places: the employee's own leave history (was Time Off > My
// History, now retired), the employee's own profile-change status (was
// only a one-line "awaiting approval" banner in Account Settings, with no
// history at all), and every approval queue that used to live on "My
// Team" (Pending My Decision / All Requests / Pending P&C Confirmation /
// Pending Profile Changes) — moved here verbatim, not duplicated. "My
// Team" keeps only the team-member/org info now (see team.js).
import { $, escapeHtml, fmtDate, fmtDateTime, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { LEAVE_TYPES, leaveTypeLabel, availabilityLabel, STATUS_LABELS } from './leaveTypes.js';

// Own copy of the directory index — same reasoning team.js/teamsDirectory.js/
// timeOff.js each already give for their own copy: independent per-module
// fetches, not a shared cache, so no cross-module coupling.
let directoryById = {};
async function loadDirectoryIndex() {
  const res = await apiFetch('/api/employees/directory');
  const employees = res.employees || [];
  directoryById = {};
  employees.forEach((e) => { directoryById[e.id] = e; });
  return employees;
}
function nameFor(employeeId) {
  const e = directoryById[employeeId];
  return e ? `${e.firstName} ${e.lastName}` : `Employee #${employeeId}`;
}

// ── Shared display helpers (moved verbatim from team.js) ───────────────
function conflictWarningHtml(r) {
  if (!r.conflictWarnings || !r.conflictWarnings.length) return '';
  return r.conflictWarnings.map((w) => `
    <div class="request-card-conflict">
      ⚠ Conflict pair ${escapeHtml(w.partnerName)}: ${escapeHtml((STATUS_LABELS[w.status] || w.status).toLowerCase())}
      ${escapeHtml(leaveTypeLabel(w.leaveType))} ${fmtDate(w.startDate)}${w.endDate !== w.startDate ? ' → ' + fmtDate(w.endDate) : ''}
    </div>`).join('');
}

function noManagerFlagHtml(r) {
  if (r.status !== 'manager_approved' || r.managerDecisionBy || !r.managerDecisionNote) return '';
  return `<div class="request-card-conflict">⚠ ${escapeHtml(r.managerDecisionNote)}</div>`;
}

// A request the employee cancelled themselves (still status='cancelled',
// cancel_actor_role='employee') and that originated as an auto-reject is
// waiting on a manager/P&C call — reject-and-deduct instead, or nothing
// (see managerHrOverrideActions below; there's no "confirm" endpoint,
// leaving it cancelled already is the confirmation). Flagged here too so
// it's visible without opening "View activity".
function awaitingRejectionConfirmationHtml(r) {
  if (r.status !== 'cancelled' || r.cancelActorRole !== 'employee' || !r.autoRejectReason) return '';
  return `<div class="request-card-conflict">⚠ ${escapeHtml(nameFor(r.employeeId))} cancelled this themselves after it was auto-rejected — confirm they didn't actually work, or reject it with a deduction if they didn't.</div>`;
}

function lateWfhWarningHtml(r) {
  if (!r.wfhSubmittedLate) return '';
  return `<div class="request-card-conflict">⚠ Submitted at ${escapeHtml(fmtDateTime(r.createdAt))} — after 9:00 AM for a same-day WFH request. A deduction should be applied.</div>`;
}

// WFH over the monthly quota is no longer auto-rejected (2026-09-29) — it
// takes the normal workflow instead, and P&C sees it flagged here so they
// can decide (deduction, one-off exception, etc.) with full context.
// wfhRequestsThisMonth includes this request itself (see timeOffService's
// listPcPending); leaveTypeUsage.total is the same MONTHLY_WFH_DAYS limit
// leaveTypeUsageHtml already reads for WFH, reused rather than duplicated.
function wfhOverQuotaWarningHtml(r) {
  if (r.leaveType !== 'wfh' || !r.wfhRequestsThisMonth || !r.leaveTypeUsage) return '';
  if (r.wfhRequestsThisMonth <= r.leaveTypeUsage.total) return '';
  return `<div class="request-card-conflict">⚠ This is their ${escapeHtml(String(r.wfhRequestsThisMonth))}${ordinalSuffix(r.wfhRequestsThisMonth)} Work From Home request this month — the policy limit is ${escapeHtml(String(r.leaveTypeUsage.total))}.</div>`;
}

function ordinalSuffix(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'st';
  if (n % 10 === 2 && n % 100 !== 12) return 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return 'rd';
  return 'th';
}

function leaveTypeUsageHtml(r) {
  const u = r.leaveTypeUsage;
  if (!u) return '';
  const unitSuffix = u.unit === 'hours' ? 'h' : '';
  const periodText = u.period === 'month' ? 'this month' : 'this year';
  const text = u.total != null
    ? `${escapeHtml(u.label)}: ${escapeHtml(String(u.used))}/${escapeHtml(String(u.total))}${unitSuffix} used ${periodText}`
    : `${escapeHtml(u.label)} taken ${periodText}: ${escapeHtml(String(u.used))} day${u.used === 1 ? '' : 's'}`;
  return `<div class="request-card-meta">${text}</div>`;
}

function fmtDays(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtDayOfWeek(value) {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short' });
}

function requestCard(r, actionsHtml, extraWarningHtml) {
  const isMultiDay = r.endDate !== r.startDate;
  const dateRangeHtml = `${fmtDate(r.startDate)}${isMultiDay ? ' → ' + fmtDate(r.endDate) : ''}`;
  const dayOfWeekHtml = `${fmtDayOfWeek(r.startDate)}${isMultiDay ? ' → ' + fmtDayOfWeek(r.endDate) : ''}`;
  return `<div class="request-card" id="team-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(nameFor(r.employeeId))}</div>
        <div class="request-card-meta">${escapeHtml(leaveTypeLabel(r.leaveType))} · ${dateRangeHtml}, ${escapeHtml(dayOfWeekHtml)}${r.availability ? ' (' + escapeHtml(availabilityLabel(r.availability)) + ')' : (r.halfDay ? ' (half-day)' : '')}${r.requestedDays != null ? ` · ${escapeHtml(fmtDays(r.requestedDays))} day${r.requestedDays === 1 ? '' : 's'}` : ''}</div>
      </div>
      <span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span>
    </div>
    ${r.reason ? `<div class="request-card-reason">${escapeHtml(r.reason)}</div>` : ''}
    ${conflictWarningHtml(r)}
    ${noManagerFlagHtml(r)}
    ${extraWarningHtml || ''}
    ${actionsHtml || ''}
  </div>`;
}

// Native window.confirm()/prompt() blocks the whole tab — a reject comment
// is captured via this same inline reveal-a-form pattern the rest of the
// app already uses, not a prompt().
let rejectingId = null;

function askReject(id) {
  rejectingId = id;
  renderRequestsCenter();
}

function cancelReject() {
  rejectingId = null;
  renderRequestsCenter();
}

async function managerDecide(id, decision, btn) {
  const card = $('#team-card-' + id);
  let decisionNote;
  if (decision === 'rejected') {
    decisionNote = (card && card.querySelector('.reject-note') ? card.querySelector('.reject-note').value : '').trim();
    if (!decisionNote) {
      toast('A comment is required to reject.', 'danger');
      return;
    }
  }
  btn.closest('.request-card-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/manager-decision`, { method: 'PATCH', body: JSON.stringify({ decision, decisionNote }) });
    toast(decision === 'approved' ? 'Approved' : 'Rejected', 'info');
    rejectingId = null;
    renderRequestsCenter();
  } catch (err) {
    toast(err.message, 'danger');
    renderRequestsCenter();
  }
}

async function pcConfirm(id, decision) {
  const card = $('#team-card-' + id);
  const deductionSel = card ? card.querySelector('.pc-deduction') : null;
  const salaryDeduction = deductionSel ? deductionSel.value : 'none';
  const unpaidInput = card ? card.querySelector('.pc-unpaid-days') : null;
  const doctorNoteCheckbox = card ? card.querySelector('.pc-doctor-note') : null;
  const doctorNoteProvided = doctorNoteCheckbox ? doctorNoteCheckbox.checked : undefined;
  let decisionNote;
  if (decision === 'rejected') {
    decisionNote = (card && card.querySelector('.reject-note') ? card.querySelector('.reject-note').value : '').trim();
    if (!decisionNote) {
      toast('A comment is required to reject.', 'danger');
      return;
    }
  }
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/pc-confirm`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, decisionNote, salaryDeduction, unpaidDaysCount: unpaidInput ? Number(unpaidInput.value) || undefined : undefined, doctorNoteProvided }),
    });
    toast(decision === 'approved' ? 'Confirmed' : 'Rejected', 'info');
    rejectingId = null;
    renderRequestsCenter();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

// confirmKind selects which decide function the delegated handler calls on
// "Confirm Reject" — 'manager' -> managerDecide(id,'rejected',btn), 'pc' ->
// pcConfirm(id,'rejected') (no btn arg needed there).
function rejectNoteForm(id, confirmKind) {
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    <textarea class="form-control reject-note" placeholder="Reason for rejecting (required)" rows="2" style="width:100%;"></textarea>
    <button class="btn danger small" data-req-action="confirm-reject" data-reject-kind="${confirmKind}" data-request-id="${id}">Confirm Reject</button>
    <button class="btn small" data-req-action="cancel-reject">Cancel</button>
  </div>`;
}

function managerActions(r) {
  if (r.status !== 'pending') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, 'manager');
  return `<div class="request-card-actions">
    <button class="btn primary small" data-req-action="manager-approve" data-request-id="${r.id}">✓ Approve</button>
    <button class="btn danger small" data-req-action="ask-reject" data-request-id="${r.id}">✕ Reject</button>
  </div>`;
}

// Human-readable labels for the raw field keys stored in a change
// request's JSON diff (see rosterService.updateMine) — same field set as
// Account Settings' Work Details section.
const CHANGE_FIELD_LABELS = {
  jobTitle: 'Job Title',
  department: 'Department',
  employmentType: 'Employment Type',
  joiningDate: 'Joining Date',
  workLocation: 'Work Location',
  managerEmployeeId: 'Manager',
};

function formatChangeValue(field, value) {
  if (field === 'department') return window.Departments.labelFor(value);
  if (field === 'workLocation') return (window.OrgConstants.WORK_LOCATION_LABELS[value] || value);
  if (field === 'employmentType') return (window.OrgConstants.EMPLOYMENT_TYPE_LABELS[value] || value);
  if (field === 'managerEmployeeId') return nameFor(value);
  return value;
}

function changeRequestDiffHtml(changes) {
  return Object.keys(changes).map((field) =>
    `<div>${escapeHtml(CHANGE_FIELD_LABELS[field] || field)}: <strong>${escapeHtml(String(formatChangeValue(field, changes[field])))}</strong></div>`
  ).join('');
}

function changeRequestCard(r) {
  return `<div class="request-card" id="change-request-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(r.employeeName)}</div>
        <div class="request-card-meta">Requested profile change</div>
      </div>
      <span class="badge badge-pending">Pending</span>
    </div>
    <div class="request-card-reason">${changeRequestDiffHtml(r.changes)}</div>
    <div class="request-card-actions">
      <button class="btn primary small" data-req-action="profile-change-approve" data-request-id="${r.id}">✓ Approve</button>
      <button class="btn danger small" data-req-action="profile-change-reject" data-request-id="${r.id}">✕ Reject</button>
    </div>
  </div>`;
}

async function profileChangeDecide(id, decision, btn) {
  btn.closest('.request-card-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await apiFetch(`/api/employees/profile-change-requests/${id}/${decision}`, { method: 'PATCH', body: JSON.stringify({}) });
    toast(decision === 'approve' ? 'Approved' : 'Rejected', 'info');
    renderRequestsCenter();
  } catch (err) {
    toast(err.message, 'danger');
    renderRequestsCenter();
  }
}

function doctorNoteCheckboxHtml(r) {
  if (r.leaveType !== 'sick' || !r.requiresDoctorNote) return '';
  return `<label class="small" style="display:flex;align-items:center;gap:6px;">
    <input type="checkbox" class="pc-doctor-note"> Doctor's note provided
  </label>`;
}

function pcActions(r) {
  if (r.status !== 'manager_approved') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, 'pc');
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    ${doctorNoteCheckboxHtml(r)}
    <select class="form-control pc-deduction" style="width:auto;">
      <option value="none">No deduction</option>
      <option value="half_day">Half-day deduction</option>
      <option value="full_day">Full-day deduction</option>
      <option value="unpaid">Unpaid</option>
    </select>
    <input type="number" class="form-control pc-unpaid-days" placeholder="Unpaid days" style="width:110px;" min="0">
    <button class="btn primary small" data-req-action="pc-approve" data-request-id="${r.id}">✓ Confirm</button>
    <button class="btn danger small" data-req-action="ask-reject" data-request-id="${r.id}">✕ Reject</button>
  </div>`;
}

// Manager/P&C override actions for a request the requester can no longer
// touch themselves — see timeOffService.managerHrCancel/
// managerHrConfirmRejection. `canAct` is this employee's direct manager or
// P&C (identity check mirrors managerDecision's own — no role bypass).
let overrideCancelConfirmId = null;
let confirmingRejectionId = null;

function askOverrideCancel(id) {
  overrideCancelConfirmId = id;
  renderRequestsCenter();
}

function cancelOverrideCancel() {
  overrideCancelConfirmId = null;
  renderRequestsCenter();
}

async function overrideCancel(id) {
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/manager-hr-cancel`, { method: 'POST', body: JSON.stringify({}) });
    toast('Request cancelled', 'info');
    overrideCancelConfirmId = null;
    renderRequestsCenter();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function askConfirmRejection(id) {
  confirmingRejectionId = id;
  renderRequestsCenter();
}

function cancelConfirmRejection() {
  confirmingRejectionId = null;
  renderRequestsCenter();
}

async function confirmRejection(id) {
  const card = $('#team-card-' + id);
  const note = (card && card.querySelector('.confirm-rejection-note') ? card.querySelector('.confirm-rejection-note').value : '').trim();
  if (!note) {
    toast('A comment is required to confirm the rejection.', 'danger');
    return;
  }
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/confirm-rejection`, { method: 'PATCH', body: JSON.stringify({ decisionNote: note }) });
    toast('Rejected — deduction stands', 'info');
    confirmingRejectionId = null;
    renderRequestsCenter();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

const MANAGER_HR_CANCELLABLE_STATUSES = ['approved', 'auto_rejected'];

function managerHrOverrideActions(r, canAct) {
  if (!canAct) return '';

  // Awaiting a call on a self-cancelled auto-reject takes priority over
  // the plain cancel action below — a 'cancelled' row is never in
  // MANAGER_HR_CANCELLABLE_STATUSES anyway (it's already cancelled), so
  // these two branches never overlap on the same request.
  const canConfirmRejection = r.status === 'cancelled' && r.cancelActorRole === 'employee' && !!r.autoRejectReason;
  if (canConfirmRejection) {
    if (confirmingRejectionId === r.id) {
      return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
        <textarea class="form-control confirm-rejection-note" placeholder="Why this stays rejected (required)" rows="2" style="width:100%;"></textarea>
        <button class="btn danger small" data-req-action="confirm-rejection-submit" data-request-id="${r.id}">Confirm Rejected (deduct)</button>
        <button class="btn small" data-req-action="cancel-confirm-rejection">Cancel</button>
      </div>`;
    }
    return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
      <span class="small muted">Already final unless they didn't actually work.</span>
      <button class="btn danger small" data-req-action="ask-confirm-rejection" data-request-id="${r.id}">Reject instead (apply deduction)</button>
    </div>`;
  }

  if (!MANAGER_HR_CANCELLABLE_STATUSES.includes(r.status)) return '';
  if (overrideCancelConfirmId === r.id) {
    return `<div class="request-card-actions">
      <span class="small">Cancel this request? </span>
      <button class="btn small danger" data-req-action="override-cancel-confirm" data-request-id="${r.id}">Yes</button>
      <button class="btn small" data-req-action="override-cancel-cancel">No</button>
    </div>`;
  }
  return `<div class="request-card-actions">
    <button class="btn small" data-req-action="ask-override-cancel" data-request-id="${r.id}">Cancel request</button>
  </div>`;
}

// ── My Requests — unified own history (leave + profile changes) ────────
// The one genuinely new capability here: nothing before this combined
// both request types into a single, searchable/filterable, timestamped
// list. Merged and filtered entirely client-side (both source lists are
// already scoped to "mine" server-side, and this app's per-employee
// request volume is tiny — no pagination/server-side search needed).
let myRequestsCache = [];
let confirmingCancelId = null;

// Generic (not leave-specific) status wording for a profile-change
// request — STATUS_LABELS' own "Pending (manager)" etc. is leave-specific
// phrasing (a profile change can be reviewed by admin/manager/P&C, not
// only a manager).
const CHANGE_STATUS_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

function statusLabelFor(item) {
  if (item.kind === 'profile_change') return CHANGE_STATUS_LABELS[item.status] || item.status;
  return STATUS_LABELS[item.status] || item.status;
}

function categoryLabelFor(item) {
  return item.kind === 'profile_change' ? 'Profile Change' : leaveTypeLabel(item.leaveType);
}

// A request's own lifecycle, in order — "Activity / history log" (Portal
// §21), shown per-request rather than as one separate feed, since every
// event needed is already sitting right there on the request/change-
// request row (no new table, nothing extra to fetch).
function cancelledEventHtml(item) {
  const actorLabel = item.cancelActorRole === 'employee' ? 'by the requester'
    : item.cancelActorRole === 'people_culture' ? 'by People &amp; Culture'
    : item.cancelActorRole === 'manager' ? 'by manager' : '';
  const actorName = item.cancelledBy && item.cancelActorRole !== 'employee' ? ` — ${escapeHtml(nameFor(item.cancelledBy))}` : '';
  return `<strong>Cancelled</strong> ${actorLabel}${actorName}, ${escapeHtml(fmtDateTime(item.cancelledAt))}${item.cancelReason ? `: ${escapeHtml(item.cancelReason)}` : ''}`;
}

// Events are collected with their own timestamp and sorted, rather than
// pushed in a fixed assumed order — a self-cancel of an auto-rejected
// request (cancelledAt) can later be reversed back to 'rejected'
// (managerDecisionAt/pcConfirmedAt moving to AFTER cancelledAt, see
// managerHrConfirmRejection), which a fixed Submitted->Auto-
// reject->Manager->P&C->Cancelled order can't represent correctly; a plain
// manager/P&C override-cancel of an approved request needs Cancelled to
// land AFTER those decisions instead. Array.prototype.sort is stable, so
// same-instant ties (Submitted vs. an auto-reject computed at submission
// time) keep their push order.
function timelineHtml(item) {
  const events = [{ at: item.createdAt, html: `<strong>Submitted</strong> — ${escapeHtml(fmtDateTime(item.createdAt))}` }];
  if (item.kind === 'leave') {
    if (item.autoRejectReason) {
      events.push({ at: item.createdAt, html: `<strong>Auto-rejected</strong> — ${escapeHtml(item.autoRejectReason)}` });
    }
    if (item.cancelledAt) {
      events.push({ at: item.cancelledAt, html: cancelledEventHtml(item) });
    }
    if (item.managerDecisionAt && item.managerDecisionBy) {
      const verb = item.managerDecisionNote && item.status === 'rejected' && !item.pcConfirmedAt ? 'Rejected' : 'Approved';
      events.push({ at: item.managerDecisionAt, html: `<strong>${verb} by manager</strong> — ${escapeHtml(nameFor(item.managerDecisionBy))}, ${escapeHtml(fmtDateTime(item.managerDecisionAt))}${item.managerDecisionNote ? `: ${escapeHtml(item.managerDecisionNote)}` : ''}` });
    } else if (item.managerDecisionNote) {
      // No manager_decision_by — this is the "no manager assigned, routed
      // straight to P&C" auto-route (submit()'s skippedManagerStage), not a
      // real human decision. manager_decision_at is still set (same repo
      // call as a real decision), so it can't be used to tell the two
      // apart — managerDecisionBy is the only reliable signal, and without
      // this check nameFor(null) rendered "Employee #null" here.
      events.push({ at: item.managerDecisionAt, html: `<strong>Manager stage skipped</strong> — ${escapeHtml(fmtDateTime(item.managerDecisionAt))}: ${escapeHtml(item.managerDecisionNote)}` });
    }
    if (item.pcConfirmedAt) {
      const verb = item.status === 'rejected' ? 'Rejected' : 'Confirmed';
      events.push({ at: item.pcConfirmedAt, html: `<strong>${verb} by People &amp; Culture</strong> — ${escapeHtml(nameFor(item.pcConfirmedBy))}, ${escapeHtml(fmtDateTime(item.pcConfirmedAt))}${item.pcDecisionNote ? `: ${escapeHtml(item.pcDecisionNote)}` : ''}` });
    }
  } else if (item.status !== 'pending') {
    events.push({ at: item.updatedAt, html: `<strong>${escapeHtml(CHANGE_STATUS_LABELS[item.status] || item.status)} by ${escapeHtml(item.reviewedByName || 'reviewer')}</strong> — ${escapeHtml(fmtDateTime(item.updatedAt))}${item.decisionNote ? `: ${escapeHtml(item.decisionNote)}` : ''}` });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return events.map((e) => `<div>${e.html}</div>`).join('');
}

function myRequestToggleTimeline(rowId) {
  const detail = document.getElementById('my-request-timeline-' + rowId);
  if (!detail) return;
  const wasHidden = detail.hidden;
  document.querySelectorAll('[id^="my-request-timeline-"]').forEach((d) => { d.hidden = true; });
  detail.hidden = !wasHidden;
}

async function cancelMyRequest(id) {
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/cancel`, { method: 'POST' });
    toast('Request cancelled', 'info');
    confirmingCancelId = null;
    renderRequestsCenter();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function askCancelMyRequest(id) {
  confirmingCancelId = id;
  filterMyRequests();
}

function cancelCancelMyRequest() {
  confirmingCancelId = null;
  filterMyRequests();
}

function myRequestRowHtml(item) {
  const rowId = `${item.kind}-${item.id}`;
  const dateHtml = item.kind === 'leave'
    ? (() => {
      const isMultiDay = item.endDate !== item.startDate;
      const dateRange = `${fmtDate(item.startDate)}${isMultiDay ? ' → ' + fmtDate(item.endDate) : ''}`;
      const dayOfWeek = `${fmtDayOfWeek(item.startDate)}${isMultiDay ? ' → ' + fmtDayOfWeek(item.endDate) : ''}`;
      return `${dateRange}, ${dayOfWeek}${item.availability ? ' (' + escapeHtml(availabilityLabel(item.availability)) + ')' : ''}${item.requestedDays != null ? ` · ${escapeHtml(fmtDays(item.requestedDays))} day${item.requestedDays === 1 ? '' : 's'}` : ''}`;
    })()
    : `Submitted ${escapeHtml(fmtDate(item.createdAt))}`;
  const detailsHtml = item.kind === 'leave'
    ? (item.reason ? `<div class="request-card-reason">${escapeHtml(item.reason)}</div>` : '')
    : `<div class="request-card-reason">${changeRequestDiffHtml(item.changes)}</div>`;
  // auto_rejected is self-cancellable too (see timeOffService.cancel) —
  // nobody's actually reviewed it yet, so the requester can still say "I
  // ended up working after all". Once a manager/P&C has actually decided
  // (approved, or manually rejected), only they can change it from here —
  // see MANAGER_HR_CANCELLABLE_STATUSES above.
  const canCancel = item.kind === 'leave' && ['pending', 'manager_approved', 'auto_rejected'].includes(item.status);
  const cancelLocked = item.kind === 'leave' && !canCancel && ['approved', 'rejected'].includes(item.status);
  let cancelActionHtml = '';
  if (canCancel) {
    cancelActionHtml = confirmingCancelId === item.id
      ? `<span class="small">Cancel this request? </span><button class="btn small danger" data-req-action="confirm-cancel" data-request-id="${item.id}">Yes</button> <button class="btn small" data-req-action="cancel-cancel">No</button>`
      : `<button class="btn small" data-req-action="ask-cancel" data-request-id="${item.id}">Cancel</button>`;
  } else if (cancelLocked) {
    cancelActionHtml = `<button class="btn small" disabled title="Only your manager or People & Culture can change this now.">Cancel</button>`;
  }
  return `<div class="request-card">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(categoryLabelFor(item))}</div>
        <div class="request-card-meta">${dateHtml}</div>
      </div>
      <span class="badge badge-${item.status}">${escapeHtml(statusLabelFor(item))}</span>
    </div>
    ${detailsHtml}
    ${item.kind === 'leave' ? conflictWarningHtml(item) + noManagerFlagHtml(item) : ''}
    ${cancelLocked ? `<div class="request-card-conflict">⚠ This request can no longer be cancelled — once ${escapeHtml(item.status)}, only your manager or People &amp; Culture can change its status.</div>` : ''}
    <div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
      <button class="btn small" data-req-action="toggle-timeline" data-row-id="${rowId}">View activity</button>
      ${cancelActionHtml}
    </div>
    <div class="small muted mt-8" id="my-request-timeline-${rowId}" hidden>${timelineHtml(item)}</div>
  </div>`;
}

function matchesFilters(item, filters) {
  if (filters.category && item.kind !== filters.category && item.leaveType !== filters.category) return false;
  if (filters.status && item.status !== filters.status) return false;
  const itemDate = item.kind === 'leave' ? item.startDate : item.createdAt.slice(0, 10);
  if (filters.from && itemDate < filters.from) return false;
  if (filters.to && itemDate > filters.to) return false;
  if (filters.search) {
    const haystack = [categoryLabelFor(item), statusLabelFor(item), item.reason, item.startDate, item.endDate, item.createdAt]
      .filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(filters.search)) return false;
  }
  return true;
}

function filterMyRequests() {
  const filters = {
    search: ($('#req-search') ? $('#req-search').value : '').trim().toLowerCase(),
    category: $('#req-filter-category') ? $('#req-filter-category').value : '',
    status: $('#req-filter-status') ? $('#req-filter-status').value : '',
    from: $('#req-filter-from') ? $('#req-filter-from').value : '',
    to: $('#req-filter-to') ? $('#req-filter-to').value : '',
  };
  const filtered = myRequestsCache.filter((item) => matchesFilters(item, filters));
  const list = $('#my-requests-list');
  if (!list) return;
  list.innerHTML = filtered.length ? filtered.map(myRequestRowHtml).join('') : `<div class="empty-state">No requests match these filters.</div>`;
}

function myRequestsFilterBarHtml() {
  const categoryOptions = LEAVE_TYPES.map((t) => `<option value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</option>`).join('');
  const statusOptions = Object.keys(STATUS_LABELS).map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(STATUS_LABELS[s])}</option>`).join('');
  return `<div class="requests-filter-bar">
    <input type="text" id="req-search" class="form-control" placeholder="Search my requests..." data-my-requests-filter>
    <select id="req-filter-category" class="form-control" data-my-requests-filter>
      <option value="">All categories</option>
      <option value="profile_change">Profile Change</option>
      ${categoryOptions}
    </select>
    <select id="req-filter-status" class="form-control" data-my-requests-filter>
      <option value="">All statuses</option>
      ${statusOptions}
    </select>
    <input type="date" id="req-filter-from" class="form-control" title="From date" data-my-requests-filter>
    <input type="date" id="req-filter-to" class="form-control" title="To date" data-my-requests-filter>
  </div>`;
}

function myRequestsSectionHtml() {
  return `<div class="card section">
    <div class="card-title">My Requests</div>
    ${myRequestsFilterBarHtml()}
    <div id="my-requests-list">${myRequestsCache.length ? myRequestsCache.map(myRequestRowHtml).join('') : `<div class="empty-state">No requests yet</div>`}</div>
  </div>`;
}

// Delegated on #requests-content — guarded against double-binding since
// renderRequestsCenter() re-runs on this same persisting element after
// nearly every action (approve/reject/cancel/etc. all call it again).
// Covers every action button in this file plus the "My Requests" filter
// bar's input/change events. Replaces onclick=".../onchange="..."/
// oninput="..." attributes, which the CSP's script-src-attr 'none'
// silently blocks (confirmed live, 2026-09-28, on the sibling
// Overview-page/Team-Reviews bugs — same root cause).
function bindRequestsCenterUi(container) {
  if (container._requestsCenterBound) return;
  container._requestsCenterBound = true;

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-req-action]');
    if (!btn) return;
    const action = btn.dataset.reqAction;
    const id = Number(btn.dataset.requestId);
    if (action === 'confirm-reject') {
      if (btn.dataset.rejectKind === 'manager') managerDecide(id, 'rejected', btn);
      else pcConfirm(id, 'rejected');
    }
    if (action === 'cancel-reject') cancelReject();
    if (action === 'manager-approve') managerDecide(id, 'approved', btn);
    if (action === 'ask-reject') askReject(id);
    if (action === 'profile-change-approve') profileChangeDecide(id, 'approve', btn);
    if (action === 'profile-change-reject') profileChangeDecide(id, 'reject', btn);
    if (action === 'pc-approve') pcConfirm(id, 'approved');
    if (action === 'toggle-timeline') myRequestToggleTimeline(btn.dataset.rowId);
    if (action === 'confirm-cancel') cancelMyRequest(id);
    if (action === 'cancel-cancel') cancelCancelMyRequest();
    if (action === 'ask-cancel') askCancelMyRequest(id);
    if (action === 'ask-override-cancel') askOverrideCancel(id);
    if (action === 'override-cancel-cancel') cancelOverrideCancel();
    if (action === 'override-cancel-confirm') overrideCancel(id);
    if (action === 'ask-confirm-rejection') askConfirmRejection(id);
    if (action === 'cancel-confirm-rejection') cancelConfirmRejection();
    if (action === 'confirm-rejection-submit') confirmRejection(id);
  });

  // "My Requests" filter bar — #my-requests-list gets replaced by
  // filterMyRequests() itself, but the filter inputs live in a sibling
  // element that persists, so this stays correctly bound throughout.
  container.addEventListener('input', (e) => {
    if (e.target.closest('[data-my-requests-filter]')) filterMyRequests();
  });
  container.addEventListener('change', (e) => {
    if (e.target.closest('[data-my-requests-filter]')) filterMyRequests();
  });
}

// ── Orchestration ────────────────────────────────────────────────────
export async function renderRequestsCenter() {
  const container = $('#requests-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManagerRole = role === 'ceo';
  const canReviewProfileChanges = role === 'admin' || isManagerRole || isPeopleCulture;
  const myEmployeeId = state.myEmployee && state.myEmployee.id;

  const [, myLeaveRes, myChangeRes, teamRes, pcRes, changeRes] = await Promise.all([
    loadDirectoryIndex(),
    myEmployeeId ? apiFetch('/api/employees/leave-requests/mine') : Promise.resolve({ requests: [] }),
    myEmployeeId ? apiFetch('/api/employees/profile-change-requests/mine') : Promise.resolve({ requests: [] }),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    canReviewProfileChanges ? apiFetch('/api/employees/profile-change-requests') : Promise.resolve(null),
    window.Departments.load(apiFetch),
  ]);

  myRequestsCache = [
    ...(myLeaveRes.requests || []).map((r) => ({ ...r, kind: 'leave' })),
    ...(myChangeRes.requests || []).map((r) => ({ ...r, kind: 'profile_change' })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const sections = [myRequestsSectionHtml()];
  const teamRequests = teamRes.requests || [];

  // Same scoping rule as before the move: a decision is always tied to
  // actual direct reports, even for the company-wide `manager` role.
  const isMyDirectReport = (r) => {
    const target = directoryById[r.employeeId];
    return !!target && !!myEmployeeId && target.managerEmployeeId === myEmployeeId;
  };
  const myPending = teamRequests.filter((r) => r.status === 'pending' && isMyDirectReport(r));

  if (teamRequests.length || isPeopleCulture || isManagerRole) {
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending My Decision</div>
        ${myPending.length ? myPending.map((r) => requestCard(r, managerActions(r))).join('') : `<div class="empty-state">No pending requests</div>`}
      </div>
      <div class="card section">
        <div class="card-title">${isManagerRole ? 'All Requests (company-wide)' : "All My Direct Reports' Requests"}</div>
        ${teamRequests.length ? teamRequests.map((r) => requestCard(r, managerHrOverrideActions(r, isMyDirectReport(r) || isPeopleCulture), awaitingRejectionConfirmationHtml(r))).join('') : `<div class="empty-state">No requests yet</div>`}
      </div>`);
  }

  if (isPeopleCulture) {
    const pcPending = (pcRes && pcRes.requests) || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending P&amp;C Confirmation (company-wide)</div>
        ${pcPending.length ? pcPending.map((r) => requestCard(r, pcActions(r), lateWfhWarningHtml(r) + wfhOverQuotaWarningHtml(r) + leaveTypeUsageHtml(r))).join('') : `<div class="empty-state">Nothing waiting on P&amp;C</div>`}
      </div>`);
  }

  if (canReviewProfileChanges) {
    const changeRequests = (changeRes && changeRes.requests) || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending Profile Changes</div>
        ${changeRequests.length ? changeRequests.map(changeRequestCard).join('') : `<div class="empty-state">No profile changes waiting on review</div>`}
      </div>`);
  }

  container.innerHTML = sections.join('');
  bindRequestsCenterUi(container);
}
