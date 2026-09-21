import { $, escapeHtml, paginate, toast } from './dom.js';
import { contrastTextColor } from './charts.js';
import { state } from './state.js';

export const LIST_KEY_BY_ID = {
  '901518274897': 'pipeline',
  '901522751511': 'activeClients',
  '901524651435': 'offboarding',
};

export function statusPillHtml(status, listKey) {
  const color = (state.statusColors[listKey] || {})[String(status).toLowerCase()];
  const style = color ? ` style="background:${color};color:${contrastTextColor(color)}"` : '';
  return `<span class="status-pill"${style}>${escapeHtml(status)}</span>`;
}

// Flags a deal whose ClickUp task hasn't been touched in a while — helps
// AMs spot neglected accounts/deals. Pure client-side comparison against
// clickupUpdatedAt, which is already present and populated on every deal
// for every list (see deal.model.js's toDeal()); no backend change needed.
// A 'closed' deal is finished, not neglected — no changes expected or
// wanted, so it's excluded regardless of age.
const STALE_DAYS_THRESHOLD = 7;
function isStale(deal) {
  if (!deal.clickupUpdatedAt) return false;
  if (String(deal.status).trim().toLowerCase() === 'closed') return false;
  const ageMs = Date.now() - new Date(deal.clickupUpdatedAt).getTime();
  return ageMs > STALE_DAYS_THRESHOLD * 86400000;
}
function staleBadgeHtml(deal) {
  return isStale(deal) ? `<span class="stale-badge" title="Not updated in ${STALE_DAYS_THRESHOLD}+ days">⚠ Stale</span>` : '';
}

// fields are {name: {value, type}} — url-type fields render as real links.
function fieldText(fields, name) {
  const f = fields[name];
  if (!f) return '';
  return Array.isArray(f.value) ? f.value.join(', ') : String(f.value);
}

function renderFieldValue(name, f) {
  const text = escapeHtml(Array.isArray(f.value) ? f.value.join(', ') : f.value);
  if (f.type === 'url' && typeof f.value === 'string' && /^https?:\/\//.test(f.value)) {
    return `<a href="${escapeHtml(f.value)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  }
  if (f.type === 'email' && typeof f.value === 'string') {
    return `<a href="mailto:${escapeHtml(f.value)}">${text}</a>`;
  }
  return text;
}

function renderDealDetails(deal) {
  const entries = Object.entries(deal.fields);
  const fieldsHtml = entries.length
    ? `<dl>${entries.map(([k, f]) => `<dt>${escapeHtml(k)}</dt><dd>${renderFieldValue(k, f)}</dd>`).join('')}</dl>`
    : '<div class="empty-note">No custom fields populated.</div>';
  const subtasksHtml = deal.subtasks.length
    ? `<div style="margin-top:8px;">${deal.subtasks.map((s) => `<span class="subtask-chip">${escapeHtml(s.name)} — ${escapeHtml(s.status)}</span>`).join('')}</div>`
    : '';
  return fieldsHtml + subtasksHtml;
}

function populateFilterOptions() {
  const fill = (selectEl, values, current) => {
    const sorted = Array.from(values).sort();
    selectEl.innerHTML = '<option value="">All</option>' + sorted.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    selectEl.value = current;
  };
  fill($('#filterStatus'), new Set(state.dealsCache.pipeline.map((d) => d.status).filter(Boolean)), state.filters.status);
  fill($('#filterCountry'), new Set(state.dealsCache.pipeline.map((d) => fieldText(d.fields, 'Country ')).filter(Boolean)), state.filters.country);
  fill($('#filterSource'), new Set(state.dealsCache.pipeline.map((d) => fieldText(d.fields, 'Source ')).filter(Boolean)), state.filters.source);
}

function applyFiltersAndSort(deals) {
  const filters = state.filters;
  let result = deals.filter((d) =>
    (!filters.status || d.status === filters.status) &&
    (!filters.country || fieldText(d.fields, 'Country ') === filters.country) &&
    (!filters.source || fieldText(d.fields, 'Source ') === filters.source) &&
    (!filters.search ||
      d.name.toLowerCase().includes(filters.search) ||
      fieldText(d.fields, 'Contact Person ').toLowerCase().includes(filters.search))
  );
  const byEdited = (a, b) => new Date(a.clickupUpdatedAt || 0) - new Date(b.clickupUpdatedAt || 0);
  const sortMode = state.sortMode;
  if (sortMode === 'edited-desc') result = result.slice().sort((a, b) => byEdited(b, a));
  else if (sortMode === 'edited-asc') result = result.slice().sort(byEdited);
  else if (sortMode === 'name-asc') result = result.slice().sort((a, b) => a.name.localeCompare(b.name));
  else if (sortMode === 'name-desc') result = result.slice().sort((a, b) => b.name.localeCompare(a.name));
  return result;
}

function updateClearFiltersButton() {
  const f = state.filters;
  const anyActive = f.status || f.country || f.source || f.search;
  $('#btnClearFilters').hidden = !anyActive;
}

export function renderPipelineTable() {
  populateFilterOptions();
  updateClearFiltersButton();
  const allDeals = applyFiltersAndSort(state.dealsCache.pipeline);
  const { pageItems: deals, clampedPage } = paginate(allDeals, state.pipelinePage, state.pipelinePageSize, 'paginationPipeline',
    (p) => { state.pipelinePage = p; renderPipelineTable(); },
    (size) => { state.pipelinePageSize = size; state.pipelinePage = 1; renderPipelineTable(); }
  );
  state.pipelinePage = clampedPage;
  const tbody = document.querySelector('#pipelineTable tbody');
  if (deals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No deals match.</td></tr>';
    return;
  }
  tbody.innerHTML = deals.map((d) => `
    <tr class="deal-row" data-id="${d.id}">
      <td>${escapeHtml(d.name)} ${staleBadgeHtml(d)}</td>
      <td>${statusPillHtml(d.status, 'pipeline')}</td>
      <td>${escapeHtml(fieldText(d.fields, 'Contact Person '))}</td>
      <td>${escapeHtml(fieldText(d.fields, 'Country '))}</td>
      <td>${escapeHtml(fieldText(d.fields, 'Source '))}</td>
    </tr>
    <tr><td colspan="5" style="padding:0;border:none;"><div class="deal-details" id="details-${d.id}">${renderDealDetails(d)}</div></td></tr>
  `).join('');
  tbody.querySelectorAll('.deal-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      document.getElementById('details-' + row.dataset.id).classList.toggle('open');
    });
  });
}

// Mirrors populateFilterOptions/applyFiltersAndSort above, but this list
// has no country/source/contact fields rendered (see the table's own
// Name/Status-only header) — just status + a name search, per this card's
// own "live display only" scope.
function populateActiveClientsFilterOptions() {
  const selectEl = $('#filterStatusActiveClients');
  const sorted = Array.from(new Set(state.dealsCache.activeClients.map((d) => d.status).filter(Boolean))).sort();
  selectEl.innerHTML = '<option value="">All</option>' + sorted.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  selectEl.value = state.activeClientsFilters.status;
}

function applyActiveClientsFilters(deals) {
  const filters = state.activeClientsFilters;
  return deals.filter((d) =>
    (!filters.status || d.status === filters.status) &&
    (!filters.search || d.name.toLowerCase().includes(filters.search))
  );
}

function updateClearFiltersButtonActiveClients() {
  const f = state.activeClientsFilters;
  $('#btnClearFiltersActiveClients').hidden = !(f.status || f.search);
}

export function renderActiveClientsTable() {
  populateActiveClientsFilterOptions();
  updateClearFiltersButtonActiveClients();
  const allDeals = applyActiveClientsFilters(state.dealsCache.activeClients);
  const { pageItems: deals, clampedPage } = paginate(allDeals, state.activeClientsPage, state.activeClientsPageSize, 'paginationActiveClients',
    (p) => { state.activeClientsPage = p; renderActiveClientsTable(); },
    (size) => { state.activeClientsPageSize = size; state.activeClientsPage = 1; renderActiveClientsTable(); }
  );
  state.activeClientsPage = clampedPage;
  const tbody = document.querySelector('#activeClientsTable tbody');
  if (deals.length === 0) {
    const message = state.dealsCache.activeClients.length === 0 ? 'No items synced yet.' : 'No items match.';
    tbody.innerHTML = `<tr><td colspan="2" class="empty-note">${message}</td></tr>`;
    return;
  }
  tbody.innerHTML = deals.map((d) => `
    <tr class="deal-row" data-id="${d.id}">
      <td>${escapeHtml(d.name)} ${staleBadgeHtml(d)}</td>
      <td>${statusPillHtml(d.status, 'activeClients')}</td>
    </tr>
    <tr><td colspan="2" style="padding:0;border:none;"><div class="deal-details" id="details-${d.id}">${renderDealDetails(d)}</div></td></tr>
  `).join('');
  tbody.querySelectorAll('.deal-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      document.getElementById('details-' + row.dataset.id).classList.toggle('open');
    });
  });
}

// A plain fetch, not apiFetch — the download needs the Authorization
// header, which a bare <a href> can't carry, and apiFetch always calls
// res.json() (this response is a CSV blob). Same pattern as the Employees
// module's KPI history CSV export (views/js/kpiHistory.js).
async function downloadDealsCsv(listKey) {
  const res = await fetch(`/api/commercial-lead/deals/export?list=${listKey}`, {
    headers: { Authorization: 'Bearer ' + state.accessToken },
  });
  if (!res.ok) {
    let message = 'Export failed. Please try again.';
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    toast(message, 'danger');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${listKey}-deals-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function bindDealsUi() {
  $('#filterStatus').addEventListener('change', (e) => { state.filters.status = e.target.value; state.pipelinePage = 1; renderPipelineTable(); });
  $('#filterCountry').addEventListener('change', (e) => { state.filters.country = e.target.value; state.pipelinePage = 1; renderPipelineTable(); });
  $('#filterSource').addEventListener('change', (e) => { state.filters.source = e.target.value; state.pipelinePage = 1; renderPipelineTable(); });
  $('#searchPipeline').addEventListener('input', (e) => {
    state.filters.search = e.target.value.trim().toLowerCase();
    state.pipelinePage = 1;
    renderPipelineTable();
  });
  $('#btnClearFilters').addEventListener('click', () => {
    state.filters = { status: '', country: '', source: '', search: '' };
    $('#searchPipeline').value = '';
    state.pipelinePage = 1;
    renderPipelineTable();
  });
  $('#sortPipeline').addEventListener('change', (e) => { state.sortMode = e.target.value; state.pipelinePage = 1; renderPipelineTable(); });
  $('#sortPipeline').addEventListener('click', (e) => e.stopPropagation());

  $('#filterStatusActiveClients').addEventListener('change', (e) => {
    state.activeClientsFilters.status = e.target.value;
    state.activeClientsPage = 1;
    renderActiveClientsTable();
  });
  $('#searchActiveClients').addEventListener('input', (e) => {
    state.activeClientsFilters.search = e.target.value.trim().toLowerCase();
    state.activeClientsPage = 1;
    renderActiveClientsTable();
  });
  $('#btnClearFiltersActiveClients').addEventListener('click', () => {
    state.activeClientsFilters = { status: '', search: '' };
    $('#searchActiveClients').value = '';
    state.activeClientsPage = 1;
    renderActiveClientsTable();
  });

  $('#btnExportPipeline').addEventListener('click', () => downloadDealsCsv('pipeline'));
  $('#btnExportActiveClients').addEventListener('click', () => downloadDealsCsv('activeClients'));
}
