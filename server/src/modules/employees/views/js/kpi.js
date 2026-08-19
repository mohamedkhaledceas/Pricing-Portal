import { $, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';

const SOURCE_LABELS = { auto: 'Auto — ClickUp', semi: 'AM fills field', manual: 'Manual — P&C', goals: 'ClickUp Goals', odoo: 'Odoo' };

function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function scoreColor(score, max) {
  if (score === null || score === undefined) return 'var(--muted)';
  const r = max ? score / max : 0;
  return r >= 0.8 ? 'var(--good-text)' : r >= 0.6 ? '#1a5fd6' : r >= 0.4 ? '#8a5b00' : 'var(--critical)';
}

function bar(score, max) {
  const pct = Math.max(0, Math.min(100, max ? (score / max) * 100 : 0));
  return `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${pct}%; background:${scoreColor(score, max)};"></div></div>`;
}

let viewCandidates = [];
let viewerEmployee = null;

async function loadViewCandidates() {
  viewerEmployee = state.myEmployee;
  const byId = {};
  if (viewerEmployee) byId[viewerEmployee.id] = { id: viewerEmployee.id, firstName: viewerEmployee.firstName, lastName: viewerEmployee.lastName, self: true };

  try {
    if (viewerEmployee && viewerEmployee.isPeopleCulture) {
      const res = await apiFetch('/api/employees');
      (res.employees || []).forEach((e) => { byId[e.id] = { id: e.id, firstName: e.firstName, lastName: e.lastName }; });
    } else {
      const res = await apiFetch('/api/employees/team');
      (res.employees || []).forEach((e) => { byId[e.id] = { id: e.id, firstName: e.firstName, lastName: e.lastName }; });
    }
  } catch (err) { /* not permitted to list others — self-only picker */ }

  viewCandidates = Object.values(byId);
}

async function enterPillarA(employeeId, quarter) {
  const dims = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];
  const payload = { quarter };
  for (const d of dims) {
    const v = $('#pa-' + d).value;
    if (v !== '') payload[d] = Number(v);
  }
  payload.responseCount = Number($('#pa-response-count').value) || 0;
  payload.feedback = ($('#pa-feedback').value || '').split('\n').map((s) => s.trim()).filter(Boolean);
  try {
    await apiFetch(`/api/employees/kpi/${employeeId}/pillar-a`, { method: 'POST', body: JSON.stringify(payload) });
    toast('Pillar A review saved', 'info');
    renderBreakdown(employeeId, quarter);
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.kpiEnterPillarA = enterPillarA;

async function enterMetricScore(employeeId, quarter, metricId) {
  const input = $('#metric-input-' + metricId);
  const raw = input.value;
  if (raw === '') return;
  try {
    await apiFetch(`/api/employees/kpi/${employeeId}/manual-entry`, {
      method: 'POST',
      body: JSON.stringify({ quarter, metricId, actualValue: isNaN(Number(raw)) ? raw : Number(raw) }),
    });
    toast(`${metricId} saved`, 'info');
    renderBreakdown(employeeId, quarter);
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.kpiEnterMetricScore = enterMetricScore;

function canEnterPillarA(employeeId) {
  return viewerEmployee && viewerEmployee.isPeopleCulture && employeeId !== viewerEmployee.id;
}

function canEnterMetric(target) {
  if (!viewerEmployee) return false;
  if (viewerEmployee.isPeopleCulture) return true;
  const cand = viewCandidates.find((c) => c.id === target);
  return !!cand && !cand.self; // populated from /team when actor is a manager, not P&C
}

function pillarASectionHtml(pillarA, employeeId, quarter) {
  const dims = pillarA.dimensions.map((d) => `
    <div class="kpi-metric-row">
      <div class="kpi-metric-top">
        <div class="kpi-metric-name">${escapeHtml(d.label)}</div>
        <div class="kpi-metric-right"><span class="kpi-metric-pts" style="color:${scoreColor(d.score, 10)};">${d.score === null ? '—' : d.score}</span><span class="muted small">/10</span></div>
      </div>
      ${bar(d.score || 0, 10)}
    </div>`).join('');

  const entry = canEnterPillarA(employeeId) ? `
    <div class="card section" style="margin-top:12px;">
      <div class="card-title">Enter Pillar A Review Results <span class="small muted">(aggregated anonymous form results)</span></div>
      <div class="form-grid">
        ${['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'].map((d) => `
          <div class="form-group">
            <label class="form-label">${d[0].toUpperCase() + d.slice(1)}</label>
            <input class="form-control" type="number" min="0" max="10" step="0.1" id="pa-${d}">
          </div>`).join('')}
        <div class="form-group">
          <label class="form-label">Response Count</label>
          <input class="form-control" type="number" min="0" id="pa-response-count">
        </div>
        <div class="form-group full">
          <label class="form-label">Feedback (one per line)</label>
          <textarea class="form-control" id="pa-feedback" rows="2"></textarea>
        </div>
        <div class="form-group full"><button class="btn primary small" onclick="kpiEnterPillarA(${employeeId}, '${quarter}')">Save Pillar A</button></div>
      </div>
    </div>` : '';

  return `
    <div class="kpi-section-title">Pillar A — Peer Review (60%)</div>
    <div class="card">${dims}</div>
    ${entry}`;
}

function pillarBSectionHtml(pillarB, employeeId, quarter) {
  if (!pillarB.defined) {
    return `
      <div class="kpi-section-title">Pillar B — Role Metrics (40%)</div>
      <div class="card empty-state"><div class="empty-state-icon">📊</div><div style="font-weight:650;">Not yet defined for this role</div><div class="muted small">Contact People &amp; Culture to have this role's Pillar B framework set up.</div></div>`;
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
          ${canEnterMetric(employeeId) ? `
            <div class="kpi-entry-row">
              <input class="form-control small" id="metric-input-${m.metricId}" placeholder="actual value">
              <button class="btn small" onclick="kpiEnterMetricScore(${employeeId}, '${quarter}', '${m.metricId}')">Save</button>
            </div>` : ''}
        </div>`).join('')}
    </div>`).join('');

  return `<div class="kpi-section-title">Pillar B — Role Metrics (40%)</div>${sectionsHtml}`;
}

async function renderBreakdown(employeeId, quarter) {
  const container = $('#kpi-breakdown-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const breakdown = await apiFetch(`/api/employees/kpi/${employeeId}/breakdown?quarter=${encodeURIComponent(quarter)}`);
    const { pillarA, pillarB, final } = breakdown;

    container.innerHTML = `
      <div class="card">
        <div class="kpi-score-header">
          <div>
            <div class="card-title" style="margin-bottom:6px;">Quarter Score — ${escapeHtml(quarter)}</div>
            <div style="display:flex; align-items:baseline; gap:6px;">
              <div class="kpi-score-big" style="color:${scoreColor(final.total, 100)};">${final.total.toFixed(1)}</div>
              <div class="kpi-score-unit">/ 100 pts</div>
            </div>
            <div class="muted small mt-8">${escapeHtml(breakdown.kpiProfile || 'No KPI profile assigned')}</div>
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

      <div class="mt-16">${pillarASectionHtml(pillarA, employeeId, quarter)}</div>
      <div class="mt-16">${pillarBSectionHtml(pillarB, employeeId, quarter)}</div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><span>⚠️</span><div>${escapeHtml(err.message)}</div></div>`;
  }
}

export async function renderKpi() {
  const container = $('#kpi-content');
  const emp = state.myEmployee;
  if (!emp) {
    container.innerHTML = `<div class="card empty-state"><div class="empty-state-icon">📈</div>You need an employee profile to view KPIs.</div>`;
    return;
  }

  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  await loadViewCandidates();

  const quarter = currentQuarter();
  const showPicker = viewCandidates.length > 1;
  container.innerHTML = `
    <div class="card section" style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-end;">
      ${showPicker ? `
        <div class="form-group" style="min-width:220px;">
          <label class="form-label">Viewing</label>
          <select class="form-control" id="kpi-employee-select">
            ${viewCandidates.map((c) => `<option value="${c.id}" ${c.id === emp.id ? 'selected' : ''}>${escapeHtml(c.firstName + ' ' + c.lastName)}${c.self ? ' (me)' : ''}</option>`).join('')}
          </select>
        </div>` : ''}
      <div class="form-group" style="min-width:140px;">
        <label class="form-label">Quarter</label>
        <input class="form-control" id="kpi-quarter-input" value="${escapeHtml(quarter)}" placeholder="YYYY-Qn">
      </div>
      <button class="btn primary" id="kpi-refresh-btn">View</button>
    </div>
    <div id="kpi-breakdown-content"></div>
  `;

  const refresh = () => {
    const id = showPicker ? Number($('#kpi-employee-select').value) : emp.id;
    const q = $('#kpi-quarter-input').value.trim() || quarter;
    renderBreakdown(id, q);
  };
  $('#kpi-refresh-btn').addEventListener('click', refresh);
  refresh();
}
