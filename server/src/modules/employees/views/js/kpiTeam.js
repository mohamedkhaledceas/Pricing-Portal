import { escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';
import { statusBadge } from './kpiShared.js';

// showTeamHeadBadge is only ever true for the manager/admin company-wide
// view (myTeam + byDepartment) — a team head viewing their own flat direct-
// reports list doesn't need to be told which of their reports also manages
// a team, so that call site leaves this off. Same badge/label roster.js
// already uses for is_team_head, reused here rather than inventing a new
// style.
function summaryTableHtml(title, rows, showTeamHeadBadge) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  return `
    <div class="card section">
      <div class="card-title">${escapeHtml(title)}</div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr><th>Employee</th><th>Role</th><th>Score</th><th>Status</th></tr></thead>
          <tbody>
            ${sorted.map((row) => `
              <tr>
                <td>${escapeHtml(row.firstName + ' ' + row.lastName)}${showTeamHeadBadge && row.isTeamHead ? ' <span class="badge badge-approved">Team Head</span>' : ''}</td>
                <td>${row.kpiProfile ? escapeHtml(row.kpiProfile) : '<span class="muted">unassigned</span>'}</td>
                <td style="font-weight:700;">${row.total.toFixed(1)}</td>
                <td>${statusBadge(row.statusBand)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

export async function renderKpiTeam(container, quarter) {
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const { summary } = await apiFetch(`/api/employees/kpi/team-summary?quarter=${encodeURIComponent(quarter)}`);

    // Team heads get a flat array (their own direct reports only). Manager/
    // admin get { myTeam, byDepartment } instead — their own direct reports
    // plus every department's real membership, independent of myTeam (an
    // employee can appear in both; that overlap is intentional, not a bug —
    // see kpiScoringService.computeTeamSummary's own comment).
    if (Array.isArray(summary)) {
      if (summary.length === 0) {
        container.innerHTML = `<div class="card empty-state">No team members to show KPI summaries for.</div>`;
        return;
      }
      container.innerHTML = summaryTableHtml(`Team KPI Summary — ${quarter}`, summary, false);
      return;
    }

    const { myTeam, byDepartment } = summary;
    const departmentNames = Object.keys(byDepartment).sort((a, b) => a.localeCompare(b));
    if (myTeam.length === 0 && departmentNames.length === 0) {
      container.innerHTML = `<div class="card empty-state">No team members to show KPI summaries for.</div>`;
      return;
    }

    const sections = [];
    if (myTeam.length > 0) sections.push(summaryTableHtml(`My Team — ${quarter}`, myTeam, true));
    departmentNames.forEach((name) => {
      sections.push(summaryTableHtml(`${name} — ${quarter}`, byDepartment[name], true));
    });
    container.innerHTML = sections.join('');
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}
