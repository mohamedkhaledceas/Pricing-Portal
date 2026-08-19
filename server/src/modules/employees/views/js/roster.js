import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';

const KPI_PROFILES = ['content', 'artdirector', 'aidesigner', 'production', 'am', 'pandc', 'heads', 'design'];

let rosterCache = [];
let directoryCache = [];
let candidateUsers = null; // null = not yet attempted, [] = attempted but forbidden/empty

async function loadCandidateUsers() {
  if (candidateUsers !== null) return candidateUsers;
  try {
    const res = await apiFetch('/api/users');
    const existingUserIds = new Set(rosterCache.map((e) => e.userId));
    candidateUsers = (res.users || []).filter((u) => !existingUserIds.has(u.id));
  } catch (err) {
    candidateUsers = []; // 403 for non-manager-role P&C — form falls back to manual entry
  }
  return candidateUsers;
}

function managerOptions(excludeId) {
  return directoryCache
    .filter((e) => e.id !== excludeId)
    .map((e) => `<option value="${e.id}">${escapeHtml(e.firstName + ' ' + e.lastName)}</option>`)
    .join('');
}

async function submitCreate() {
  const btn = $('#roster-create-btn');
  const resultEl = $('#roster-create-result');
  resultEl.innerHTML = '';
  btn.disabled = true;
  try {
    const userIdField = $('#roster-user-select') || $('#roster-user-manual');
    const userId = Number(userIdField.value);
    if (!userId) throw new Error('Select or enter a user ID.');
    const payload = {
      userId,
      department: $('#roster-department').value || undefined,
      kpiProfile: $('#roster-kpi-profile').value || undefined,
      managerEmployeeId: $('#roster-manager').value ? Number($('#roster-manager').value) : undefined,
      isPeopleCulture: $('#roster-is-pc').checked,
    };
    await apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
    toast('Employee added to roster', 'info');
    candidateUsers = null;
    await renderRoster();
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-danger"><span>⚠️</span><div>${escapeHtml(err.message)}</div></div>`;
  } finally {
    btn.disabled = false;
  }
}
window.rosterSubmitCreate = submitCreate;

async function updateEmployee(id) {
  const row = $('#roster-row-' + id);
  try {
    const payload = {
      department: row.querySelector('.edit-department').value || undefined,
      kpiProfile: row.querySelector('.edit-kpi-profile').value || undefined,
      managerEmployeeId: row.querySelector('.edit-manager').value ? Number(row.querySelector('.edit-manager').value) : undefined,
      isPeopleCulture: row.querySelector('.edit-is-pc').checked,
    };
    await apiFetch(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast('Updated', 'info');
    await renderRoster();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.rosterUpdateEmployee = updateEmployee;

async function toggleActive(id, active) {
  try {
    await apiFetch(`/api/employees/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
    toast(active ? 'Reactivated' : 'Deactivated', 'info');
    await renderRoster();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.rosterToggleActive = toggleActive;

async function renderRosterTable() {
  const res = await apiFetch('/api/employees');
  rosterCache = res.employees || [];
  directoryCache = rosterCache.map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName }));

  const rows = rosterCache.map((e) => `
    <tr id="roster-row-${e.id}">
      <td>${escapeHtml(e.firstName + ' ' + e.lastName)}<div class="small muted">${escapeHtml(e.email)}</div></td>
      <td><input class="form-control edit-department small" value="${escapeHtml(e.department || '')}" style="min-width:110px;"></td>
      <td>
        <select class="form-control edit-kpi-profile small" style="min-width:120px;">
          <option value="">—</option>
          ${KPI_PROFILES.map((p) => `<option value="${p}" ${e.kpiProfile === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="form-control edit-manager small" style="min-width:130px;">
          <option value="">— None —</option>
          ${managerOptions(e.id)}
        </select>
      </td>
      <td style="text-align:center;"><input type="checkbox" class="edit-is-pc" ${e.isPeopleCulture ? 'checked' : ''}></td>
      <td>${e.active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
      <td>
        <button class="btn small" onclick="rosterUpdateEmployee(${e.id})">Save</button>
        <button class="btn small ${e.active ? 'danger' : ''}" onclick="rosterToggleActive(${e.id}, ${!e.active})">${e.active ? 'Deactivate' : 'Reactivate'}</button>
      </td>
    </tr>`).join('');

  $('#roster-table-body').innerHTML = rows || '<tr><td colspan="7" class="empty-state">No employees in the roster yet</td></tr>';

  // Pre-select each row's manager dropdown now that options exist.
  rosterCache.forEach((e) => {
    const sel = document.querySelector(`#roster-row-${e.id} .edit-manager`);
    if (sel && e.managerEmployeeId) sel.value = String(e.managerEmployeeId);
  });
}

async function renderCreateForm() {
  const users = await loadCandidateUsers();
  const managerOpts = managerOptions(null);
  $('#roster-create-panel').innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Account *</label>
        ${users.length
          ? `<select class="form-control" id="roster-user-select">
              <option value="">— Select account —</option>
              ${users.map((u) => `<option value="${u.id}">${escapeHtml(u.email)}</option>`).join('')}
            </select>`
          : `<input class="form-control" id="roster-user-manual" type="number" placeholder="Account (user) ID">
             <div class="form-hint">Couldn't load the account list (needs manager/operations/admin access) — ask an admin for the account ID.</div>`}
      </div>
      <div class="form-group">
        <label class="form-label">Department</label>
        <input class="form-control" id="roster-department" placeholder="e.g. Content Writing">
      </div>
      <div class="form-group">
        <label class="form-label">KPI Profile</label>
        <select class="form-control" id="roster-kpi-profile">
          <option value="">— None yet —</option>
          ${KPI_PROFILES.map((p) => `<option value="${p}">${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Manager</label>
        <select class="form-control" id="roster-manager"><option value="">— None —</option>${managerOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">People &amp; Culture?</label>
        <div><input type="checkbox" id="roster-is-pc"> <span class="small muted">Grants roster management + leave-confirmation rights</span></div>
      </div>
      <div class="form-group full" id="roster-create-result"></div>
      <div class="form-group full"><button class="btn primary" id="roster-create-btn">Add to Roster</button></div>
    </div>`;
  $('#roster-create-btn').addEventListener('click', submitCreate);
}

/* ── Conflict pairs (inert extension point — see docs/adr for the
   unresolved-enforcement decision; this is data management only). */
async function loadConflictPairs() {
  const res = await apiFetch('/api/employees/conflict-pairs');
  return res.conflictPairs || [];
}

function directoryName(id) {
  const e = directoryCache.find((d) => d.id === id);
  return e ? `${e.firstName} ${e.lastName}` : `#${id}`;
}

async function addConflictPair() {
  const a = Number($('#cp-a').value);
  const b = Number($('#cp-b').value);
  if (!a || !b || a === b) { toast('Pick two different employees', 'danger'); return; }
  try {
    await apiFetch('/api/employees/conflict-pairs', { method: 'POST', body: JSON.stringify({ employeeIdA: a, employeeIdB: b }) });
    toast('Conflict pair added', 'info');
    await renderConflictPairs();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.cpAdd = addConflictPair;

async function deactivateConflictPair(id) {
  try {
    await apiFetch(`/api/employees/conflict-pairs/${id}/deactivate`, { method: 'POST' });
    await renderConflictPairs();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.cpDeactivate = deactivateConflictPair;

async function renderConflictPairs() {
  const pairs = await loadConflictPairs();
  $('#conflict-pairs-list').innerHTML = pairs.length
    ? pairs.map((p) => `<div class="request-card" style="margin-bottom:6px;">
        <div class="request-card-top">
          <div>${escapeHtml(directoryName(p.employeeIdA))} ↔ ${escapeHtml(directoryName(p.employeeIdB))}</div>
          ${p.active ? `<button class="btn small danger" onclick="cpDeactivate(${p.id})">Deactivate</button>` : '<span class="badge badge-neutral">Inactive</span>'}
        </div>
      </div>`).join('')
    : `<div class="empty-state small">No conflict pairs recorded</div>`;

  $('#conflict-pairs-form').innerHTML = `
    <div class="form-grid">
      <div class="form-group"><select class="form-control" id="cp-a"><option value="">— Employee A —</option>${managerOptions(null)}</select></div>
      <div class="form-group"><select class="form-control" id="cp-b"><option value="">— Employee B —</option>${managerOptions(null)}</select></div>
      <div class="form-group full"><button class="btn small" id="cp-add-btn">Add Pair</button></div>
    </div>`;
  $('#cp-add-btn').addEventListener('click', addConflictPair);
}

export async function renderRoster() {
  const container = $('#roster-content');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Employee Roster</div>
      <div class="page-subtitle">Manual roster management — automatic ClickUp sync is deferred (see migration plan)</div>
    </div>
    <div class="card section">
      <div class="card-title">Add Employee</div>
      <div id="roster-create-panel"><div class="empty-state small">Loading...</div></div>
    </div>
    <div class="card section">
      <div class="card-title">All Employees</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Department</th><th>KPI Profile</th><th>Manager</th><th>P&amp;C</th><th>Status</th><th></th></tr></thead>
          <tbody id="roster-table-body"><tr><td colspan="7" class="empty-state">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
    <div class="card section">
      <div class="card-title">Team Conflict Pairs <span class="small muted">(informational only — not enforced by the request form yet)</span></div>
      <div id="conflict-pairs-list" class="mt-8"></div>
      <div id="conflict-pairs-form" class="mt-16"></div>
    </div>
  `;
  await renderRosterTable();
  await renderCreateForm();
  await renderConflictPairs();
}
