import { $, $all, escapeHtml, fmtDate, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { LEAVE_TYPES, leaveTypeLabel } from './leaveTypes.js';

let directoryCache = null;
async function getDirectory() {
  if (!directoryCache) {
    const res = await apiFetch('/api/employees/directory');
    directoryCache = res.employees || [];
  }
  return directoryCache;
}

export function switchSubTab(tabId, btn) {
  state.subTab = tabId;
  $all('.sub-nav-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $all('#tab-timeoff .tab-panel').forEach((p) => p.classList.remove('active'));
  const panel = $('#subtab-panel-' + tabId);
  if (panel) panel.classList.add('active');

  if (tabId === 'today') renderToday();
  if (tabId === 'history') renderHistory();
}
window.switchSubTab = switchSubTab;

/* ── New Request form ── */
function onTypeChange() {
  const type = $('#req-type').value;
  const fields = $('#form-fields');
  fields.style.display = type ? 'contents' : 'none';
  if (!type) return;

  const isWfh = type === 'wfh';
  $('#group-end').style.display = isWfh ? 'none' : '';
  $('#group-half-day').style.display = isWfh ? 'none' : '';
  $('#group-handover').style.display = isWfh ? 'none' : '';
  $('#label-start').textContent = isWfh ? 'WFH Date *' : 'Start Date *';

  if (isWfh) $('#req-end').value = $('#req-start').value;
}

function onStartChange() {
  if ($('#req-type').value === 'wfh') $('#req-end').value = $('#req-start').value;
  if (!$('#req-end').value || $('#req-end').value < $('#req-start').value) $('#req-end').value = $('#req-start').value;
}

async function populateHandoverSelect() {
  const sel = $('#req-handover');
  const emp = state.myEmployee;
  if (!emp) return; // no employee profile — the form itself isn't usable yet (see renderNewRequestForm)
  const dir = await getDirectory();
  sel.innerHTML = '<option value="">— Select teammate —</option>' +
    dir.filter((e) => e.id !== emp.id).map((e) => `<option value="${e.id}">${escapeHtml(e.firstName + ' ' + e.lastName)}${e.department ? ' — ' + escapeHtml(e.department) : ''}</option>`).join('');
}

async function submitRequest() {
  const btn = $('#submit-btn');
  const resultEl = $('#form-banner');
  resultEl.innerHTML = '';
  btn.disabled = true;
  try {
    const type = $('#req-type').value;
    const halfDay = !$('#group-half-day').style.display && $('#req-half-day').checked;
    const payload = {
      leaveType: type,
      startDate: $('#req-start').value,
      endDate: type === 'wfh' ? $('#req-start').value : $('#req-end').value,
      halfDay,
      halfDayPeriod: halfDay ? $('#req-half-day-period').value : undefined,
      handoverEmployeeId: $('#req-handover').value ? Number($('#req-handover').value) : undefined,
      reason: $('#req-reason').value || undefined,
    };
    const res = await apiFetch('/api/employees/leave-requests', { method: 'POST', body: JSON.stringify(payload) });
    const req = res.request;
    let banner = `<div class="alert alert-${req.status === 'auto_rejected' ? 'danger' : 'info'}">`;
    if (req.status === 'auto_rejected') {
      banner += `<div><strong>Auto-rejected.</strong> ${escapeHtml(req.autoRejectReason || '')}</div>`;
    } else {
      banner += `<div><strong>Submitted.</strong> Awaiting your manager's decision.${req.requiresDoctorNote ? ' A doctor\'s note will be required (sick leave over 2 days).' : ''}</div>`;
    }
    banner += '</div>';
    resultEl.innerHTML = banner;
    toast('Request submitted', 'info');
    $('#req-type').value = '';
    onTypeChange();
    $('#req-reason').value = '';
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  } finally {
    btn.disabled = false;
  }
}
window.submitRequest = submitRequest;

export function renderNewRequestForm() {
  const container = $('#subtab-panel-new-request');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">New Time Off Request</div>
      <div class="page-subtitle">Fields shown depend on the request type. Your manager and P&amp;C confirm in two steps.</div>
    </div>
    <div id="form-banner" class="section"></div>
    <div class="card">
      <div class="form-grid">
        <div class="form-section-title">What kind of request is this?</div>
        <div class="form-group full">
          <label class="form-label">Request Type *</label>
          <select class="form-control" id="req-type">
            <option value="">— Select request type —</option>
            ${LEAVE_TYPES.filter((t) => t.value !== 'public_holiday').map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}
          </select>
          <div class="form-hint" id="req-type-notice"></div>
        </div>

        <div id="form-fields" style="display:none;">
          <div class="form-section-title">Details</div>

          <div class="form-group">
            <label class="form-label" id="label-start">Start Date *</label>
            <input type="date" class="form-control" id="req-start">
          </div>
          <div class="form-group" id="group-end">
            <label class="form-label">End Date *</label>
            <input type="date" class="form-control" id="req-end">
          </div>

          <div class="form-group" id="group-half-day">
            <label class="form-label">Half Day?</label>
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" id="req-half-day">
              <select class="form-control" id="req-half-day-period" style="width:auto;">
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
              </select>
            </div>
          </div>

          <div class="form-group full" id="group-handover">
            <label class="form-label">Handover — Who covers for you?</label>
            <select class="form-control" id="req-handover"><option value="">— Select teammate —</option></select>
          </div>

          <div class="form-group full">
            <label class="form-label">Reason / Notes</label>
            <textarea class="form-control" id="req-reason" placeholder="Any details you want to share..." rows="3"></textarea>
          </div>

          <div class="form-group full">
            <button class="btn primary" id="submit-btn">Submit Request →</button>
          </div>
        </div>
      </div>
    </div>
  `;

  $('#req-type').addEventListener('change', () => {
    const t = LEAVE_TYPES.find((x) => x.value === $('#req-type').value);
    $('#req-type-notice').textContent = t ? 'Notice required: ' + t.notice : '';
    onTypeChange();
  });
  $('#req-start').addEventListener('change', onStartChange);
  $('#submit-btn').addEventListener('click', submitRequest);
  populateHandoverSelect();
}

/* ── Today (team status) ── */
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function renderToday() {
  const container = $('#today-content');
  container.innerHTML = `<div class="empty-state">Loading team data...</div>`;
  const res = await apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso());
  const offToday = res.offToday || [];
  $('#today-date-label').textContent = fmtDate(todayIso());
  container.innerHTML = offToday.length
    ? `<div class="team-grid">${offToday.map((o) => `
      <div class="team-tile">
        <div class="team-tile-name">${escapeHtml(o.name)}</div>
        <div class="team-tile-meta">${escapeHtml(leaveTypeLabel(o.leaveType))}${o.halfDay ? ' · half-day (' + escapeHtml(o.halfDayPeriod || '') + ')' : ''}${o.department ? ' · ' + escapeHtml(o.department) : ''}</div>
      </div>`).join('')}</div>`
    : `<div class="empty-state">Nobody's off today</div>`;
}

/* ── History ── */
// Native window.confirm() blocks the whole tab (and browser-automation
// input) until manually dismissed — a two-click inline confirm avoids that
// without introducing a modal component the codebase doesn't otherwise have.
let confirmingCancelId = null;

async function cancelRequest(id) {
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/cancel`, { method: 'POST' });
    toast('Request cancelled', 'info');
    confirmingCancelId = null;
    renderHistory();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.cancelRequest = cancelRequest;

function askCancelRequest(id) {
  confirmingCancelId = id;
  renderHistory();
}
window.askCancelRequest = askCancelRequest;

function cancelCancelRequest() {
  confirmingCancelId = null;
  renderHistory();
}
window.cancelCancelRequest = cancelCancelRequest;

async function renderHistory() {
  const container = $('#history-content');
  container.innerHTML = `<div class="empty-state">Loading history...</div>`;
  const res = await apiFetch('/api/employees/leave-requests/mine');
  const requests = res.requests || [];
  if (!requests.length) {
    container.innerHTML = `<div class="empty-state">No requests yet</div>`;
    return;
  }
  container.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Type</th><th>Dates</th><th>Status</th><th>Deduction</th><th></th></tr></thead>
        <tbody>
          ${requests.map((r) => `<tr>
            <td>${escapeHtml(leaveTypeLabel(r.leaveType))}</td>
            <td>${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ' → ' + fmtDate(r.endDate) : ''}${r.halfDay ? ' (half-day)' : ''}</td>
            <td>
              <span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span>
              ${r.autoRejectReason ? `<div class="small muted mt-8">${escapeHtml(r.autoRejectReason)}</div>` : ''}
            </td>
            <td>${r.salaryDeduction && r.salaryDeduction !== 'none'
              ? `<span class="badge badge-rejected">${escapeHtml(r.salaryDeduction.replace('_', ' '))}</span>${r.salaryDeduction === 'unpaid' && r.unpaidDaysCount ? ` <span class="small muted">(${r.unpaidDaysCount} day${r.unpaidDaysCount === 1 ? '' : 's'})</span>` : ''}`
              : '—'}</td>
            <td>${['pending', 'manager_approved'].includes(r.status)
              ? (confirmingCancelId === r.id
                ? `<span class="small">Cancel this request? </span><button class="btn small danger" onclick="cancelRequest(${r.id})">Yes</button> <button class="btn small" onclick="cancelCancelRequest()">No</button>`
                : `<button class="btn small" onclick="askCancelRequest(${r.id})">Cancel</button>`)
              : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Rules (static reference) ── */
export function renderRules() {
  $('#rules-content').innerHTML = `
    <div class="section">
      <div class="card-title">Notice Requirements &amp; Auto-Reject Rules</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Leave Type</th><th>Notice Required</th></tr></thead>
          <tbody>
            ${LEAVE_TYPES.map((t) => `<tr><td>${escapeHtml(t.label)}</td><td>${escapeHtml(t.notice)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="section alert alert-info">
      <div>Short-notice types (Short-Notice Leave, Mental Health Day) submitted with less than 1 working day's notice, and Planned/Unpaid Leave submitted with less than 3 working days' notice, are <strong>auto-rejected</strong>. Sick and Emergency leave have no notice requirement.</div>
    </div>
    <div class="section alert alert-warn">
      <div>Sick leave longer than 2 consecutive working days requires a doctor's note, submitted within 2 working days of your return.</div>
    </div>
    <div class="section alert alert-info">
      <div>Work From Home is limited to <strong>1 request per calendar month</strong>. A second request in the same month is auto-rejected.</div>
    </div>
    <div class="section">
      <div class="card-title">Approval Workflow</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><strong>Pending</strong></td><td>Submitted, awaiting your manager's decision</td></tr>
            <tr><td><strong>Pending (P&amp;C)</strong></td><td>Manager approved — awaiting People &amp; Culture's final confirmation</td></tr>
            <tr><td><strong>Approved</strong></td><td>Confirmed by People &amp; Culture</td></tr>
            <tr><td><strong>Rejected / Auto-Rejected</strong></td><td>Not approved — see the reason on your History tab</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}
