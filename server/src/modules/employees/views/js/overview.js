import { $, escapeHtml, fmtDate, skeletonBlock } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel } from './leaveTypes.js';

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderNoProfile() {
  $('#ov-content').innerHTML = `
    <div class="card empty-state">
      <div style="font-weight:650;margin-bottom:4px;">You don't have an employee profile yet</div>
      <div class="muted">Time Off and KPI tracking need a completed employee record. Contact People &amp; Culture to get set up.</div>
    </div>`;
}

function statCard(title, body) {
  return `<div class="stat-card">
    <div class="stat-card-title">${escapeHtml(title)}</div>
    ${body}
  </div>`;
}

export async function renderOverview() {
  const container = $('#ov-content');
  const emp = state.myEmployee;
  if (!emp) { renderNoProfile(); return; }

  container.innerHTML = `<div class="cards-row section">${Array.from({ length: 3 }, () => statCard('', skeletonBlock('60%', '30px'))).join('')}</div>`;

  const [mineRes, offTodayRes] = await Promise.all([
    apiFetch('/api/employees/leave-requests/mine'),
    apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
  ]);

  const requests = mineRes.requests || [];
  const counts = { approved: 0, pending: 0, rejected: 0 };
  requests.forEach((r) => {
    if (r.status === 'approved') counts.approved += 1;
    else if (r.status === 'pending' || r.status === 'manager_approved') counts.pending += 1;
    else if (r.status === 'rejected' || r.status === 'auto_rejected') counts.rejected += 1;
  });

  const offToday = offTodayRes.offToday || [];
  const teamGrid = offToday.length
    ? offToday.map((o) => `
      <div class="team-tile">
        <div class="team-tile-name">${escapeHtml(o.name)}</div>
        <div class="team-tile-meta">${escapeHtml(leaveTypeLabel(o.leaveType))}${o.halfDay ? ' · half-day' : ''}${o.department ? ' · ' + escapeHtml(o.department) : ''}</div>
      </div>`).join('')
    : `<div class="empty-state" style="grid-column:1/-1;padding:18px;">Nobody's off today</div>`;

  container.innerHTML = `
    <div class="cards-row section">
      ${statCard('My Requests', `
        <div class="stat-row mt-8">
          <span class="stat-num" style="font-size:22px;">${counts.approved}</span><span class="stat-lbl">Approved</span>
        </div>
        <div class="stat-row">
          <span class="stat-num" style="font-size:22px;">${counts.pending}</span><span class="stat-lbl">Pending</span>
        </div>
        <div class="stat-row">
          <span class="stat-num" style="font-size:22px;">${counts.rejected}</span><span class="stat-lbl">Rejected</span>
        </div>`)}
      ${statCard('Department', `<div class="mt-8" style="font-weight:650;">${escapeHtml(emp.department || '—')}</div>
        <div class="muted small mt-8">${emp.kpiProfile ? 'KPI profile: ' + escapeHtml(emp.kpiProfile) : 'No KPI profile assigned'}</div>`)}
      ${statCard('Reporting', `<div class="mt-8">${state.currentUser && state.currentUser.role === 'people_culture' ? '<span class="badge badge-approved">People &amp; Culture</span>' : '<span class="badge badge-neutral">Team member</span>'}</div>`)}
    </div>

    <div class="card section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="card-title" style="margin-bottom:0;">Who's Off Today</div>
        <div class="small muted">${fmtDate(todayIso())}</div>
      </div>
      <div class="team-grid">${teamGrid}</div>
    </div>

    <div class="card section">
      <div class="card-title">Recent Requests</div>
      ${requests.slice(0, 5).length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
            <tbody>
              ${requests.slice(0, 5).map((r) => `<tr>
                <td>${escapeHtml(leaveTypeLabel(r.leaveType))}</td>
                <td>${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ' → ' + fmtDate(r.endDate) : ''}</td>
                <td><span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty-state">No requests yet</div>`}
    </div>
  `;
}
