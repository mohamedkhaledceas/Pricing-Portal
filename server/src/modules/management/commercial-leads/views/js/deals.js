import { $, escapeHtml, paginate } from './dom.js';
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
      <td>${escapeHtml(d.name)}</td>
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

export function renderActiveClientsTable() {
  const allDeals = state.dealsCache.activeClients;
  const { pageItems: deals, clampedPage } = paginate(allDeals, state.activeClientsPage, state.activeClientsPageSize, 'paginationActiveClients',
    (p) => { state.activeClientsPage = p; renderActiveClientsTable(); },
    (size) => { state.activeClientsPageSize = size; state.activeClientsPage = 1; renderActiveClientsTable(); }
  );
  state.activeClientsPage = clampedPage;
  const tbody = document.querySelector('#activeClientsTable tbody');
  if (deals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-note">No items synced yet.</td></tr>';
    return;
  }
  tbody.innerHTML = deals.map((d) => `
    <tr><td>${escapeHtml(d.name)}</td><td>${statusPillHtml(d.status, 'activeClients')}</td></tr>
  `).join('');
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
}
