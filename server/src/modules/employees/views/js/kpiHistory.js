import { $, escapeHtml } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { statusBadge } from './kpiShared.js';

// apiFetch assumes a JSON body — CSV export needs its own fetch carrying
// the same Bearer header, then a Blob download (the file needs the
// Authorization header, so a plain <a href> can't be used).
async function downloadCsv(employeeId) {
  const res = await fetch(`/api/employees/kpi/${employeeId}/history/export`, {
    headers: { Authorization: 'Bearer ' + state.accessToken },
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kpi-history-${employeeId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function renderKpiHistory(container, employeeId) {
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const { breakdowns } = await apiFetch(`/api/employees/kpi/${employeeId}/history`);
    if (breakdowns.length === 0) {
      container.innerHTML = `<div class="card empty-state">No KPI history recorded yet for this employee.</div>`;
      return;
    }

    // Oldest first for the trend row, most-recent-first for the table —
    // same underlying data, two natural reading orders.
    const trend = [...breakdowns].reverse();
    const maxScore = Math.max(100, ...trend.map((b) => b.final.total));
    const trendHtml = trend.map((b) => {
      const heightPct = Math.max(2, (b.final.total / maxScore) * 100);
      return `<div class="kpi-trend-bar" title="${escapeHtml(b.quarter)}: ${b.final.total.toFixed(1)}">
        <div class="kpi-trend-bar-fill" style="height:${heightPct}%;"></div>
        <div class="kpi-trend-bar-label">${escapeHtml(b.quarter.replace(/^\d{4}-/, ''))}</div>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="card section">
        <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Performance Trend</span>
          <button class="btn small" id="kpi-history-export-btn">Export CSV</button>
        </div>
        <div class="kpi-trend-row">${trendHtml}</div>
      </div>
      <div class="card section">
        <div class="card-title">Previous KPI Results</div>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Quarter</th><th>Pillar A</th><th>Pillar B</th><th>Final</th><th>Status</th></tr></thead>
            <tbody>
              ${breakdowns.map((b) => `
                <tr>
                  <td>${escapeHtml(b.quarter)}</td>
                  <td>${b.final.pillarAWeighted.toFixed(1)} / ${b.pillarA.maxTotal}</td>
                  <td>${b.pillarB.defined ? b.final.pillarBWeighted.toFixed(1) + ' / ' + b.pillarB.maxTotal : '—'}</td>
                  <td style="font-weight:700;">${b.final.total.toFixed(1)}</td>
                  <td>${statusBadge(b.final.statusBand)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    $('#kpi-history-export-btn').addEventListener('click', () => downloadCsv(employeeId));
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}
