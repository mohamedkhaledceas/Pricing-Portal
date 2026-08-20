import { $, escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel } from './leaveTypes.js';

let candidates = [];

// Company-wide for both roles — manager and people_culture already have
// company-wide reach elsewhere (listTeam/managerDecision unscoping for
// manager, canManageRoster for P&C), so no direct-reports filtering here.
async function loadCandidates() {
  const res = await apiFetch('/api/employees');
  candidates = (res.employees || []).slice().sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
}

function totalsRow(rows) {
  const totals = rows.reduce((acc, r) => ({
    requested: acc.requested + r.requested,
    approved: acc.approved + r.approved,
    rejected: acc.rejected + r.rejected,
    inProgress: acc.inProgress + r.inProgress,
    cancelled: acc.cancelled + r.cancelled,
  }), { requested: 0, approved: 0, rejected: 0, inProgress: 0, cancelled: 0 });
  return `<tr class="leave-breakdown-totals">
    <td>Total</td>
    <td>${totals.requested}</td>
    <td>${totals.approved}</td>
    <td>${totals.rejected}</td>
    <td>${totals.inProgress}</td>
    <td>${totals.cancelled}</td>
  </tr>`;
}

async function renderBreakdown(employeeId) {
  const container = $('#leave-breakdown-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const res = await apiFetch(`/api/employees/leave-requests/${employeeId}/breakdown`);
    const rows = res.breakdown || [];
    container.innerHTML = `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Leave Type</th><th>Requested</th><th>Approved</th><th>Rejected</th><th>In Progress</th><th>Cancelled</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr>
              <td>${escapeHtml(leaveTypeLabel(r.leaveType))}</td>
              <td>${r.requested}</td>
              <td>${r.approved}</td>
              <td>${r.rejected}</td>
              <td>${r.inProgress}</td>
              <td>${r.cancelled}</td>
            </tr>`).join('')}
            ${totalsRow(rows)}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}

export async function renderLeaveReport() {
  const container = $('#leave-report-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  await loadCandidates();

  if (!candidates.length) {
    container.innerHTML = `<div class="card empty-state">No employees on the roster yet.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card section" style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end;">
      <div class="form-group" style="min-width:220px;">
        <label class="form-label">Employee</label>
        <select class="form-control" id="leave-breakdown-employee-select">
          ${candidates.map((c) => `<option value="${c.id}">${escapeHtml(c.firstName + ' ' + c.lastName)}${c.department ? ' — ' + escapeHtml(c.department) : ''}</option>`).join('')}
        </select>
      </div>
      <button class="btn primary" id="leave-breakdown-refresh-btn">View</button>
    </div>
    <div id="leave-breakdown-content"></div>
  `;

  const refresh = () => renderBreakdown(Number($('#leave-breakdown-employee-select').value));
  $('#leave-breakdown-refresh-btn').addEventListener('click', refresh);
  refresh();
}
