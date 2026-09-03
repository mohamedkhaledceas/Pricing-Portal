import { $, escapeHtml, fmtDate, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel, availabilityLabel, STATUS_LABELS } from './leaveTypes.js';

let directoryById = {};
async function loadDirectoryIndex() {
  const res = await apiFetch('/api/employees/directory');
  directoryById = {};
  (res.employees || []).forEach((e) => { directoryById[e.id] = e; });
}
function nameFor(employeeId) {
  const e = directoryById[employeeId];
  return e ? `${e.firstName} ${e.lastName}` : `Employee #${employeeId}`;
}

// r.conflictWarnings comes attached from the backend (timeOffService's
// withConflictWarnings, see timeOffService.js) — warn-only, never blocks
// anything; this just labels the card so a manager can see it before
// deciding.
function conflictWarningHtml(r) {
  if (!r.conflictWarnings || !r.conflictWarnings.length) return '';
  return r.conflictWarnings.map((w) => `
    <div class="request-card-conflict">
      ⚠ Conflict pair ${escapeHtml(w.partnerName)}: ${escapeHtml((STATUS_LABELS[w.status] || w.status).toLowerCase())}
      ${escapeHtml(leaveTypeLabel(w.leaveType))} ${fmtDate(w.startDate)}${w.endDate !== w.startDate ? ' → ' + fmtDate(w.endDate) : ''}
    </div>`).join('');
}

function requestCard(r, actionsHtml) {
  return `<div class="request-card" id="team-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(nameFor(r.employeeId))}</div>
        <div class="request-card-meta">${escapeHtml(leaveTypeLabel(r.leaveType))} · ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ' → ' + fmtDate(r.endDate) : ''}${r.availability ? ' (' + escapeHtml(availabilityLabel(r.availability)) + ')' : (r.halfDay ? ' (half-day)' : '')}</div>
      </div>
      <span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span>
    </div>
    ${r.reason ? `<div class="request-card-reason">${escapeHtml(r.reason)}</div>` : ''}
    ${conflictWarningHtml(r)}
    ${actionsHtml || ''}
  </div>`;
}

// Native window.confirm()/prompt() blocks the whole tab — a reject comment
// is captured via this same inline reveal-a-form pattern timeOff.js already
// uses for Cancel, not a prompt().
let rejectingId = null;

function askReject(id) {
  rejectingId = id;
  renderTeam();
}
window.askReject = askReject;

function cancelReject() {
  rejectingId = null;
  renderTeam();
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
    renderTeam();
  } catch (err) {
    toast(err.message, 'danger');
    renderTeam();
  }
}
window.managerDecide = managerDecide;

async function pcConfirm(id, decision) {
  const card = $('#team-card-' + id);
  const deductionSel = card ? card.querySelector('.pc-deduction') : null;
  const salaryDeduction = deductionSel ? deductionSel.value : 'none';
  const unpaidInput = card ? card.querySelector('.pc-unpaid-days') : null;
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
      body: JSON.stringify({ decision, decisionNote, salaryDeduction, unpaidDaysCount: unpaidInput ? Number(unpaidInput.value) || undefined : undefined }),
    });
    toast(decision === 'approved' ? 'Confirmed' : 'Rejected', 'info');
    rejectingId = null;
    renderTeam();
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
  workingHours: 'Working Hours',
  workSchedule: 'Work Schedule',
  managerEmployeeId: 'Manager',
};

function formatChangeValue(field, value) {
  if (field === 'department') return (window.OrgConstants.DEPARTMENT_LABELS[value] || value);
  if (field === 'workLocation') return (window.OrgConstants.WORK_LOCATION_LABELS[value] || value);
  if (field === 'employmentType') return (window.OrgConstants.EMPLOYMENT_TYPE_LABELS[value] || value);
  if (field === 'managerEmployeeId') return nameFor(value);
  return value;
}

function changeRequestCard(r) {
  const diffHtml = Object.keys(r.changes).map((field) =>
    `<div>${escapeHtml(CHANGE_FIELD_LABELS[field] || field)}: <strong>${escapeHtml(String(formatChangeValue(field, r.changes[field])))}</strong></div>`
  ).join('');
  return `<div class="request-card" id="change-request-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(r.employeeName)}</div>
        <div class="request-card-meta">Requested profile change</div>
      </div>
      <span class="badge badge-pending">Pending</span>
    </div>
    <div class="request-card-reason">${diffHtml}</div>
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
    renderTeam();
  } catch (err) {
    toast(err.message, 'danger');
    renderTeam();
  }
}
window.profileChangeDecide = profileChangeDecide;

function pcActions(r) {
  if (r.status !== 'manager_approved') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, `pcConfirm(${r.id},'rejected')`);
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
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

export async function renderTeam() {
  const container = $('#team-content');
  container.innerHTML = `<div class="empty-state">Loading...</div>`;

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManagerRole = role === 'manager';
  const canReviewProfileChanges = role === 'admin' || isManagerRole || isPeopleCulture;

  // All independent reads, fired together — previously sequential (each
  // one only started after the last resolved) despite looking parallel,
  // which measurably slowed this tab down for no reason (see item 13:
  // ~2.5x slower sequentially on localhost alone, and the gap only grows
  // with real network latency). Same shape overview.js's fetches already
  // use correctly: a Promise.resolve(null) placeholder for calls that
  // don't apply to this role, so every branch still destructures cleanly.
  const [, teamRes, pcRes, changeRes] = await Promise.all([
    loadDirectoryIndex(),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    canReviewProfileChanges ? apiFetch('/api/employees/profile-change-requests') : Promise.resolve(null),
  ]);

  const sections = [];
  const teamRequests = teamRes.requests || [];

  // A decision (approve/reject) is always scoped to actual direct reports,
  // for every role including the company-wide `manager` role — that role
  // only gets extra *visibility* (teamRequests itself, company-wide, from
  // listTeam's own bypass), not extra decision power. The backend enforces
  // this too (timeOffService.managerDecision); this filter just keeps the
  // UI from offering an action that would 403.
  const myEmployeeId = state.myEmployee && state.myEmployee.id;
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
        ${pcPending.length ? pcPending.map((r) => requestCard(r, pcActions(r))).join('') : `<div class="empty-state">Nothing waiting on P&amp;C</div>`}
      </div>`);
  }

  // Employees' own edits to an already-locked profile (see
  // rosterService.updateMine) — reviewable by admin/manager/P&C, same set
  // as rosterService.canReviewProfileChanges. Deliberately not operations:
  // that role already has direct roster-edit rights and doesn't need this
  // queue at all.
  if (canReviewProfileChanges) {
    const changeRequests = (changeRes && changeRes.requests) || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending Profile Changes</div>
        ${changeRequests.length ? changeRequests.map(changeRequestCard).join('') : `<div class="empty-state">No profile changes waiting on review</div>`}
      </div>`);
  }

  container.innerHTML = sections.length ? sections.join('') : `<div class="empty-state">You don't manage anyone yet.</div>`;
}
