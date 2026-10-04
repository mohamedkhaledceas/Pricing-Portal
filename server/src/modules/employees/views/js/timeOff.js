import { $, $all, escapeHtml, fmtDate, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { LEAVE_TYPES, leaveTypeLabel, AVAILABILITY_OPTIONS, availabilityLabel, STATUS_LABELS, balanceBucketForType } from './leaveTypes.js';
import { panel, split, colTitle, personRow, list, balancesHtml, loadErrorPanel, plural } from './panels.js';

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
  const side = $('#to-balances');
  if (side) side.innerHTML = balancesHtml(myBalances);
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
    ${panel({
      title: 'Request details',
      body: split([
        { html: `      <div class="form-grid">
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
            <button class="btn primary" id="submit-btn">Submit request</button>
          </div>
        </div>
      </div>` },
        { html: colTitle('Balance remaining') + '<div id="to-balances"><div class="list-empty">Loading…</div></div>'
            + '<div class="footnote">Notice periods and approval steps are in <button class="link-btn" data-subtab-link="rules">Leave rules</button>.</div>' },
      ], '1.7fr 1fr'),
    })}
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
  container.querySelector('[data-subtab-link]').addEventListener('click', (e) => {
    const tab = e.currentTarget.dataset.subtabLink;
    switchSubTab(tab, $('#subtab-' + tab));
  });
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
  $('#today-date-label').textContent = fmtDate(todayIso());
  container.innerHTML = panel({ title: 'Off today', body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });
  let offToday, myPartnerIds;
  try {
    const [res, partnersRes] = await Promise.all([
      apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
      apiFetch('/api/employees/conflict-pairs/mine'),
    ]);
    offToday = res.offToday || [];
    myPartnerIds = new Set((partnersRes.partners || []).map((p) => p.id));
  } catch (err) {
    console.error('Team status failed to load', err);
    container.innerHTML = loadErrorPanel('Team status couldn’t load', err, 'data-today-retry');
    container.querySelector('[data-today-retry]').addEventListener('click', renderToday);
    return;
  }
  const rows = offToday.map((o) => {
    const isPartner = myPartnerIds.has(o.employeeId);
    const meta = [leaveTypeLabel(o.leaveType), o.availability ? availabilityLabel(o.availability) : null, o.department].filter(Boolean).map(escapeHtml).join(', ');
    return personRow(o.name, meta, { flagged: isPartner, flag: isPartner ? 'Your conflict pair' : '' });
  });
  container.innerHTML = panel({
    title: 'Off today',
    meta: `${offToday.length} ${plural(offToday.length, 'person', 'people')}`,
    body: `<div class="panel-body">${list(rows, 'Nobody is off today.', 'list-cols')}</div>`,
  });
}

// My own request history/cancel (formerly here as "My History") moved to
// the Requests Center tab (requestsCenter.js) — gathered there alongside
// profile-change history, search/filter, and every approval queue, per
// Portal §21.

/* ── Rules (static reference) ── */
function ruleRow(title, meta) {
  return `<li class="list-row"><div class="list-main"><div class="list-title" style="font-weight:400;">${title}</div></div><span class="list-meta">${meta}</span></li>`;
}

export function renderRules() {
  const statusRows = [
    ['pending', 'Submitted, awaiting your manager’s decision'],
    ['manager_approved', 'Manager approved — awaiting People &amp; Culture’s final confirmation'],
    ['approved', 'Confirmed by People &amp; Culture'],
    ['rejected', 'Not approved — the reason is shown on the Requests tab'],
    ['auto_rejected', 'Broke a notice rule at submission — the reason is shown on the Requests tab'],
  ].map(([status, meaning]) => `<li class="list-row">
      <span class="badge badge-${status}" style="min-width:118px;text-align:center;">${escapeHtml(STATUS_LABELS[status])}</span>
      <div class="list-main"><div class="list-meta" style="color:var(--ink-2);">${meaning}</div></div>
    </li>`);

  $('#rules-content').innerHTML = `<div class="stack">
    ${panel({
      title: 'Notice periods',
      meta: 'Requests inside the notice period are auto-rejected',
      body: split([
        { html: colTitle('Notice required') + list(LEAVE_TYPES.map((t) => ruleRow(escapeHtml(t.label), escapeHtml(t.notice))), '') },
        { html: colTitle('Auto-reject rules') + `<p class="panel-text">Short-notice types (Short-Notice Leave, Mental Health Day) submitted with less than 1 working day’s notice, and Planned/Unpaid Leave submitted with less than 3 working days’ notice, are <strong>auto-rejected</strong>.</p>
            <p class="panel-text">Sick and Emergency leave have no notice requirement.</p>` },
      ], '1.2fr 1fr'),
    })}
    ${panel({
      title: 'Approval workflow',
      body: split([
        { html: colTitle('What each status means') + list(statusRows, '') },
        { html: colTitle('No direct manager?') + `<p class="panel-text">If you don’t have a direct manager assigned, your requests skip the manager-approval step entirely and go straight to People &amp; Culture’s queue as <strong>Pending (P&amp;C)</strong>.</p>` },
      ], '1.5fr 1fr'),
    })}
    ${panel({
      title: 'Special cases',
      body: split([
        { html: colTitle('Sick leave over 2 days') + `<p class="panel-text">Sick leave longer than 2 consecutive working days requires a doctor’s note, submitted within 2 working days of your return.</p>` },
        { html: colTitle('Work from home') + `<p class="panel-text">Limited to <strong>1 request per calendar month</strong>. A request beyond the limit is not auto-rejected — it goes through the normal approval flow, and People &amp; Culture will see that you’ve gone over quota when reviewing it.</p>
            <p class="panel-text">A same-day request must be submitted <strong>before 9:00 AM</strong>. Submitting after 9:00 AM is still accepted, but a salary deduction will be applied.</p>` },
      ]),
    })}
  </div>`;
}
