import { $, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { renderKpiHistory } from './kpiHistory.js';
import { renderKpiTeam } from './kpiTeam.js';
import { renderKpiPeerReview } from './kpiPeerReview.js';
import { renderKpiMappingAdmin } from './kpiMappingAdmin.js';
import { bar, statusBadge, ratingOptionsHtml } from './kpiShared.js';
import { panel, split, colTitle, plural, loadErrorPanel } from './panels.js';

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
  kpiPerms.isManager = !!(state.currentUser && state.currentUser.role === 'ceo');
  kpiPerms.hasReports = false;

  try {
    if (kpiPerms.isPeopleCulture) {
      const res = await apiFetch('/api/employees');
      (res.employees || []).forEach((e) => { byId[e.id] = byId[e.id] || { id: e.id, firstName: e.firstName, lastName: e.lastName }; });
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

async function loadRequiredActions(quarter) {
  try {
    const { actions } = await apiFetch(`/api/employees/kpi/required-actions?quarter=${encodeURIComponent(quarter)}`);
    return actions || [];
  } catch (err) {
    return []; // non-essential — the breakdown below still renders without it
  }
}

// Per-person actions are grouped into one row per kind (P&C can have dozens)
// and expand to the names; each name loads that person's breakdown.
function requiredActionsHtml(actions, quarter) {
  if (!actions.length) return '';
  const rows = [];
  const self = actions.find((a) => a.type === 'self_evaluation');
  if (self) {
    rows.push(`<div class="attn-row is-warn">
      <div class="attn-count">1</div>
      <div class="attn-text">Your self-evaluation for ${escapeHtml(quarter)} isn’t submitted<span class="attn-sub">Comparison only — it doesn’t count toward your score</span></div>
      <button class="small" data-kpi-action="view-employee" data-employee-id="${self.employeeId}" data-focus="self-eval">Fill it in</button>
    </div>`);
  }
  const group = (type, text, subFor) => {
    const items = actions.filter((a) => a.type === type);
    if (!items.length) return;
    rows.push(`<details class="attn-group">
      <summary class="attn-row">
        <div class="attn-count">${items.length}</div>
        <div class="attn-text">${escapeHtml(text(items.length))}<span class="attn-sub">${escapeHtml(subFor(items))}</span></div>
        <span class="attn-toggle">Show people</span>
      </summary>
      <ul class="list attn-list">${items.map((a) => `<li class="list-row">
        <div class="list-main"><div class="list-title">${escapeHtml(a.employeeName || 'Employee #' + a.employeeId)}</div><div class="list-meta">${escapeHtml(a.message)}</div></div>
        <button class="small" data-kpi-action="view-employee" data-employee-id="${a.employeeId}">Open</button>
      </li>`).join('')}</ul>
    </details>`);
  };
  group('missing_kpi_scores',
    (n) => `${n} ${plural(n, 'person has', 'people have')} Pillar B metrics not entered`,
    (items) => `${items.reduce((sum, a) => sum + (a.missingCount || 0), 0)} metrics missing in total`);
  group('missing_pillar_a',
    (n) => `${n} ${plural(n, 'person has', 'people have')} no Pillar A review yet`,
    () => 'Entered by People & Culture from the team reviews');
  return `<section class="attn" aria-label="KPI actions">${rows.join('')}</section>`;
}

// ---------------------------------------------------------------------
// Overview (single-employee breakdown)
// ---------------------------------------------------------------------

// Delegated on #kpi-view-content, guarded against double-binding the same
// way kpiPeerReview.js's bindPeerReviewUi is — this container persists
// across Overview/History/Team/PeerReview sub-view switches within one KPI
// tab visit, so renderOverview() (this file's local one, for a single
// employee's breakdown) can run several times on the same element.
// Replaces onclick="..." attributes, which the CSP's script-src-attr
// 'none' silently blocks (confirmed live, 2026-09-28, on the sibling
// Overview-page and Team-Reviews bugs — this is the same root cause).
function bindKpiOverviewUi(container) {
  if (container._kpiOverviewBound) return;
  container._kpiOverviewBound = true;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kpi-action]');
    if (!btn) return;
    const { kpiAction, employeeId, quarter, metricId } = btn.dataset;
    if (kpiAction === 'view-employee') viewEmployee(Number(employeeId), btn.dataset.focus);
    if (kpiAction === 'retry') renderOverview(Number(employeeId), quarter);
    if (kpiAction === 'enter-self-eval') enterSelfEvaluation(Number(employeeId), quarter);
    if (kpiAction === 'set-target') setEmployeeTarget(Number(employeeId), quarter, metricId);
    if (kpiAction === 'enter-metric') enterMetricScore(Number(employeeId), quarter, metricId);
  });
}

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

function pillarASectionHtml(pillarA, selfEvaluation, employeeId, quarter) {
  const dims = pillarA.dimensions.map((d) => {
    const selfDim = selfEvaluation ? selfEvaluation.dimensions.find((s) => s.key === d.key) : null;
    return `
    <div class="kpi-metric-row">
      <div class="kpi-metric-top">
        <div class="kpi-metric-name">${escapeHtml(d.label)}</div>
        <div class="kpi-metric-right">
          <span class="kpi-metric-pts">${d.score === null ? '—' : d.score}</span><span class="muted small">/10</span>
          ${selfDim ? `<span class="muted small" style="margin-left:8px;">self ${selfDim.score === null ? '—' : selfDim.score}</span>` : ''}
        </div>
      </div>
      ${bar(d.score || 0, 10)}
    </div>`;
  }).join('');

  let selfCol = '';
  if (isSelf(employeeId)) {
    selfCol = colTitle('Your self-evaluation', 'not counted in your score') + `
      <div class="form-grid" id="kpi-self-eval">
        ${['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'].map((d) => {
          const selfDim = selfEvaluation ? selfEvaluation.dimensions.find((s) => s.key === d) : null;
          const selected = selfDim && selfDim.score !== null ? Math.round(selfDim.score) : null;
          return `
          <div class="form-group">
            <label class="form-label" for="se-${d}">${d[0].toUpperCase() + d.slice(1)}</label>
            <select class="form-control" id="se-${d}">${ratingOptionsHtml(selected)}</select>
          </div>`;
        }).join('')}
        <div class="form-group full">
          <label class="form-label" for="se-comment">Comment</label>
          <textarea class="form-control" id="se-comment" rows="2">${escapeHtml(selfEvaluation ? selfEvaluation.comment || '' : '')}</textarea>
        </div>
        <div class="form-group full"><button class="btn small primary" data-kpi-action="enter-self-eval" data-employee-id="${employeeId}" data-quarter="${escapeHtml(quarter)}">${selfEvaluation ? 'Update' : 'Submit'} self-evaluation</button></div>
      </div>`;
  } else if (selfEvaluation) {
    selfCol = colTitle('Their self-evaluation', 'comparison only')
      + (selfEvaluation.comment ? `<p class="panel-text">${escapeHtml(selfEvaluation.comment)}</p>` : '<div class="list-empty">Scores shown beside each dimension; no comment left.</div>');
  }

  const dimsCol = colTitle('Peer review scores') + `<div class="kpi-dim-grid">${dims}</div>`;
  return panel({
    title: 'Pillar A — peer review',
    meta: '60% of the score',
    body: selfCol ? split([{ html: dimsCol }, { html: selfCol }], '1fr 1fr') : `<div class="panel-body">${dimsCol}</div>`,
  });
}

function pillarBSectionHtml(pillarB, employeeId, quarter) {
  if (!pillarB.defined) {
    return panel({
      title: 'Pillar B — role metrics',
      meta: '40% of the score',
      body: `<div class="panel-body"><div style="font-weight:650;margin-bottom:2px;">Not yet defined for this role</div><div class="muted small">Contact People &amp; Culture to have this role’s Pillar B framework set up.</div></div>`,
    });
  }

  const bySection = {};
  pillarB.metrics.forEach((m) => { (bySection[m.pillar] = bySection[m.pillar] || []).push(m); });

  const sectionLabel = (name) => { const t = name.replace(/_/g, ' '); return t[0].toUpperCase() + t.slice(1); };
  const sectionsHtml = Object.entries(bySection).map(([pillarName, metrics]) => `
    <div class="kpi-pillar-section">
      ${colTitle(sectionLabel(pillarName), `${metrics.reduce((sum, m) => sum + (Number(m.weightPct) || 0), 0)} pts`)}
      ${metrics.map((m) => `
        <div class="kpi-metric-row">
          <div class="kpi-metric-top">
            <div>
              <div class="kpi-metric-name">${escapeHtml(m.metricId)} — ${escapeHtml(m.name)}</div>
              <div class="kpi-metric-target">Target: <strong>${escapeHtml(m.target || '—')}</strong></div>
            </div>
            <div class="kpi-metric-right kpi-metric-right-inline">
              <span class="badge badge-source-${m.sourceType}">${escapeHtml(SOURCE_LABELS[m.sourceType] || m.sourceType)}</span>
              <span><span class="kpi-metric-pts">${m.weightedPoints === null ? '—' : (Math.round(m.weightedPoints * 10) / 10)}</span><span class="muted small">/${m.weightPct} pts</span></span>
            </div>
          </div>
          ${(m.actualValue === null || m.actualValue === undefined) && m.score === null ? '' : `<div class="small muted mt-8">Actual: ${m.actualValue === null || m.actualValue === undefined ? '—' : escapeHtml(String(m.actualValue))}${m.score !== null ? ` → score ${m.score}${m.score > 100 ? ' (overperformed)' : ''}` : ''}</div>`}
          ${m.score !== null ? bar(m.score, 100) : ''}
          ${m.comment ? `<div class="kpi-metric-comment">${escapeHtml(m.comment)}</div>` : ''}
          ${m.formulaConfig && m.formulaConfig.kind === 'ratio_employee_target' ? `
            <div class="small muted mt-8">
              Target this quarter: <strong>${m.employeeTarget === null ? 'not set' : m.employeeTarget}</strong>
              ${canSetTarget() ? `
                <span class="kpi-entry-row" style="display:inline-flex; margin-top:4px;">
                  <input class="form-control small" id="target-input-${m.metricId}" placeholder="target" style="width:90px;" value="${m.employeeTarget === null ? '' : m.employeeTarget}">
                  <button class="btn small" data-kpi-action="set-target" data-employee-id="${employeeId}" data-quarter="${escapeHtml(quarter)}" data-metric-id="${escapeHtml(m.metricId)}">Set target</button>
                </span>` : ''}
            </div>` : ''}
          ${canEnterMetric(employeeId) ? `
            <div class="kpi-entry-row">
              <input class="form-control small" id="metric-input-${m.metricId}" placeholder="actual value" value="${m.actualValue === null || m.actualValue === undefined ? '' : escapeHtml(String(m.actualValue))}">
              <input class="form-control small" id="metric-comment-${m.metricId}" placeholder="comment (optional)" value="${escapeHtml(m.comment || '')}">
              <button class="btn small" data-kpi-action="enter-metric" data-employee-id="${employeeId}" data-quarter="${escapeHtml(quarter)}" data-metric-id="${escapeHtml(m.metricId)}">Save</button>
            </div>` : ''}
        </div>`).join('')}
    </div>`).join('');

  return panel({ title: 'Pillar B — role metrics', meta: '40% of the score', body: `<div class="panel-body">${sectionsHtml}</div>` });
}

function pillarMeter(label, value, max) {
  const pct = value === null || !max ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="meter">
    <div class="meter-top">
      <span class="meter-label">${escapeHtml(label)}</span>
      <span class="meter-value">${value === null ? '<strong>Not defined</strong>' : `<strong>${value.toFixed(1)}</strong> of ${max}`}</span>
    </div>
    <div class="meter-track"><div class="meter-fill" style="width:${pct}%;"></div></div>
  </div>`;
}

function scorePanelHtml(breakdown, quarter, employeeId) {
  const { pillarA, pillarB, final } = breakdown;
  const deadline = currentQuarterInfo && currentQuarterInfo.quarter === quarter ? currentQuarterInfo.deadline : null;
  const left = `
    <div class="kpi-score-line">
      <span class="kpi-score-big">${final.total.toFixed(1)}</span>
      <span class="kpi-score-unit">of 100 points</span>
      ${statusBadge(final.statusBand)}
    </div>
    <div class="kpi-score-facts">
      <span>${final.achievementPct.toFixed(1)}% achievement</span>
      <span>${breakdown.kpiProfile ? 'KPI profile: ' + escapeHtml(breakdown.kpiProfile) : 'No KPI profile assigned'}</span>
    </div>
    ${final.statusBand.note ? `<div class="kpi-band-note">${escapeHtml(final.statusBand.note)}</div>` : ''}`;
  const right = colTitle('How it adds up') + `<div class="meter-list">
    ${pillarMeter(`Pillar A, peer review (${final.pillarAWeightPct}%)`, final.pillarAWeighted, pillarA.maxTotal)}
    ${pillarMeter(`Pillar B, role metrics (${final.pillarBWeightPct}%)`, pillarB.defined ? final.pillarBWeighted : null, pillarB.maxTotal)}
  </div>`;
  return panel({
    title: `Quarter score, ${quarter}`,
    meta: deadline ? `Closes ${escapeHtml(deadline.closesAt.slice(0, 10))}, ${deadline.daysRemaining} ${plural(deadline.daysRemaining, 'day', 'days')} left` : '',
    actions: '<button class="small" id="kpi-view-history-btn">Performance history</button>',
    body: split([{ html: left }, { html: right }], '1.1fr 1fr'),
  });
}

async function renderOverview(employeeId, quarter) {
  const container = $('#kpi-view-content');
  bindKpiOverviewUi(container);
  container.innerHTML = panel({ title: `Quarter score, ${quarter}`, body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });
  try {
    const [breakdown, actions] = await Promise.all([
      apiFetch(`/api/employees/kpi/${employeeId}/breakdown?quarter=${encodeURIComponent(quarter)}`),
      loadRequiredActions(quarter),
    ]);
    const { pillarA, pillarB, selfEvaluation } = breakdown;

    container.innerHTML = `<div class="stack">
      ${requiredActionsHtml(actions, quarter)}
      ${scorePanelHtml(breakdown, quarter, employeeId)}
      ${pillarASectionHtml(pillarA, selfEvaluation, employeeId, quarter)}
      ${pillarBSectionHtml(pillarB, employeeId, quarter)}
    </div>`;

    $('#kpi-view-history-btn').addEventListener('click', () => {
      activeView = 'history';
      renderSubNav();
      renderActiveView(employeeId, quarter);
    });
  } catch (err) {
    console.error('KPI breakdown failed to load', err);
    container.innerHTML = loadErrorPanel('This KPI breakdown couldn’t load', err, `data-kpi-action="retry" data-employee-id="${employeeId}" data-quarter="${escapeHtml(quarter)}"`);
  }
}

function currentQuarterValue() {
  const input = $('#kpi-quarter-input');
  return (input && input.value) || (currentQuarterInfo && currentQuarterInfo.quarter);
}

// Switches the "Viewing" picker to someone (from a required-action row) and
// shows their breakdown; focus="self-eval" scrolls to the self-evaluation form.
async function viewEmployee(employeeId, focus) {
  const select = $('#kpi-employee-select');
  if (select && [...select.options].some((o) => Number(o.value) === employeeId)) select.value = String(employeeId);
  activeView = 'overview';
  renderSubNav();
  await renderOverview(employeeId, currentQuarterValue());
  const target = focus === 'self-eval' ? $('#kpi-self-eval') : $('#kpi-view-content');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------
// Browse Frameworks (P&C only — preview a role's Pillar B setup before
// any scores exist)
// ---------------------------------------------------------------------

function renderFrameworksPicker(container, quarter) {
  container.innerHTML = `
    <div class="kpi-toolbar">
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
      <button class="btn primary" id="kpi-fw-view-btn">View framework</button>
    </div>
    <div id="kpi-fw-result"></div>
  `;
  $('#kpi-fw-view-btn').addEventListener('click', async () => {
    const profile = $('#kpi-fw-profile').value;
    const q = $('#kpi-fw-quarter').value;
    const result = $('#kpi-fw-result');
    if (!q) { toast('No quarters available yet', 'danger'); return; }
    result.innerHTML = '<div class="list-empty">Loading…</div>';
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

// initialView lets a caller land directly on a specific sub-view (e.g. the
// Overview page's "Go to Team Reviews" button wants 'peerReview', not the
// default) — previously hardcoded to 'overview' unconditionally, which
// silently defeated that button even once its onclick/CSP issue is fixed:
// clicking it correctly switched to the KPI tab, but the tab itself always
// reset back to its own default sub-view regardless of intent.
export async function renderKpi(initialView) {
  const container = $('#kpi-content');
  const emp = state.myEmployee;
  if (!emp) {
    container.innerHTML = panel({ title: 'KPIs', body: '<div class="panel-body"><div class="list-empty">You need an employee profile to view KPIs. Contact People &amp; Culture to get set up.</div></div>' });
    return;
  }

  container.innerHTML = '<div class="list-empty" style="border:none;">Loading…</div>';
  await Promise.all([loadViewCandidates(), loadCurrentQuarter(), loadAvailableQuarters()]);
  activeView = initialView || 'overview';

  const current = currentQuarterInfo && currentQuarterInfo.quarter;
  const quarter = (current && availableQuarters.includes(current)) ? current : (availableQuarters[0] || current || `${new Date().getFullYear()}-Q1`);
  const showPicker = viewCandidates.length > 1;
  container.innerHTML = `
    <div class="kpi-toolbar">
      ${showPicker ? `
        <div class="form-group" style="min-width:220px;">
          <label class="form-label" for="kpi-employee-select">Viewing</label>
          <select class="form-control" id="kpi-employee-select">
            ${viewCandidates.map((c) => `<option value="${c.id}" ${c.id === emp.id ? 'selected' : ''}>${escapeHtml(c.firstName + ' ' + c.lastName)}${c.self ? ' (me)' : ''}</option>`).join('')}
          </select>
        </div>` : ''}
      <div class="form-group" style="min-width:140px;">
        <label class="form-label" for="kpi-quarter-input">Quarter</label>
        <select class="form-control" id="kpi-quarter-input">${quarterOptionsHtml(quarter)}</select>
      </div>
      <div id="kpi-notif-holder" class="kpi-toolbar-end"></div>
    </div>
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
  if (showPicker) $('#kpi-employee-select').addEventListener('change', refresh);
  $('#kpi-quarter-input').addEventListener('change', refresh);
  if (availableQuarters.length === 0) {
    $('#kpi-view-content').innerHTML = panel({ title: 'No KPI quarters yet', body: '<div class="panel-body"><div class="list-empty">Ask People &amp; Culture to set up this quarter’s framework.</div></div>' });
  } else {
    refresh();
  }
}
