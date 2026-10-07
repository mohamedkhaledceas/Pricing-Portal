import { $, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { statusBadge } from './kpiShared.js';
import { panel, split, colTitle, loadErrorPanel } from './panels.js';

// apiFetch assumes a JSON body — CSV export needs its own fetch carrying
// the same Bearer header, then a Blob download (the file needs the
// Authorization header, so a plain <a href> can't be used).
async function downloadCsv(employeeId) {
  const res = await fetch(`/api/employees/kpi/${employeeId}/history/export`, {
    headers: { Authorization: 'Bearer ' + state.accessToken },
  });
  if (!res.ok) {
    let message = 'Export failed. Please try again.';
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    toast(message, 'danger');
    return;
  }
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
  container.innerHTML = panel({ title: 'Performance history', body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });
  try {
    const { breakdowns } = await apiFetch(`/api/employees/kpi/${employeeId}/history`);
    if (breakdowns.length === 0) {
      container.innerHTML = panel({ title: 'Performance history', body: '<div class="panel-body"><div class="list-empty">No KPI history recorded yet for this employee.</div></div>' });
      return;
    }

    // Oldest first for the trend row, most-recent-first for the table —
    // same underlying data, two natural reading orders.
    const trend = [...breakdowns].reverse();
    // A quarter whose review window is still open has no final score yet.
    const maxScore = Math.max(100, ...trend.map((b) => b.final.total || 0));
    const trendHtml = trend.map((b) => {
      const heightPct = Math.max(2, ((b.final.total || 0) / maxScore) * 100);
      return `<div class="kpi-trend-bar" title="${escapeHtml(b.quarter)}: ${b.final.total === null ? 'reviews in progress' : b.final.total.toFixed(1)}">
        <div class="kpi-trend-bar-value">${b.final.total === null ? '—' : b.final.total.toFixed(0)}</div>
        <div class="kpi-trend-bar-fill" style="height:${heightPct}%;"></div>
        <div class="kpi-trend-bar-label">${escapeHtml(b.quarter)}</div>
      </div>`;
    }).join('');

    const tableHtml = `<div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Quarter</th><th class="num">Pillar A</th><th class="num">Pillar B</th><th class="num">Final</th><th>Status</th></tr></thead>
        <tbody>
          ${breakdowns.map((b) => `
            <tr>
              <td>${escapeHtml(b.quarter)}</td>
              <td class="num">${b.final.pillarAWeighted === null ? '—' : `${b.final.pillarAWeighted.toFixed(1)} / ${b.pillarA.maxTotal}`}</td>
              <td class="num">${b.pillarB.defined ? b.final.pillarBWeighted.toFixed(1) + ' / ' + b.pillarB.maxTotal : '—'}</td>
              <td class="num" style="font-weight:650;">${b.final.total === null ? '—' : b.final.total.toFixed(1)}</td>
              <td>${statusBadge(b.final.statusBand)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

    container.innerHTML = panel({
      title: 'Performance history',
      meta: `${breakdowns.length} ${breakdowns.length === 1 ? 'quarter' : 'quarters'}`,
      actions: '<button class="small" id="kpi-history-export-btn">Export CSV</button>',
      body: split([
        { html: colTitle('Final score by quarter', 'out of 100') + `<div class="kpi-trend-row">${trendHtml}</div>` },
        { html: colTitle('Results') + tableHtml },
      ], '1fr 1.5fr'),
    });

    $('#kpi-history-export-btn').addEventListener('click', () => downloadCsv(employeeId));
  } catch (err) {
    console.error('KPI history failed to load', err);
    container.innerHTML = loadErrorPanel('Performance history couldn’t load', err, 'data-history-retry');
    container.querySelector('[data-history-retry]').addEventListener('click', () => renderKpiHistory(container, employeeId));
  }
}
