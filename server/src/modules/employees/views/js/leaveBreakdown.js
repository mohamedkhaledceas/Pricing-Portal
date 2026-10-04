import { $, escapeHtml, fmtDate } from './dom.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel } from './leaveTypes.js';
import { mountDateRangeFilter } from './dateRangePicker.js';
import { panel, plural, loadErrorPanel, fullName } from './panels.js';

let candidates = [];
let currentRange = null; // { startDate, endDate } | null

// Company-wide for both roles — manager and people_culture already have
// company-wide reach elsewhere (listTeam/managerDecision unscoping for
// manager, canManageRoster for P&C), so no direct-reports filtering here.
async function loadCandidates() {
  const res = await apiFetch('/api/employees');
  candidates = (res.employees || []).slice().sort((a, b) => (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName));
}

const COLUMNS = [
  { key: 'requested', label: 'Requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'cancelled', label: 'Cancelled' },
];

function totalsRow(rows) {
  const totals = {};
  COLUMNS.forEach((c) => { totals[c.key] = rows.reduce((sum, r) => sum + r[c.key], 0); });
  return `<tr class="leave-breakdown-totals">
    <td>Total</td>
    ${COLUMNS.map((c) => `<td class="num">${totals[c.key]}</td>`).join('')}
  </tr>`;
}

function rangeText() {
  if (!currentRange) return 'All time';
  return `${fmtDate(currentRange.startDate)} – ${fmtDate(currentRange.endDate)}`;
}

// Zero cells render as a muted dash so the real counts stand out.
function countCell(n) {
  return `<td class="num">${n ? n : '<span class="muted">–</span>'}</td>`;
}

async function renderBreakdown(employeeId) {
  const container = $('#leave-breakdown-content');
  const person = candidates.find((c) => c.id === employeeId);
  const title = person ? fullName(person) : 'Leave breakdown';
  container.innerHTML = panel({ title, meta: escapeHtml(rangeText()), body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });
  try {
    const qs = currentRange ? `?${new URLSearchParams(currentRange).toString()}` : '';
    const res = await apiFetch(`/api/employees/leave-requests/${employeeId}/breakdown${qs}`);
    const rows = res.breakdown || [];
    // Leave types with nothing requested in this range are dropped — a
    // table of mostly zero rows hides the few that matter.
    const used = rows.filter((r) => COLUMNS.some((c) => r[c.key]));
    const total = rows.reduce((sum, r) => sum + r.requested, 0);
    container.innerHTML = panel({
      title,
      meta: `${escapeHtml(rangeText())}, ${total} ${plural(total, 'request', 'requests')}`,
      body: `<div class="panel-body">${used.length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Leave type</th>${COLUMNS.map((c) => `<th class="num">${c.label}</th>`).join('')}</tr></thead>
            <tbody>
              ${used.map((r) => `<tr>
                <td>${escapeHtml(leaveTypeLabel(r.leaveType))}</td>
                ${COLUMNS.map((c) => countCell(r[c.key])).join('')}
              </tr>`).join('')}
              ${totalsRow(rows)}
            </tbody>
          </table>
        </div>` : '<div class="list-empty">No leave requests in this period.</div>'}</div>`,
    });
  } catch (err) {
    console.error('Leave breakdown failed to load', err);
    container.innerHTML = loadErrorPanel('This leave breakdown couldn’t load', err, 'data-lb-retry');
    container.querySelector('[data-lb-retry]').addEventListener('click', () => renderBreakdown(employeeId));
  }
}

export async function renderLeaveReport() {
  const container = $('#leave-report-content');
  container.innerHTML = '<div class="list-empty" style="border:none;">Loading…</div>';
  try {
    await Promise.all([loadCandidates(), window.Departments.load(apiFetch)]);
  } catch (err) {
    console.error('Leave report failed to load', err);
    container.innerHTML = loadErrorPanel('The leave report couldn’t load', err, 'data-lr-retry');
    container.querySelector('[data-lr-retry]').addEventListener('click', renderLeaveReport);
    return;
  }

  if (!candidates.length) {
    container.innerHTML = panel({ title: 'Leave report', body: '<div class="panel-body"><div class="list-empty">No employees on the roster yet.</div></div>' });
    return;
  }

  // Active people first; inactive ones stay pickable (their history still
  // matters) but are grouped and labelled so they don't crowd the list.
  const optionHtml = (c) => `<option value="${c.id}">${escapeHtml(fullName(c))}${c.department ? ' — ' + escapeHtml(window.Departments.labelFor(c.department)) : ''}</option>`;
  const active = candidates.filter((c) => c.active);
  const inactive = candidates.filter((c) => !c.active);

  currentRange = null;
  container.innerHTML = `
    <div class="kpi-toolbar">
      <div class="form-group" style="min-width:260px;">
        <label class="form-label" for="leave-breakdown-employee-select">Employee</label>
        <select class="form-control" id="leave-breakdown-employee-select">
          <optgroup label="Active">${active.map(optionHtml).join('')}</optgroup>
          ${inactive.length ? `<optgroup label="Inactive">${inactive.map(optionHtml).join('')}</optgroup>` : ''}
        </select>
      </div>
      <div class="form-group" id="leave-breakdown-date-range-slot"></div>
    </div>
    <div id="leave-breakdown-content"></div>
  `;

  // Selecting a person loads their breakdown immediately — no separate
  // "View" button/click needed.
  const refresh = () => renderBreakdown(Number($('#leave-breakdown-employee-select').value));
  $('#leave-breakdown-employee-select').addEventListener('change', refresh);
  mountDateRangeFilter($('#leave-breakdown-date-range-slot'), {
    onApply: (range) => {
      currentRange = range.startDate ? range : null;
      refresh();
    },
  });
  refresh();
}
