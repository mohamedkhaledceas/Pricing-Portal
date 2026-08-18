import { $, escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';
import { state } from './state.js';

function formatPercent(rate) {
  return rate === null || rate === undefined ? 'n/a' : (rate * 100).toFixed(1) + '%';
}

const QK_TILES = [
  { key: 'cohortSize', label: 'Leads' },
  { key: 'qualifiedCount', label: 'Qualified' },
  { key: 'onboardingCount', label: 'Onboarding' },
  { key: 'inProgressCount', label: 'In Progress' },
  { key: 'conversion1Rate', label: 'Leads → In Progress', percent: true },
  { key: 'conversion2Rate', label: 'Contract Completed', percent: true },
  { key: 'wonCount', label: 'Won' },
  { key: 'lostCount', label: 'Lost' },
  // { key: 'repeatClientRate', label: 'Repeat Client Rate', percent: true },
];

export function renderQuarterlyKpis(data) {
  state.quarterlyState = data;
  $('#qkQuarterLabel').textContent = data.quarter + (data.isCurrent ? ' (current)' : '');
  $('#qkEstimatedBadge').hidden = !data.isEstimated;
  $('#qkFrozenBadge').hidden = !data.snapshot;

  const m = data.metrics;
  const snap = data.snapshot;
  $('#qkGrid').innerHTML = QK_TILES.map((t) => {
    const raw = m[t.key];
    const value = t.percent ? formatPercent(raw) : (raw ?? 0);
    // Only shown when a frozen quarter-close snapshot exists AND differs
    // from the live figure — right after freezing they're identical (the
    // cohort hasn't moved yet), and re-showing an identical number as a
    // second line would just be clutter, not information.
    let compareHtml = '';
    if (snap) {
      const snapRaw = snap[t.key];
      if (snapRaw !== raw) {
        const snapValue = t.percent ? formatPercent(snapRaw) : (snapRaw ?? 0);
        compareHtml = `<div class="compare">at close: ${escapeHtml(String(snapValue))}</div>`;
      }
    }
    return `
      <div class="kpi-tile">
        <div class="value">${value}</div>
        <div class="label">${escapeHtml(t.label)}</div>
        ${compareHtml}
      </div>
    `;
  }).join('');

  const idx = data.availableQuarters.indexOf(data.quarter);
  $('#qkPrev').disabled = idx <= 0;
  $('#qkNext').disabled = idx === -1 || idx >= data.availableQuarters.length - 1;
}

export async function selectQuarter(quarter) {
  try {
    const data = await apiFetch('/api/commercial-lead/quarterly-kpis?quarter=' + encodeURIComponent(quarter));
    renderQuarterlyKpis(data);
  } catch (err) {}
}

export function bindQuarterlyUi() {
  $('#qkPrev').addEventListener('click', () => {
    if (!state.quarterlyState) return;
    const idx = state.quarterlyState.availableQuarters.indexOf(state.quarterlyState.quarter);
    if (idx > 0) selectQuarter(state.quarterlyState.availableQuarters[idx - 1]);
  });
  $('#qkNext').addEventListener('click', () => {
    if (!state.quarterlyState) return;
    const idx = state.quarterlyState.availableQuarters.indexOf(state.quarterlyState.quarter);
    if (idx !== -1 && idx < state.quarterlyState.availableQuarters.length - 1) {
      selectQuarter(state.quarterlyState.availableQuarters[idx + 1]);
    }
  });
}
