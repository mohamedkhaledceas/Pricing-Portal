import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';
import { panel, split, colTitle, loadErrorPanel } from './panels.js';

const KPI_PROFILES = ['content', 'artdirector', 'aidesigner', 'production', 'am', 'pandc', 'heads', 'design'];
const METHODS = [
  { value: 'status_entry_count', label: 'Count entries into a status', extra: ['toStatus'] },
  { value: 'time_in_status_avg', label: 'Average time in a status', extra: ['statusName'] },
  { value: 'tagged_task_count', label: 'Count closed tasks with a tag', extra: ['tag', 'closedStatuses'] },
  { value: 'due_date_on_time_rate', label: 'Due-date on-time rate', extra: [] },
];

async function loadListsDatalist() {
  try {
    const { lists } = await apiFetch('/api/employees/kpi/clickup-lists');
    return lists.map((l) => `<option value="${escapeHtml(l.clickup_list_id)}">${escapeHtml(l.name)} (${escapeHtml(l.space_name || '')})</option>`).join('');
  } catch (err) {
    return '';
  }
}

function methodExtraFieldsHtml(method) {
  const def = METHODS.find((m) => m.value === method);
  if (!def) return '';
  return def.extra.map((field) => {
    if (field === 'closedStatuses') {
      return `<div class="form-group"><label class="form-label">Closed statuses (comma-separated)</label><input class="form-control" id="map-field-closedStatuses"></div>`;
    }
    const labels = { toStatus: 'Status name to count entries into', statusName: 'Status name to measure', tag: 'Tag' };
    return `<div class="form-group"><label class="form-label">${labels[field] || field}</label><input class="form-control" id="map-field-${field}"></div>`;
  }).join('');
}

async function saveMapping(listsDatalistHtml) {
  const kpiProfile = $('#map-profile').value;
  const metricId = $('#map-metric').value.trim();
  const method = $('#map-method').value;
  const listIds = $('#map-list-ids').value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!metricId || listIds.length === 0) { toast('Metric ID and at least one list ID are required', 'danger'); return; }

  const def = METHODS.find((m) => m.value === method);
  const config = { listIds };
  for (const field of def.extra) {
    const el = $('#map-field-' + field);
    if (!el) continue;
    config[field] = field === 'closedStatuses' ? el.value.split(',').map((s) => s.trim()).filter(Boolean) : el.value.trim();
  }

  try {
    await apiFetch('/api/employees/kpi/auto-mappings', {
      method: 'POST',
      body: JSON.stringify({ kpiProfile, metricId, method, config }),
    });
    toast('Mapping saved', 'info');
    renderKpiMappingAdmin($('#kpi-view-content'));
  } catch (err) {
    toast(err.message, 'danger');
  }
}

// Remove is a real delete — confirmed inline (no native confirm(); see the
// project rule on dialogs) by re-rendering just that row's action cell.
function askRemove(btn) {
  btn.closest('td').innerHTML = `<span class="small">Remove?</span>
    <button class="btn small danger" data-kpi-map-action="remove" data-kpi-profile="${escapeHtml(btn.dataset.kpiProfile)}" data-metric-id="${escapeHtml(btn.dataset.metricId)}">Yes, remove</button>
    <button class="btn small" data-kpi-map-action="cancel-remove" data-kpi-profile="${escapeHtml(btn.dataset.kpiProfile)}" data-metric-id="${escapeHtml(btn.dataset.metricId)}">No</button>`;
}

function removeButtonHtml(kpiProfile, metricId) {
  return `<button class="btn small" data-kpi-map-action="ask-remove" data-kpi-profile="${escapeHtml(kpiProfile)}" data-metric-id="${escapeHtml(metricId)}">Remove</button>`;
}

async function removeMapping(kpiProfile, metricId) {
  try {
    await apiFetch(`/api/employees/kpi/auto-mappings/${kpiProfile}/${metricId}`, { method: 'DELETE' });
    toast('Mapping removed', 'info');
    renderKpiMappingAdmin($('#kpi-view-content'));
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function runCompute() {
  const quarter = $('#map-run-quarter').value.trim();
  if (!quarter) { toast('Enter a quarter', 'danger'); return; }
  try {
    const result = await apiFetch('/api/employees/kpi/compute-auto-scores', { method: 'POST', body: JSON.stringify({ quarter }) });
    toast(`Computed ${result.computed}, skipped ${result.skipped}`, 'info');
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function renderMappingExtraFields(method) {
  $('#map-extra-fields').innerHTML = methodExtraFieldsHtml(method);
}

// Delegated on container (#kpi-view-content) — guarded against double-
// binding since renderKpiMappingAdmin re-runs on this same persisting
// element after every save/remove, and it can also be revisited via
// sub-view switching within one KPI-tab visit (same shared container as
// Overview/Team Reviews — see kpi.js/kpiPeerReview.js's own comments on
// this). Replaces onclick=".../onchange="..." attributes, which the CSP's
// script-src-attr 'none' silently blocks (confirmed live, 2026-09-28, on
// the sibling Overview-page/Team-Reviews bugs — same root cause).
function bindKpiMappingAdminUi(container) {
  if (container._kpiMappingAdminBound) return;
  container._kpiMappingAdminBound = true;
  container.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-method-select]');
    if (!sel) return;
    renderMappingExtraFields(sel.value);
  });
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kpi-map-action]');
    if (!btn) return;
    const action = btn.dataset.kpiMapAction;
    if (action === 'save') saveMapping();
    if (action === 'run-compute') runCompute();
    if (action === 'ask-remove') askRemove(btn);
    if (action === 'cancel-remove') btn.closest('td').innerHTML = removeButtonHtml(btn.dataset.kpiProfile, btn.dataset.metricId);
    if (action === 'remove') removeMapping(btn.dataset.kpiProfile, btn.dataset.metricId);
  });
}

export async function renderKpiMappingAdmin(container) {
  bindKpiMappingAdminUi(container);
  container.innerHTML = panel({ title: 'ClickUp mappings', body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });
  try {
    const [{ mappings }, listsDatalistHtml] = await Promise.all([
      apiFetch('/api/employees/kpi/auto-mappings'),
      loadListsDatalist(),
    ]);
    const selectedQuarter = $('#kpi-quarter-input') ? $('#kpi-quarter-input').value : '';

    const formCol = colTitle('Add or update a mapping') + `
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="map-profile">Role</label>
          <select class="form-control" id="map-profile">${KPI_PROFILES.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="map-metric">Metric ID (e.g. Q1, D2)</label>
          <input class="form-control" id="map-metric">
        </div>
        <div class="form-group full">
          <label class="form-label" for="map-method">Method</label>
          <select class="form-control" id="map-method" data-method-select>
            ${METHODS.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group full">
          <label class="form-label" for="map-list-ids">ClickUp list ID(s), comma-separated</label>
          <input class="form-control" id="map-list-ids" list="kpi-known-lists" placeholder="e.g. 901521332761">
        </div>
        <div class="form-group full" id="map-extra-fields">${methodExtraFieldsHtml(METHODS[0].value)}</div>
        <div class="form-group full"><button class="btn primary small" data-kpi-map-action="save">Save mapping</button></div>
      </div>`;
    const runCol = colTitle('Run auto-compute') + `
      <p class="panel-text">Recomputes every mapped metric for a quarter from ClickUp now. There's no schedule — it only runs when triggered here.</p>
      <div class="kpi-entry-row">
        <input class="form-control small" id="map-run-quarter" placeholder="YYYY-Qn" value="${escapeHtml(selectedQuarter)}" aria-label="Quarter to compute">
        <button class="btn small" data-kpi-map-action="run-compute">Run now</button>
      </div>`;

    const tableHtml = mappings.length === 0 ? '<div class="list-empty">No mappings configured yet.</div>' : `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Role</th><th>Metric</th><th>Method</th><th>Config</th><th></th></tr></thead>
          <tbody>
            ${mappings.map((m) => `
              <tr>
                <td>${escapeHtml(m.kpi_profile)}</td>
                <td>${escapeHtml(m.metric_id)}</td>
                <td>${escapeHtml((METHODS.find((x) => x.value === m.method) || {}).label || m.method)}</td>
                <td class="small muted">${escapeHtml(JSON.stringify(m.config))}</td>
                <td style="white-space:nowrap;">${removeButtonHtml(m.kpi_profile, m.metric_id)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    container.innerHTML = `<datalist id="kpi-known-lists">${listsDatalistHtml}</datalist>
      <div class="stack">
        ${panel({ title: 'ClickUp mappings', meta: 'Admin only', body: split([{ html: formCol }, { html: runCol }], '1.5fr 1fr') })}
        ${panel({ title: 'Existing mappings', meta: `${mappings.length} configured`, body: `<div class="panel-body">${tableHtml}</div>` })}
      </div>`;
  } catch (err) {
    console.error('KPI mappings failed to load', err);
    container.innerHTML = loadErrorPanel('ClickUp mappings couldn’t load', err, 'data-map-retry');
    container.querySelector('[data-map-retry]').addEventListener('click', () => renderKpiMappingAdmin(container));
  }
}
