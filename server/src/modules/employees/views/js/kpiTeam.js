import { escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';
import { statusBadge } from './kpiShared.js';
import { panel, colTitle, plural, loadErrorPanel } from './panels.js';

// showTeamHeadBadge is only ever true for the manager/admin company-wide
// view (myTeam + byDepartment) — a team head viewing their own flat direct-
// reports list doesn't need to be told which of their reports also manages
// a team, so that call site leaves this off. Same badge/label roster.js
// already uses for is_team_head, reused here rather than inventing a new
// style.
function summaryTableHtml(title, rows, showTeamHeadBadge) {
  // A null total (review window still open) sorts last.
  const sorted = [...rows].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  return `<div class="kpi-pillar-section">
    ${colTitle(title, `${rows.length} ${plural(rows.length, 'person', 'people')}`)}
    <div class="table-scroll">
      <table class="data-table kpi-team-table">
        <colgroup><col style="width:40%"><col style="width:24%"><col style="width:12%"><col></colgroup>
        <thead><tr><th>Employee</th><th>KPI profile</th><th class="num">Score</th><th>Status</th></tr></thead>
        <tbody>
          ${sorted.map((row) => `
            <tr>
              <td>${escapeHtml(row.firstName + ' ' + row.lastName)}${showTeamHeadBadge && row.isTeamHead ? ' <span class="badge badge-approved">Team Head</span>' : ''}</td>
              <td>${row.kpiProfile ? escapeHtml(row.kpiProfile) : '<span class="muted">unassigned</span>'}</td>
              <td class="num" style="font-weight:650;">${row.total === null ? '—' : row.total.toFixed(1)}</td>
              <td>${statusBadge(row.statusBand)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function teamPanel(quarter, body) {
  return panel({ title: `Team performance, ${quarter}`, meta: 'Sorted by score', body: `<div class="panel-body">${body}</div>` });
}

export async function renderKpiTeam(container, quarter) {
  container.innerHTML = teamPanel(quarter, '<div class="list-empty">Loading…</div>');
  const empty = teamPanel(quarter, '<div class="list-empty">No team members to show KPI summaries for.</div>');
  try {
    const { summary } = await apiFetch(`/api/employees/kpi/team-summary?quarter=${encodeURIComponent(quarter)}`);

    // Team heads get a flat array (their own direct reports only). Manager/
    // admin get { myTeam, byDepartment } instead — their own direct reports
    // plus every department's real membership, independent of myTeam (an
    // employee can appear in both; that overlap is intentional, not a bug —
    // see kpiScoringService.computeTeamSummary's own comment).
    if (Array.isArray(summary)) {
      container.innerHTML = summary.length ? teamPanel(quarter, summaryTableHtml('Your direct reports', summary, false)) : empty;
      return;
    }

    const { myTeam, byDepartment } = summary;
    const departmentNames = Object.keys(byDepartment).sort((a, b) => a.localeCompare(b));
    if (myTeam.length === 0 && departmentNames.length === 0) {
      container.innerHTML = empty;
      return;
    }

    const sections = [];
    if (myTeam.length > 0) sections.push(summaryTableHtml('Your direct reports', myTeam, true));
    departmentNames.forEach((name) => sections.push(summaryTableHtml(name, byDepartment[name], true)));
    container.innerHTML = teamPanel(quarter, sections.join(''));
  } catch (err) {
    console.error('Team KPI summary failed to load', err);
    container.innerHTML = loadErrorPanel('Team performance couldn’t load', err, 'data-team-retry');
    container.querySelector('[data-team-retry]').addEventListener('click', () => renderKpiTeam(container, quarter));
  }
}
