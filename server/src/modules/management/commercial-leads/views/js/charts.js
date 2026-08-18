import { escapeHtml } from './dom.js';

export function renderBarChart(containerId, points) {
  const el = document.getElementById(containerId);
  if (!points || points.length === 0) {
    el.innerHTML = '<div class="empty-note">No data yet.</div>';
    return;
  }
  const max = Math.max(...points.map((p) => p.count));
  el.className = 'bar-chart';
  el.innerHTML = points.map((p) => `
    <div class="bar-col">
      <div class="bar-value">${p.count}</div>
      <div class="bar-track"><div class="bar-fill" style="height:${Math.max(2, (p.count / max) * 100)}%"></div></div>
      <div class="bar-label" title="${escapeHtml(p.value)}">${escapeHtml(p.value)}</div>
    </div>
  `).join('');
}

// Simple relative-luminance check so badge text stays readable against
// whatever hex ClickUp assigned that status — colors are external and
// arbitrary, so this can't be picked once and hardcoded per status.
export function contrastTextColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#191919' : '#ffffff';
}

const STATUS_ORDER = [
  'leads', 'qualified', 'in queue ', 'in progress', 'onboarding', 'stuck',
  'contract completed', 'complete', 'lost', 'unqulified', 'no answer',
  'terminated by client', 'terminated by agency',
];

export function renderStats(stats) {
  const latestDate = (dim) => {
    const points = stats[dim] || [];
    if (points.length === 0) return [];
    const last = points[points.length - 1].date;
    return points.filter((p) => p.date === last);
  };

  const statusPoints = latestDate('status');
  const ordered = STATUS_ORDER
    .map((s) => statusPoints.find((p) => p.value === s))
    .filter(Boolean)
    .concat(statusPoints.filter((p) => !STATUS_ORDER.includes(p.value)));
  renderBarChart('chartStatus', ordered);

  renderBarChart('chartSource', latestDate('source').sort((a, b) => b.count - a.count));
  renderBarChart('chartBusinessLine', latestDate('business_line').sort((a, b) => b.count - a.count));
  renderBarChart('chartCountry', latestDate('country').sort((a, b) => b.count - a.count));
}
