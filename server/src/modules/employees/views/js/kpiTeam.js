import { escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';
import { statusBadge } from './kpiShared.js';

export async function renderKpiTeam(container, quarter) {
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const { summary } = await apiFetch(`/api/employees/kpi/team-summary?quarter=${encodeURIComponent(quarter)}`);
    if (summary.length === 0) {
      container.innerHTML = `<div class="card empty-state">No team members to show KPI summaries for.</div>`;
      return;
    }
    const sorted = [...summary].sort((a, b) => b.total - a.total);

    container.innerHTML = `
      <div class="card section">
        <div class="card-title">Team KPI Summary — ${escapeHtml(quarter)}</div>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Employee</th><th>Role</th><th>Score</th><th>Status</th></tr></thead>
            <tbody>
              ${sorted.map((row) => `
                <tr>
                  <td>${escapeHtml(row.firstName + ' ' + row.lastName)}</td>
                  <td>${row.kpiProfile ? escapeHtml(row.kpiProfile) : '<span class="muted">unassigned</span>'}</td>
                  <td style="font-weight:700;">${row.total.toFixed(1)}</td>
                  <td>${statusBadge(row.statusBand)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}
