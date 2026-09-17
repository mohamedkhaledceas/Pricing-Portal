import { $, $all, escapeHtml, fmtDate, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { LEAVE_TYPES, leaveTypeLabel, AVAILABILITY_OPTIONS, availabilityLabel, STATUS_LABELS, balanceBucketForType } from './leaveTypes.js';

async function getDirectory() {
  const res = await apiFetch('/api/employees/directory');
  return res.employees || [];
}

// Fetched once per form render (same lifetime as directoryById) — warn-only,
// never blocks the form if the fetch fails.
let myBalances = null;
async function loadMyBalances() {
  try {
    const res = await apiFetch('/api/employees/leave-requests/balances/mine');
    myBalances = res.balances || null;
  } catch (err) {
    myBalances = null;
  }
}

export function switchSubTab(tabId, btn) {
  state.subTab = tabId;
  $all('.sub-nav-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $all('#tab-timeoff .tab-panel').forEach((p) => p.classList.remove('active'));
  const panel = $('#subtab-panel-' + tabId);
  if (panel) panel.classList.add('active');

  if (tabId === 'today') renderToday();
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
  $('#group-availability').style.display = isWfh ? 'none' : '';
  $('#group-handover').style.display = isWfh ? 'none' : '';
  $('#label-start').textContent = isWfh ? 'WFH Date *' : 'Start Date *';

  if (isWfh) $('#req-end').value = $('#req-start').value;
}

// Shared with requestsCenter.js's own conflict-warning rendering (same
// shape, same warn-only conflictPairService.findOverlaps result) — kept
// as a small local duplicate rather than a shared module, matching this
// codebase's existing precedent of each view file keeping its own tiny
// copy of this kind of helper.
function conflictWarningsHtml(conflicts) {
  if (!conflicts || !conflicts.length) return '';
  return `<div class="alert alert-warn">${conflicts.map((w) => `
    <div>⚠ Your conflict pair <strong>${escapeHtml(w.partnerName)}</strong> already has ${escapeHtml((STATUS_LABELS[w.status] || w.status).toLowerCase())}
    ${escapeHtml(leaveTypeLabel(w.leaveType))} on ${fmtDate(w.startDate)}${w.endDate !== w.startDate ? ' → ' + fmtDate(w.endDate) : ''}.</div>`).join('')}</div>`;
}

// Live, non-blocking check as the requester picks dates — before they've
// even submitted, per the user's request that both sides see the conflict
// "before requesting and when filling the form". Re-checked on every
// start/end/type change; harmless to call with an incomplete form (the
// controller requires both dates, so an empty one just no-ops here).
async function checkConflictsLive() {
  const el = $('#form-conflict-warning');
  if (!el) return;
  const type = $('#req-type').value;
  const startDate = $('#req-start').value;
  const endDate = type === 'wfh' ? startDate : $('#req-end').value;
  if (!startDate || !endDate) { el.innerHTML = ''; return; }
  try {
    const res = await apiFetch(`/api/employees/conflict-pairs/mine/overlap?startDate=${startDate}&endDate=${endDate}`);
    el.innerHTML = conflictWarningsHtml(res.conflicts);
  } catch (err) {
    el.innerHTML = ''; // best-effort — never block filling out the form over this check itself failing
  }
}

// Warn-only balance check — fires as soon as a type is picked, no dates
// needed. Uncapped types (sick/unpaid/public_holiday) show nothing. Never
// blocks submission; see the leave-balance plan's "no new auto-reject".
function renderBalanceWarning() {
  const el = $('#form-balance-warning');
  if (!el) return;
  const type = $('#req-type').value;
  const bucket = type && balanceBucketForType(type);
  const b = bucket && myBalances && myBalances[bucket];
  if (!b || b.remaining > b.total * 0.3) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-warn">
    <div>⚠ You have <strong>${b.remaining}${b.unit === 'hours' ? 'h' : ''} of ${b.total}${b.unit === 'hours' ? 'h' : ''}</strong> ${escapeHtml(b.label)} remaining this ${b.period} — you're running low.</div>
  </div>`;
}

// Live, non-blocking preview of the same notice-window rule submit() already
// enforces — surfaced early so the requester sees the risk before they
// submit, not just in the after-the-fact auto-reject banner.
async function checkNoticeLive() {
  const el = $('#form-notice-warning');
  if (!el) return;
  const type = $('#req-type').value;
  const startDate = $('#req-start').value;
  if (!type || !startDate) { el.innerHTML = ''; return; }
  try {
    const res = await apiFetch(`/api/employees/leave-requests/notice-check?leaveType=${type}&startDate=${startDate}`);
    if (res.autoReject) {
      el.innerHTML = `<div class="alert alert-warn"><div>⚠ This falls within the notice period for ${escapeHtml(leaveTypeLabel(type))} — ${escapeHtml(res.reason || '')} It may be auto-rejected if you submit now.</div></div>`;
    } else if (res.lateWfhSubmission) {
      el.innerHTML = `<div class="alert alert-warn"><div>⚠ Same-day Work From Home must be submitted before 9:00 AM. Submitting now will still go through, but a salary deduction may be applied.</div></div>`;
    } else {
      el.innerHTML = '';
    }
  } catch (err) {
    el.innerHTML = ''; // best-effort — never block filling out the form over this check itself failing
  }
}

function onStartChange() {
  if ($('#req-type').value === 'wfh') $('#req-end').value = $('#req-start').value;
  if (!$('#req-end').value || $('#req-end').value < $('#req-start').value) $('#req-end').value = $('#req-start').value;
  checkConflictsLive();
  checkNoticeLive();
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
  const originalBtnHtml = btn.innerHTML;
  btn.disabled = true;
  // The ClickUp sync this now waits on (see clickupLeaveSync.js) reads each
  // field back and retries on failure, so a submit can take a few seconds
  // instead of feeling instant — without this, the button just looked
  // frozen/unresponsive for that whole window.
  btn.innerHTML = '<span class="btn-spinner"></span>Submitting…';
  try {
    const type = $('#req-type').value;
    const isWfh = type === 'wfh';
    const reason = $('#req-reason').value.trim();
    if (!reason) {
      resultEl.innerHTML = `<div class="alert alert-danger"><div>A reason is required.</div></div>`;
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
      return;
    }
    const payload = {
      leaveType: type,
      startDate: $('#req-start').value,
      endDate: isWfh ? $('#req-start').value : $('#req-end').value,
      availability: isWfh ? undefined : $('#req-availability').value,
      handoverEmployeeId: $('#req-handover').value ? Number($('#req-handover').value) : undefined,
      reason,
    };
    const res = await apiFetch('/api/employees/leave-requests', { method: 'POST', body: JSON.stringify(payload) });
    const req = res.request;
    const noManager = !(state.myEmployee && state.myEmployee.managerEmployeeId);
    let banner = `<div class="alert alert-${req.status === 'auto_rejected' ? 'danger' : 'info'}">`;
    if (req.status === 'auto_rejected') {
      banner += `<div><strong>Auto-rejected.</strong> ${escapeHtml(req.autoRejectReason || '')}</div>`;
    } else if (noManager) {
      banner += `<div><strong>Submitted.</strong> You don't have a manager assigned, so this went straight to People &amp; Culture for review.${req.requiresDoctorNote ? ' A doctor\'s note will be required (sick leave over 2 days).' : ''}</div>`;
    } else {
      banner += `<div><strong>Submitted.</strong> Awaiting your manager's decision.${req.requiresDoctorNote ? ' A doctor\'s note will be required (sick leave over 2 days).' : ''}</div>`;
    }
    banner += '</div>';
    // Echoes the same warn-only check the live pre-submit banner already
    // showed — belt-and-suspenders in case that check was skipped or is
    // stale by submit time (see timeOffService.submit's own comment).
    banner += conflictWarningsHtml(req.conflictWarnings);
    resultEl.innerHTML = banner;
    toast('Request submitted', 'info');
    $('#req-type').value = '';
    onTypeChange();
    $('#req-reason').value = '';
    $('#form-conflict-warning').innerHTML = '';
    $('#form-balance-warning').innerHTML = '';
    $('#form-notice-warning').innerHTML = '';
    loadMyBalances();
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
  }
}
window.submitRequest = submitRequest;

export function renderNewRequestForm() {
  const container = $('#subtab-panel-new-request');
  const noManager = !(state.myEmployee && state.myEmployee.managerEmployeeId);
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">New Time Off Request</div>
      <div class="page-subtitle">Fields shown depend on the request type. Your manager and P&amp;C confirm in two steps.</div>
    </div>
    ${noManager ? `<div class="section alert alert-warn">
      <div>⚠ <strong>You haven't been assigned a direct manager yet.</strong> Requests you submit will skip the manager-approval step and go straight to People &amp; Culture for review. Contact People &amp; Culture if you believe this is a mistake. Please update your account to specify who you report directly to.</div>
    </div>` : ''}
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
          <div class="form-group full" id="form-balance-warning"></div>
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
          <div class="form-group full" id="form-notice-warning"></div>

          <div class="form-group" id="group-availability">
            <label class="form-label">Availability *</label>
            <select class="form-control" id="req-availability">
              ${AVAILABILITY_OPTIONS.map((a) => `<option value="${a.value}">${escapeHtml(a.label)}</option>`).join('')}
            </select>
            <div class="form-hint">How reachable will you be while you're off?</div>
          </div>

          <div class="form-group full" id="group-handover">
            <label class="form-label">Handover — Who covers for you?</label>
            <select class="form-control" id="req-handover"><option value="">— Select teammate —</option></select>
          </div>

          <div class="form-group full" id="form-conflict-warning"></div>

          <div class="form-group full">
            <label class="form-label">Reason / Notes *</label>
            <textarea class="form-control" id="req-reason" placeholder="Required — tell your manager why you're requesting this" rows="3" required></textarea>
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
    checkConflictsLive();
    renderBalanceWarning();
    checkNoticeLive();
  });
  $('#req-start').addEventListener('change', onStartChange);
  $('#req-end').addEventListener('change', checkConflictsLive);
  $('#submit-btn').addEventListener('click', submitRequest);
  populateHandoverSelect();
  loadMyBalances().then(renderBalanceWarning);
}

/* ── Today (team status) ── */
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function renderToday() {
  const container = $('#today-content');
  container.innerHTML = `<div class="empty-state">Loading team data...</div>`;
  const [res, partnersRes] = await Promise.all([
    apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
    apiFetch('/api/employees/conflict-pairs/mine'),
  ]);
  const offToday = res.offToday || [];
  const myPartnerIds = new Set((partnersRes.partners || []).map((p) => p.id));
  $('#today-date-label').textContent = fmtDate(todayIso());
  container.innerHTML = offToday.length
    ? `<div class="team-grid">${offToday.map((o) => {
      const isPartner = myPartnerIds.has(o.employeeId);
      return `
      <div class="team-tile${isPartner ? ' conflict-pair' : ''}">
        <div class="team-tile-name">${escapeHtml(o.name)}</div>
        <div class="team-tile-meta">${escapeHtml(leaveTypeLabel(o.leaveType))}${o.availability ? ' · ' + escapeHtml(availabilityLabel(o.availability)) : ''}${o.department ? ' · ' + escapeHtml(o.department) : ''}</div>
        ${isPartner ? `<div class="team-tile-conflict-flag">⚠ Your conflict pair</div>` : ''}
      </div>`;
    }).join('')}</div>`
    : `<div class="empty-state">Nobody's off today</div>`;
}

// My own request history/cancel (formerly here as "My History") moved to
// the Requests Center tab (requestsCenter.js) — gathered there alongside
// profile-change history, search/filter, and every approval queue, per
// Portal §21.

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
      <div>Work From Home is limited to <strong>1 request per calendar month</strong>. A second request in the same month is auto-rejected. A same-day WFH request must be submitted <strong>before 9:00 AM</strong> — submitting after 9:00 AM for a same-day request is still accepted, but a salary deduction will be applied.</div>
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
    <div class="section alert alert-warn">
      <div>If you don't have a direct manager assigned, your requests skip the manager-approval step entirely and go straight to People &amp; Culture's queue as <strong>Pending (P&amp;C)</strong>.</div>
    </div>
  `;
}
