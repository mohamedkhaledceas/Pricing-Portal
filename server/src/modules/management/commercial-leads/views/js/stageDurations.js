import { escapeHtml } from './dom.js';

export function renderStageDurations(rows) {
  const tbody = document.querySelector('#stageDurationTable tbody');
  if (!tbody) return; // card is commented out pending its move into the live-deals table
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No completed stage transitions recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr><td>${escapeHtml(r.status)}</td><td>${r.transitions}</td><td>${r.avgDays}</td><td>${r.minDays}</td><td>${r.maxDays}</td></tr>
  `).join('');
}
