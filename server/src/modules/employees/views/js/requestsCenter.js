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

function lateWfhWarningHtml(r) {
  if (!r.wfhSubmittedLate) return '';
  return `<div class="request-card-conflict">⚠ Submitted at ${escapeHtml(fmtDateTime(r.createdAt))} — after 9:00 AM for a same-day WFH request. A deduction should be applied.</div>`;
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
window.askReject = askReject;

function cancelReject() {
  rejectingId = null;
  renderRequestsCenter();
}
window.cancelReject = cancelReject;

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
window.managerDecide = managerDecide;

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
window.pcConfirm = pcConfirm;

function rejectNoteForm(id, confirmOnclick) {
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    <textarea class="form-control reject-note" placeholder="Reason for rejecting (required)" rows="2" style="width:100%;"></textarea>
    <button class="btn danger small" onclick="${confirmOnclick}">Confirm Reject</button>
    <button class="btn small" onclick="cancelReject()">Cancel</button>
  </div>`;
}

function managerActions(r) {
  if (r.status !== 'pending') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, `managerDecide(${r.id},'rejected',this)`);
  return `<div class="request-card-actions">
    <button class="btn primary small" onclick="managerDecide(${r.id},'approved',this)">✓ Approve</button>
    <button class="btn danger small" onclick="askReject(${r.id})">✕ Reject</button>
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
      <button class="btn primary small" onclick="profileChangeDecide(${r.id},'approve',this)">✓ Approve</button>
      <button class="btn danger small" onclick="profileChangeDecide(${r.id},'reject',this)">✕ Reject</button>
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
window.profileChangeDecide = profileChangeDecide;

function doctorNoteCheckboxHtml(r) {
  if (r.leaveType !== 'sick' || !r.requiresDoctorNote) return '';
  return `<label class="small" style="display:flex;align-items:center;gap:6px;">
    <input type="checkbox" class="pc-doctor-note"> Doctor's note provided
  </label>`;
}

function pcActions(r) {
  if (r.status !== 'manager_approved') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, `pcConfirm(${r.id},'rejected')`);
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    ${doctorNoteCheckboxHtml(r)}
    <select class="form-control pc-deduction" style="width:auto;">
      <option value="none">No deduction</option>
      <option value="half_day">Half-day deduction</option>
      <option value="full_day">Full-day deduction</option>
      <option value="unpaid">Unpaid</option>
    </select>
    <input type="number" class="form-control pc-unpaid-days" placeholder="Unpaid days" style="width:110px;" min="0">
    <button class="btn primary small" onclick="pcConfirm(${r.id},'approved')">✓ Confirm</button>
    <button class="btn danger small" onclick="askReject(${r.id})">✕ Reject</button>
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
function timelineHtml(item) {
  const steps = [`<div><strong>Submitted</strong> — ${escapeHtml(fmtDateTime(item.createdAt))}</div>`];
  if (item.kind === 'leave') {
    if (item.autoRejectReason) {
      steps.push(`<div><strong>Auto-rejected</strong> — ${escapeHtml(item.autoRejectReason)}</div>`);
    }
    if (item.managerDecisionAt) {
      const verb = item.managerDecisionNote && item.status === 'rejected' && !item.pcConfirmedAt ? 'Rejected' : 'Approved';
      steps.push(`<div><strong>${verb} by manager</strong> — ${escapeHtml(nameFor(item.managerDecisionBy))}, ${escapeHtml(fmtDateTime(item.managerDecisionAt))}${item.managerDecisionNote ? `: ${escapeHtml(item.managerDecisionNote)}` : ''}</div>`);
    } else if (item.managerDecisionNote) {
      steps.push(`<div><strong>Manager stage skipped</strong> — ${escapeHtml(item.managerDecisionNote)}</div>`);
    }
    if (item.pcConfirmedAt) {
      const verb = item.status === 'rejected' ? 'Rejected' : 'Confirmed';
      steps.push(`<div><strong>${verb} by People &amp; Culture</strong> — ${escapeHtml(nameFor(item.pcConfirmedBy))}, ${escapeHtml(fmtDateTime(item.pcConfirmedAt))}${item.pcDecisionNote ? `: ${escapeHtml(item.pcDecisionNote)}` : ''}</div>`);
    }
    if (item.status === 'cancelled') {
      steps.push(`<div><strong>Cancelled</strong> — ${escapeHtml(fmtDateTime(item.updatedAt))}</div>`);
    }
  } else if (item.status !== 'pending') {
    steps.push(`<div><strong>${escapeHtml(CHANGE_STATUS_LABELS[item.status] || item.status)} by ${escapeHtml(item.reviewedByName || 'reviewer')}</strong> — ${escapeHtml(fmtDateTime(item.updatedAt))}${item.decisionNote ? `: ${escapeHtml(item.decisionNote)}` : ''}</div>`);
  }
  return steps.join('');
}

window.myRequestToggleTimeline = function (rowId) {
  const detail = document.getElementById('my-request-timeline-' + rowId);
  if (!detail) return;
  const wasHidden = detail.hidden;
  document.querySelectorAll('[id^="my-request-timeline-"]').forEach((d) => { d.hidden = true; });
  detail.hidden = !wasHidden;
};

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
window.cancelMyRequest = cancelMyRequest;

window.askCancelMyRequest = function (id) {
  confirmingCancelId = id;
  filterMyRequests();
};

window.cancelCancelMyRequest = function () {
  confirmingCancelId = null;
  filterMyRequests();
};

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
  const canCancel = item.kind === 'leave' && ['pending', 'manager_approved'].includes(item.status);
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
    <div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
      <button class="btn small" onclick="myRequestToggleTimeline('${rowId}')">View activity</button>
      ${canCancel
        ? (confirmingCancelId === item.id
          ? `<span class="small">Cancel this request? </span><button class="btn small danger" onclick="cancelMyRequest(${item.id})">Yes</button> <button class="btn small" onclick="cancelCancelMyRequest()">No</button>`
          : `<button class="btn small" onclick="askCancelMyRequest(${item.id})">Cancel</button>`)
        : ''}
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

window.filterMyRequests = function filterMyRequests() {
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
};

function myRequestsFilterBarHtml() {
  const categoryOptions = LEAVE_TYPES.map((t) => `<option value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</option>`).join('');
  const statusOptions = Object.keys(STATUS_LABELS).map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(STATUS_LABELS[s])}</option>`).join('');
  return `<div class="requests-filter-bar">
    <input type="text" id="req-search" class="form-control" placeholder="Search my requests..." oninput="filterMyRequests()">
    <select id="req-filter-category" class="form-control" onchange="filterMyRequests()">
      <option value="">All categories</option>
      <option value="profile_change">Profile Change</option>
      ${categoryOptions}
    </select>
    <select id="req-filter-status" class="form-control" onchange="filterMyRequests()">
      <option value="">All statuses</option>
      ${statusOptions}
    </select>
    <input type="date" id="req-filter-from" class="form-control" title="From date" onchange="filterMyRequests()">
    <input type="date" id="req-filter-to" class="form-control" title="To date" onchange="filterMyRequests()">
  </div>`;
}

function myRequestsSectionHtml() {
  return `<div class="card section">
    <div class="card-title">My Requests</div>
    ${myRequestsFilterBarHtml()}
    <div id="my-requests-list">${myRequestsCache.length ? myRequestsCache.map(myRequestRowHtml).join('') : `<div class="empty-state">No requests yet</div>`}</div>
  </div>`;
}

// ── Orchestration ────────────────────────────────────────────────────
export async function renderRequestsCenter() {
  const container = $('#requests-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManagerRole = role === 'manager';
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
        ${teamRequests.length ? teamRequests.map((r) => requestCard(r)).join('') : `<div class="empty-state">No requests yet</div>`}
      </div>`);
  }

  if (isPeopleCulture) {
    const pcPending = (pcRes && pcRes.requests) || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending P&amp;C Confirmation (company-wide)</div>
        ${pcPending.length ? pcPending.map((r) => requestCard(r, pcActions(r), lateWfhWarningHtml(r) + leaveTypeUsageHtml(r))).join('') : `<div class="empty-state">Nothing waiting on P&amp;C</div>`}
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
}
