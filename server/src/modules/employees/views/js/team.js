import { $, escapeHtml, fmtDate, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel } from './leaveTypes.js';

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

function requestCard(r, actionsHtml) {
  return `<div class="request-card" id="team-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(nameFor(r.employeeId))}</div>
        <div class="request-card-meta">${escapeHtml(leaveTypeLabel(r.leaveType))} · ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ' → ' + fmtDate(r.endDate) : ''}${r.halfDay ? ' (half-day)' : ''}</div>
      </div>
      <span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span>
    </div>
    ${r.reason ? `<div class="request-card-reason">${escapeHtml(r.reason)}</div>` : ''}
    ${actionsHtml || ''}
  </div>`;
}

async function managerDecide(id, decision, btn) {
  btn.closest('.request-card-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/manager-decision`, { method: 'PATCH', body: JSON.stringify({ decision }) });
    toast(decision === 'approved' ? 'Approved' : 'Rejected', 'info');
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
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/pc-confirm`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, salaryDeduction, unpaidDaysCount: unpaidInput ? Number(unpaidInput.value) || undefined : undefined }),
    });
    toast(decision === 'approved' ? 'Confirmed' : 'Rejected', 'info');
    renderTeam();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.pcConfirm = pcConfirm;

function managerActions(r) {
  if (r.status !== 'pending') return '';
  return `<div class="request-card-actions">
    <button class="btn primary small" onclick="managerDecide(${r.id},'approved',this)">✓ Approve</button>
    <button class="btn danger small" onclick="managerDecide(${r.id},'rejected',this)">✕ Reject</button>
  </div>`;
}

function pcActions(r) {
  if (r.status !== 'manager_approved') return '';
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    <select class="form-control pc-deduction" style="width:auto;">
      <option value="none">No deduction</option>
      <option value="half_day">Half-day deduction</option>
      <option value="full_day">Full-day deduction</option>
      <option value="unpaid">Unpaid</option>
    </select>
    <input type="number" class="form-control pc-unpaid-days" placeholder="Unpaid days" style="width:110px;" min="0">
    <button class="btn primary small" onclick="pcConfirm(${r.id},'approved')">✓ Confirm</button>
    <button class="btn danger small" onclick="pcConfirm(${r.id},'rejected')">✕ Reject</button>
  </div>`;
}

export async function renderTeam() {
  const container = $('#team-content');
  container.innerHTML = `<div class="empty-state">Loading...</div>`;
  await loadDirectoryIndex();

  const sections = [];
  const [teamRes] = await Promise.all([apiFetch('/api/employees/leave-requests/team')]);
  const teamRequests = teamRes.requests || [];
  const myPending = teamRequests.filter((r) => r.status === 'pending');

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManagerRole = role === 'manager';
  if (teamRequests.length || isPeopleCulture || isManagerRole) {
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending My Decision${isManagerRole ? ' (company-wide)' : ''}</div>
        ${myPending.length ? myPending.map((r) => requestCard(r, managerActions(r))).join('') : `<div class="empty-state">No pending requests</div>`}
      </div>
      <div class="card section">
        <div class="card-title">${isManagerRole ? 'All Requests (company-wide)' : "All My Direct Reports' Requests"}</div>
        ${teamRequests.length ? teamRequests.map((r) => requestCard(r)).join('') : `<div class="empty-state">No requests yet</div>`}
      </div>`);
  }

  if (isPeopleCulture) {
    const pcRes = await apiFetch('/api/employees/leave-requests/pending');
    const pcPending = pcRes.requests || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending P&amp;C Confirmation (company-wide)</div>
        ${pcPending.length ? pcPending.map((r) => requestCard(r, pcActions(r))).join('') : `<div class="empty-state">Nothing waiting on P&amp;C</div>`}
      </div>`);
  }

  container.innerHTML = sections.length ? sections.join('') : `<div class="empty-state">You don't manage anyone yet.</div>`;
}
