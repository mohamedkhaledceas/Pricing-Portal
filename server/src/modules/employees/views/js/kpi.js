import { $, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { renderKpiHistory } from './kpiHistory.js';
import { renderKpiTeam } from './kpiTeam.js';
import { renderKpiPeerReview } from './kpiPeerReview.js';
import { renderKpiMappingAdmin } from './kpiMappingAdmin.js';
import { scoreColor, bar, statusBadge, ratingOptionsHtml } from './kpiShared.js';

const SOURCE_LABELS = { auto: 'Auto — ClickUp', semi: 'AM fills field', manual: 'Manual — P&C', goals: 'ClickUp Goals', odoo: 'Odoo' };
const KPI_PROFILES = ['content', 'artdirector', 'aidesigner', 'production', 'am', 'pandc', 'heads', 'design'];

let viewCandidates = [];
let viewerEmployee = null;
let kpiPerms = { isPeopleCulture: false, hasReports: false };
let currentQuarterInfo = null;
let availableQuarters = [];
let activeView = 'overview';

function quarterOptionsHtml(selected) {
  return availableQuarters.map((q) => `<option value="${q}" ${q === selected ? 'selected' : ''}>${escapeHtml(q)}</option>`).join('');
}

async function loadViewCandidates() {
  viewerEmployee = state.myEmployee;
  const byId = {};
  if (viewerEmployee) byId[viewerEmployee.id] = { id: viewerEmployee.id, firstName: viewerEmployee.firstName, lastName: viewerEmployee.lastName, self: true };

  kpiPerms.isPeopleCulture = !!(state.currentUser && state.currentUser.role === 'people_culture');
  kpiPerms.isAdmin = !!(state.currentUser && state.currentUser.role === 'admin');
  kpiPerms.isManager = !!(state.currentUser && state.currentUser.role === 'manager');
  kpiPerms.hasReports = false;

  try {
    if (kpiPerms.isPeopleCulture) {
      const res = await apiFetch('/api/employees');
      (res.employees || []).forEach((e) => { byId[e.id] = { id: e.id, firstName: e.firstName, lastName: e.lastName }; });
    } else {
      const res = await apiFetch('/api/employees/team');
      (res.employees || []).forEach((e) => {
        byId[e.id] = { id: e.id, firstName: e.firstName, lastName: e.lastName };
        kpiPerms.hasReports = true;
      });
    }
  } catch (err) { /* not permitted to list others — self-only picker */ }

  viewCandidates = Object.values(byId);
}

async function loadCurrentQuarter() {
  try {
    currentQuarterInfo = await apiFetch('/api/employees/kpi/current-quarter');
  } catch (err) {
    currentQuarterInfo = null;
  }
}

async function loadAvailableQuarters() {
  try {
    const res = await apiFetch('/api/employees/kpi/available-quarters');
    availableQuarters = res.quarters || [];
  } catch (err) {
    availableQuarters = [];
  }
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------

async function loadNotifications() {
  try {
    return await apiFetch('/api/employees/kpi/notifications');
  } catch (err) {
    return { notifications: [], unreadCount: 0 };
  }
}

async function renderNotificationBell() {
  const holder = $('#kpi-notif-holder');
  if (!holder) return;
  const { notifications, unreadCount } = await loadNotifications();
  holder.innerHTML = `
    <button class="btn small" id="kpi-notif-btn" style="position:relative;">
      Feedback${unreadCount > 0 ? ` <span class="kpi-notif-badge">${unreadCount}</span>` : ''}
    </button>
    <div id="kpi-notif-panel" class="kpi-notif-panel" hidden>
      ${notifications.length === 0 ? '<div class="muted small" style="padding:10px;">No feedback notifications yet.</div>' : notifications.map((n) => `
        <div class="kpi-notif-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-link="${escapeHtml(n.link || '')}">
          <div class="kpi-notif-title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="kpi-notif-body">${escapeHtml(n.body)}</div>` : ''}
          <div class="muted small">${escapeHtml(n.created_at || '')}</div>
        </div>`).join('')}
    </div>`;

  $('#kpi-notif-btn').addEventListener('click', () => {
    const panel = $('#kpi-notif-panel');
    panel.hidden = !panel.hidden;
  });

  document.querySelectorAll('#kpi-notif-panel .kpi-notif-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      await apiFetch(`/api/employees/kpi/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
      const [employeeId, quarter] = (el.dataset.link || '').split(':');
      if (employeeId && quarter) {
        activeView = 'overview';
        renderSubNav();
        renderActiveView(Number(employeeId), quarter);
      }
      renderNotificationBell();
    });
  });
}

// ---------------------------------------------------------------------
// Required Actions
// ---------------------------------------------------------------------

async function renderRequiredActions(quarter) {
  const container = $('#kpi-required-actions');
  if (!container) return;
  try {
    const { actions } = await apiFetch(`/api/employees/kpi/required-actions?quarter=${encodeURIComponent(quarter)}`);
    if (actions.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="card section kpi-required-actions-card">
        <div class="card-title">Required Actions</div>
        ${actions.map((a) => `
          <div class="kpi-action-row">
            <span>${a.employeeName ? escapeHtml(a.employeeName) + ' — ' : ''}${escapeHtml(a.message)}</span>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = '';
  }
}

// ---------------------------------------------------------------------
// Overview (single-employee breakdown)
// ---------------------------------------------------------------------

async function enterSelfEvaluation(employeeId, quarter) {
  const dims = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
  const payload = { quarter };
  for (const d of dims) {
    const v = $('#se-' + d).value;
    if (v !== '') payload[d] = Number(v);
  }
  payload.comment = $('#se-comment').value || '';
  try {
    await apiFetch(`/api/employees/kpi/${employeeId}/self-evaluation`, { method: 'POST', body: JSON.stringify(payload) });
    toast('Self-evaluation saved', 'info');
    renderOverview(employeeId, quarter);
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.kpiEnterSelfEvaluation = enterSelfEvaluation;

async function enterMetricScore(employeeId, quarter, metricId) {
  const input = $('#metric-input-' + metricId);
  const commentInput = $('#metric-comment-' + metricId);
  const raw = input.value;
  if (raw === '') return;
  try {
    await apiFetch(`/api/employees/kpi/${employeeId}/manual-entry`, {
      method: 'POST',
      body: JSON.stringify({
        quarter, metricId,
        actualValue: isNaN(Number(raw)) ? raw : Number(raw),
        comment: commentInput ? commentInput.value : '',
      }),
    });
    toast(`${metricId} saved`, 'info');
    renderOverview(employeeId, quarter);
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.kpiEnterMetricScore = enterMetricScore;

function canEnterMetric(target) {
  if (!viewerEmployee || !target) return false;
  if (kpiPerms.isPeopleCulture) return true;
  const cand = viewCandidates.find((c) => c.id === target);
  return !!cand && !cand.self; // populated from /team when actor is a manager, not P&C
}

function isSelf(employeeId) {
  return viewerEmployee && employeeId === viewerEmployee.id;
}

// Per-employee ClickUp targets are set by the manager or admin auth role
// only — not scoped to "this employee's own manager", and deliberately
// excludes P&C, unlike score/comment entry.
function canSetTarget() {
  return kpiPerms.isAdmin || kpiPerms.isManager;
}

async function setEmployeeTarget(employeeId, quarter, metricId) {
  const input = $('#target-input-' + metricId);
  const raw = input.value;
  if (raw === '' || isNaN(Number(raw))) { toast('Enter a numeric target', 'danger'); return; }
  try {
    await apiFetch(`/api/employees/kpi/${employeeId}/targets`, {
      method: 'POST',
      body: JSON.stringify({ quarter, metricId, targetValue: Number(raw) }),
    });
    toast(`${metricId} target saved`, 'info');
    renderOverview(employeeId, quarter);
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.kpiSetEmployeeTarget = setEmployeeTarget;

function pillarASectionHtml(pillarA, selfEvaluation, employeeId, quarter) {
  const dims = pillarA.dimensions.map((d) => {
    const selfDim = selfEvaluation ? selfEvaluation.dimensions.find((s) => s.key === d.key) : null;
    return `
    <div class="kpi-metric-row">
      <div class="kpi-metric-top">
        <div class="kpi-metric-name">${escapeHtml(d.label)}</div>
        <div class="kpi-metric-right">
          <span class="kpi-metric-pts" style="color:${scoreColor(d.score, 10)};">${d.score === null ? '—' : d.score}</span><span class="muted small">/10</span>
          ${selfDim ? `<span class="muted small" style="margin-left:8px;">self: ${selfDim.score === null ? '—' : selfDim.score}</span>` : ''}
        </div>
      </div>
      ${bar(d.score || 0, 10)}
    </div>`;
  }).join('');

  const selfEntry = isSelf(employeeId) ? `
    <div class="card section" style="margin-top:12px;">
      <div class="card-title">Your Self-Evaluation <span class="small muted">(comparison only — not counted in your score)</span></div>
      <div class="form-grid">
        ${['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'].map((d) => {
          const selfDim = selfEvaluation ? selfEvaluation.dimensions.find((s) => s.key === d) : null;
          const selected = selfDim && selfDim.score !== null ? Math.round(selfDim.score) : null;
          return `
          <div class="form-group">
            <label class="form-label">${d[0].toUpperCase() + d.slice(1)}</label>
            <select class="form-control" id="se-${d}">${ratingOptionsHtml(selected)}</select>
          </div>`;
        }).join('')}
        <div class="form-group full">
          <label class="form-label">Comment</label>
          <textarea class="form-control" id="se-comment" rows="2">${escapeHtml(selfEvaluation ? selfEvaluation.comment || '' : '')}</textarea>
        </div>
        <div class="form-group full"><button class="btn small" onclick="kpiEnterSelfEvaluation(${employeeId}, '${quarter}')">${selfEvaluation ? 'Update' : 'Submit'} Self-Evaluation</button></div>
      </div>
    </div>` : (selfEvaluation ? `
    <div class="card section" style="margin-top:12px;">
      <div class="card-title">Self-Evaluation <span class="small muted">(comparison only)</span></div>
      ${selfEvaluation.comment ? `<div class="small muted">${escapeHtml(selfEvaluation.comment)}</div>` : ''}
    </div>` : '');

  return `
    <div class="kpi-section-title">Pillar A — Peer Review (60%)</div>
    <div class="card">${dims}</div>
    ${selfEntry}`;
}

function pillarBSectionHtml(pillarB, employeeId, quarter) {
  if (!pillarB.defined) {
    return `
      <div class="kpi-section-title">Pillar B — Role Metrics (40%)</div>
      <div class="card empty-state"><div style="font-weight:650;">Not yet defined for this role</div><div class="muted small">Contact People &amp; Culture to have this role's Pillar B framework set up.</div></div>`;
  }

  const bySection = {};
  pillarB.metrics.forEach((m) => { (bySection[m.pillar] = bySection[m.pillar] || []).push(m); });

  const sectionsHtml = Object.entries(bySection).map(([pillarName, metrics]) => `
    <div class="card section">
      <div class="card-title" style="text-transform:capitalize;">${escapeHtml(pillarName.replace('_', ' '))}</div>
      ${metrics.map((m) => `
        <div class="kpi-metric-row">
          <div class="kpi-metric-top">
            <div>
              <div class="kpi-metric-name">${escapeHtml(m.metricId)} — ${escapeHtml(m.name)}</div>
              <div class="kpi-metric-target">Target: <strong>${escapeHtml(m.target || '—')}</strong></div>
            </div>
            <div class="kpi-metric-right">
              <span class="badge badge-source-${m.sourceType}">${escapeHtml(SOURCE_LABELS[m.sourceType] || m.sourceType)}</span>
              <div style="margin-top:4px;">
                <span class="kpi-metric-pts" style="color:${scoreColor(m.score, 100)};">${m.weightedPoints === null ? '—' : (Math.round(m.weightedPoints * 10) / 10)}</span>
                <span class="muted small">/${m.weightPct} pts</span>
              </div>
            </div>
          </div>
          <div class="small muted mt-8">Actual: ${m.actualValue === null || m.actualValue === undefined ? '—' : escapeHtml(String(m.actualValue))}${m.score !== null ? ` → score ${m.score}${m.score > 100 ? ' (overperformed)' : ''}` : ''}</div>
          ${m.score !== null ? bar(m.score, 100) : ''}
          ${m.comment ? `<div class="kpi-metric-comment">${escapeHtml(m.comment)}</div>` : ''}
          ${m.formulaConfig && m.formulaConfig.kind === 'ratio_employee_target' ? `
            <div class="small muted mt-8">
              Target this quarter: <strong>${m.employeeTarget === null ? 'not set' : m.employeeTarget}</strong>
              ${canSetTarget() ? `
                <span class="kpi-entry-row" style="display:inline-flex; margin-top:4px;">
                  <input class="form-control small" id="target-input-${m.metricId}" placeholder="target" style="width:90px;" value="${m.employeeTarget === null ? '' : m.employeeTarget}">
                  <button class="btn small" onclick="kpiSetEmployeeTarget(${employeeId}, '${quarter}', '${m.metricId}')">Set Target</button>
                </span>` : ''}
            </div>` : ''}
          ${canEnterMetric(employeeId) ? `
            <div class="kpi-entry-row">
              <input class="form-control small" id="metric-input-${m.metricId}" placeholder="actual value" value="${m.actualValue === null || m.actualValue === undefined ? '' : escapeHtml(String(m.actualValue))}">
              <input class="form-control small" id="metric-comment-${m.metricId}" placeholder="comment (optional)" value="${escapeHtml(m.comment || '')}">
              <button class="btn small" onclick="kpiEnterMetricScore(${employeeId}, '${quarter}', '${m.metricId}')">Save</button>
            </div>` : ''}
        </div>`).join('')}
    </div>`).join('');

  return `<div class="kpi-section-title">Pillar B — Role Metrics (40%)</div>${sectionsHtml}`;
}

async function renderOverview(employeeId, quarter) {
  const container = $('#kpi-view-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  renderRequiredActions(quarter);
  try {
    const breakdown = await apiFetch(`/api/employees/kpi/${employeeId}/breakdown?quarter=${encodeURIComponent(quarter)}`);
    const { pillarA, pillarB, selfEvaluation, final } = breakdown;
    const deadline = currentQuarterInfo && currentQuarterInfo.quarter === quarter ? currentQuarterInfo.deadline : null;

    container.innerHTML = `
      <div class="card">
        <div class="kpi-score-header">
          <div>
            <div class="card-title" style="margin-bottom:6px;">Quarter Score — ${escapeHtml(quarter)}</div>
            <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
              <div class="kpi-score-big" style="color:${scoreColor(final.total, 100)};">${final.total.toFixed(1)}</div>
              <div class="kpi-score-unit">/ 100 pts (${final.achievementPct.toFixed(1)}% achievement)</div>
              ${statusBadge(final.statusBand)}
            </div>
            <div class="muted small mt-8">${escapeHtml(breakdown.kpiProfile || 'No KPI profile assigned')}</div>
            ${final.statusBand.note ? `<div class="small" style="color:var(--critical); margin-top:4px;">${escapeHtml(final.statusBand.note)}</div>` : ''}
            ${deadline ? `<div class="muted small mt-8">Quarter closes ${escapeHtml(deadline.closesAt.slice(0, 10))} · ${deadline.daysRemaining} day(s) remaining</div>` : ''}
            <button class="btn small mt-8" id="kpi-view-history-btn">View Performance Details</button>
          </div>
          <div class="kpi-pillar-summary">
            <div class="kpi-pillar-chip">
              <div class="kpi-pillar-chip-label">Pillar A (${final.pillarAWeightPct}%)</div>
              <div class="kpi-pillar-chip-val">${final.pillarAWeighted.toFixed(1)} / ${pillarA.maxTotal}</div>
            </div>
            <div class="kpi-pillar-chip">
              <div class="kpi-pillar-chip-label">Pillar B (${final.pillarBWeightPct}%)</div>
              <div class="kpi-pillar-chip-val">${pillarB.defined ? final.pillarBWeighted.toFixed(1) + ' / ' + pillarB.maxTotal : 'Not yet defined'}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-16">${pillarASectionHtml(pillarA, selfEvaluation, employeeId, quarter)}</div>
      <div class="mt-16">${pillarBSectionHtml(pillarB, employeeId, quarter)}</div>
    `;

    $('#kpi-view-history-btn').addEventListener('click', () => {
      activeView = 'history';
      renderSubNav();
      renderActiveView(employeeId, quarter);
    });
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}

// ---------------------------------------------------------------------
// Browse Frameworks (P&C only — preview a role's Pillar B setup before
// any scores exist)
// ---------------------------------------------------------------------

function renderFrameworksPicker(container, quarter) {
  container.innerHTML = `
    <div class="card section" style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end;">
      <div class="form-group" style="min-width:180px;">
        <label class="form-label">Role</label>
        <select class="form-control" id="kpi-fw-profile">
          ${KPI_PROFILES.map((p) => `<option value="${p}">${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="min-width:140px;">
        <label class="form-label">Quarter</label>
        <select class="form-control" id="kpi-fw-quarter">${quarterOptionsHtml(quarter)}</select>
      </div>
      <button class="btn primary" id="kpi-fw-view-btn">View Framework</button>
    </div>
    <div id="kpi-fw-result"></div>
  `;
  $('#kpi-fw-view-btn').addEventListener('click', async () => {
    const profile = $('#kpi-fw-profile').value;
    const q = $('#kpi-fw-quarter').value;
    const result = $('#kpi-fw-result');
    if (!q) { toast('No quarters available yet', 'danger'); return; }
    result.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
    try {
      const fw = await apiFetch(`/api/employees/kpi/frameworks/${profile}?quarter=${encodeURIComponent(q)}`);
      result.innerHTML = pillarBSectionHtml(
        fw.pillarB.defined
          ? { defined: true, metrics: fw.pillarB.metrics.map((m) => ({ ...m, actualValue: null, score: null, weightedPoints: null, comment: null })) }
          : { defined: false },
        null, q
      );
    } catch (err) {
      result.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
    }
  });
}

// ---------------------------------------------------------------------
// Shell / sub-nav
// ---------------------------------------------------------------------

function renderSubNav() {
  const nav = $('#kpi-sub-nav');
  if (!nav) return;
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'history', label: 'History' }, { id: 'peerReview', label: 'Team Reviews' }];
  // hasReports (computed in loadViewCandidates via the same reporting-line
  // FK as the backend's own team-head check) is what lets a real team head
  // see this tab too, not just the manager/admin company-wide roles.
  if (kpiPerms.isManager || kpiPerms.isAdmin || kpiPerms.hasReports) tabs.push({ id: 'team', label: 'Team Performance' });
  if (kpiPerms.isPeopleCulture) tabs.push({ id: 'frameworks', label: 'Browse Frameworks' });
  if (kpiPerms.isAdmin) tabs.push({ id: 'mappingAdmin', label: 'ClickUp Mappings' });

  nav.innerHTML = tabs.map((t) => `<button class="sub-nav-tab ${activeView === t.id ? 'active' : ''}" data-view="${t.id}">${escapeHtml(t.label)}</button>`).join('');
  nav.querySelectorAll('.sub-nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view;
      renderSubNav();
      const id = Number($('#kpi-employee-select') ? $('#kpi-employee-select').value : (viewerEmployee ? viewerEmployee.id : null));
      const q = $('#kpi-quarter-input') ? ($('#kpi-quarter-input').value.trim() || currentQuarterInfo.quarter) : currentQuarterInfo.quarter;
      renderActiveView(id, q);
    });
  });
}

function renderActiveView(employeeId, quarter) {
  const container = $('#kpi-view-content');
  if (activeView === 'overview') return renderOverview(employeeId, quarter);
  if (activeView === 'history') return renderKpiHistory(container, employeeId);
  if (activeView === 'team') return renderKpiTeam(container, quarter);
  if (activeView === 'peerReview') return renderKpiPeerReview(container, quarter);
  if (activeView === 'frameworks') return renderFrameworksPicker(container, quarter);
  if (activeView === 'mappingAdmin') return renderKpiMappingAdmin(container);
  return null;
}

export async function renderKpi() {
  const container = $('#kpi-content');
  const emp = state.myEmployee;
  if (!emp) {
    container.innerHTML = `<div class="card empty-state">You need an employee profile to view KPIs.</div>`;
    return;
  }

  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  await Promise.all([loadViewCandidates(), loadCurrentQuarter(), loadAvailableQuarters()]);
  activeView = 'overview';

  const current = currentQuarterInfo && currentQuarterInfo.quarter;
  const quarter = (current && availableQuarters.includes(current)) ? current : (availableQuarters[0] || current || `${new Date().getFullYear()}-Q1`);
  const showPicker = viewCandidates.length > 1;
  container.innerHTML = `
    <div class="card section" style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end; justify-content:space-between;">
      <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end;">
        ${showPicker ? `
          <div class="form-group" style="min-width:220px;">
            <label class="form-label">Viewing</label>
            <select class="form-control" id="kpi-employee-select">
              ${viewCandidates.map((c) => `<option value="${c.id}" ${c.id === emp.id ? 'selected' : ''}>${escapeHtml(c.firstName + ' ' + c.lastName)}${c.self ? ' (me)' : ''}</option>`).join('')}
            </select>
          </div>` : ''}
        <div class="form-group" style="min-width:140px;">
          <label class="form-label">Quarter</label>
          <select class="form-control" id="kpi-quarter-input">${quarterOptionsHtml(quarter)}</select>
        </div>
        <button class="btn primary" id="kpi-refresh-btn">View</button>
      </div>
      <div id="kpi-notif-holder"></div>
    </div>
    <div id="kpi-required-actions"></div>
    <div class="sub-nav-tabs" id="kpi-sub-nav"></div>
    <div id="kpi-view-content"></div>
  `;

  renderSubNav();
  renderNotificationBell();

  const refresh = () => {
    const id = showPicker ? Number($('#kpi-employee-select').value) : emp.id;
    const q = $('#kpi-quarter-input').value || quarter;
    renderActiveView(id, q);
  };
  $('#kpi-refresh-btn').addEventListener('click', refresh);
  if (availableQuarters.length === 0) {
    $('#kpi-view-content').innerHTML = `<div class="card empty-state">No KPI quarters set up yet. Ask People &amp; Culture to set up this quarter's framework.</div>`;
  } else {
    refresh();
  }
}
