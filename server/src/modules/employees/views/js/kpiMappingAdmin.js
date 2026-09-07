import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';

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
window.kpiSaveMapping = saveMapping;

async function removeMapping(kpiProfile, metricId) {
  try {
    await apiFetch(`/api/employees/kpi/auto-mappings/${kpiProfile}/${metricId}`, { method: 'DELETE' });
    toast('Mapping removed', 'info');
    renderKpiMappingAdmin($('#kpi-view-content'));
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.kpiRemoveMapping = removeMapping;

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
window.kpiRunComputeAutoScores = runCompute;

export async function renderKpiMappingAdmin(container) {
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const [{ mappings }, listsDatalistHtml] = await Promise.all([
      apiFetch('/api/employees/kpi/auto-mappings'),
      loadListsDatalist(),
    ]);

    container.innerHTML = `
      <datalist id="kpi-known-lists">${listsDatalistHtml}</datalist>
      <div class="card section">
        <div class="card-title">Add / Update Mapping</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="form-control" id="map-profile">${KPI_PROFILES.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Metric ID (e.g. Q1, D2)</label>
            <input class="form-control" id="map-metric">
          </div>
          <div class="form-group">
            <label class="form-label">Method</label>
            <select class="form-control" id="map-method" onchange="document.getElementById('map-extra-fields').innerHTML = ''; kpiRenderMappingExtraFields(this.value)">
              ${METHODS.map((m) => `<option value="${m.value}">${m.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group full">
            <label class="form-label">ClickUp list ID(s), comma-separated</label>
            <input class="form-control" id="map-list-ids" list="kpi-known-lists" placeholder="e.g. 901521332761">
          </div>
          <div class="form-group full" id="map-extra-fields">${methodExtraFieldsHtml(METHODS[0].value)}</div>
          <div class="form-group full"><button class="btn primary small" onclick="kpiSaveMapping()">Save Mapping</button></div>
        </div>
      </div>

      <div class="card section">
        <div class="card-title">Run Auto-Compute</div>
        <div class="kpi-entry-row">
          <input class="form-control small" id="map-run-quarter" placeholder="YYYY-Qn">
          <button class="btn small" onclick="kpiRunComputeAutoScores()">Run Now</button>
        </div>
      </div>

      <div class="card section">
        <div class="card-title">Existing Mappings</div>
        ${mappings.length === 0 ? '<div class="muted small">No mappings configured yet.</div>' : `
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead><tr><th>Role</th><th>Metric</th><th>Method</th><th>Config</th><th></th></tr></thead>
            <tbody>
              ${mappings.map((m) => `
                <tr>
                  <td>${escapeHtml(m.kpi_profile)}</td>
                  <td>${escapeHtml(m.metric_id)}</td>
                  <td>${escapeHtml(m.method)}</td>
                  <td class="small muted">${escapeHtml(JSON.stringify(m.config))}</td>
                  <td><button class="btn small" onclick="kpiRemoveMapping('${m.kpi_profile}', '${m.metric_id}')">Remove</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}

window.kpiRenderMappingExtraFields = (method) => {
  $('#map-extra-fields').innerHTML = methodExtraFieldsHtml(method);
};
