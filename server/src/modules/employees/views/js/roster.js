import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';
import { state } from './state.js';

const KPI_PROFILES = ['content', 'artdirector', 'aidesigner', 'production', 'am', 'pandc', 'heads', 'design'];
// Fixed-value lists live in window.OrgConstants (shared/orgConstants.js) —
// single source of truth also used by the signup wizard and Account
// Settings' Work Details section. Server-side enforcement is the real
// gate (rosterService.validateFixedFields); this is display/dropdown-
// population only. Department is no longer one of these — it's a real,
// role-manageable table now (window.Departments, departments.js).
const { WORK_LOCATIONS, WORK_LOCATION_LABELS, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, JOB_TITLES } = window.OrgConstants;

// Same "current value survives even if unmatched" fallback as
// departmentOptionsHtml below — job title used to be free text, so an
// existing employee's stored value may predate the fixed list.
function jobTitleOptionsHtml(currentTitle) {
  const options = JOB_TITLES.map((t) => `<option value="${escapeHtml(t)}" ${t === currentTitle ? 'selected' : ''}>${escapeHtml(t)}</option>`);
  if (currentTitle && !JOB_TITLES.includes(currentTitle)) {
    options.push(`<option value="${escapeHtml(currentTitle)}" selected>${escapeHtml(currentTitle)} (unmatched)</option>`);
  }
  return options.join('');
}

// Options for a department <select> — active departments, plus (only for
// an already-assigned employee) their current department even if it's now
// deactivated or doesn't match any known code at all, so editing never
// silently blanks a mismatched value. This is also the direct fix for the
// bug that motivated this feature: an admin can now see exactly what raw
// value is stored (via window.Departments.labelFor's raw-code fallback)
// and pick a real department instead.
function departmentOptionsHtml(currentCode) {
  const all = window.Departments.list();
  const active = all.filter((d) => d.active);
  const options = active.map((d) => `<option value="${d.code}" ${d.code === currentCode ? 'selected' : ''}>${escapeHtml(d.label)}</option>`);
  if (currentCode && !active.some((d) => d.code === currentCode)) {
    options.push(`<option value="${escapeHtml(currentCode)}" selected>${escapeHtml(window.Departments.labelFor(currentCode))} (inactive/unmatched)</option>`);
  }
  return options.join('');
}
// 'on_leave' deliberately excluded — it's computed server-side from
// approved leave requests, not a settable value (see rosterService).
const STATUS_OPTIONS = ['active', 'remote'];
const STATUS_LABELS = { active: 'Active', remote: 'Remote', on_leave: 'On Leave' };
const STATUS_BADGE_CLASS = { active: 'badge-approved', remote: 'badge-approved', on_leave: 'badge-pending' };
// Team Head toggle rendering — matches rosterService.canManageRoster/
// canAssignTeamHead exactly (same role set, both gates are equivalent).
const canAssignTeamHead = () => ['admin', 'manager', 'operations', 'people_culture'].includes(state.currentUser && state.currentUser.role);

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
    };
    await apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
    toast('Employee added to roster', 'info');
    candidateUsers = null;
    await renderRoster();
  } catch (err) {
    resultEl.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  } finally {
    btn.disabled = false;
  }
}
window.rosterSubmitCreate = submitCreate;

const ROSTER_BOOLEAN_FIELDS = new Set(['isTeamHead']);
const ROSTER_MANAGER_FIELD = 'managerEmployeeId';

// Autosave, one field at a time, fired straight off each control's own
// onchange — no Save button, no full-row payload. Sends only { [field]:
// value }, relying on employeeRepository.update's partial-update semantics
// (only keys present in the payload are touched — see its own comment and
// the fix in 06631b4) so this can never blank out this row's other fields,
// and the UPDATE itself is always scoped to this one id, never any other
// row. On failure, re-pulls the table from the server rather than trying
// to hand-revert the control, so the UI always ends up matching the DB.
async function rosterFieldChanged(id, field, el) {
  const value = ROSTER_BOOLEAN_FIELDS.has(field) ? el.checked : field === ROSTER_MANAGER_FIELD ? (el.value ? Number(el.value) : null) : el.value;
  try {
    await apiFetch(`/api/employees/${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
    const cached = rosterCache.find((e) => e.id === id);
    if (cached) cached[field] = value;
    toast('Saved', 'info');
  } catch (err) {
    toast(err.message, 'danger');
    await renderRosterTable();
  }
}
window.rosterFieldChanged = rosterFieldChanged;

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
  const [res] = await Promise.all([apiFetch('/api/employees'), window.Departments.load(apiFetch)]);
  rosterCache = res.employees || [];
  directoryCache = rosterCache.map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName }));

  const rows = rosterCache.map((e) => `
    <tr id="roster-row-${e.id}">
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:50%; overflow:hidden; flex-shrink:0;">${window.AccountMenu.avatarHtml(e.photoUrl, e)}</div>
          <div>
            ${escapeHtml(e.firstName + ' ' + e.lastName)}<div class="small muted">${escapeHtml(e.email)}</div>
          </div>
        </div>
      </td>
      <td>
        <select class="form-control edit-job-title small" style="min-width:110px;" onchange="rosterFieldChanged(${e.id}, 'jobTitle', this)">
          <option value="">—</option>
          ${jobTitleOptionsHtml(e.jobTitle)}
        </select>
      </td>
      <td>
        <select class="form-control edit-department small" style="min-width:150px;" onchange="rosterFieldChanged(${e.id}, 'department', this)">
          <option value="">—</option>
          ${departmentOptionsHtml(e.department)}
        </select>
      </td>
      <td>
        <select class="form-control edit-kpi-profile small" style="min-width:120px;" onchange="rosterFieldChanged(${e.id}, 'kpiProfile', this)">
          <option value="">—</option>
          ${KPI_PROFILES.map((p) => `<option value="${p}" ${e.kpiProfile === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="form-control edit-employment-type small" style="min-width:110px;" onchange="rosterFieldChanged(${e.id}, 'employmentType', this)">
          <option value="">—</option>
          ${EMPLOYMENT_TYPES.map((t) => `<option value="${t}" ${e.employmentType === t ? 'selected' : ''}>${EMPLOYMENT_TYPE_LABELS[t]}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" class="form-control edit-joining-date small" value="${escapeHtml(e.joiningDate || '')}" style="min-width:130px;" onchange="rosterFieldChanged(${e.id}, 'joiningDate', this)"></td>
      <td>
        <select class="form-control edit-work-location small" style="min-width:120px;" onchange="rosterFieldChanged(${e.id}, 'workLocation', this)">
          <option value="">—</option>
          ${WORK_LOCATIONS.map((l) => `<option value="${l}" ${e.workLocation === l ? 'selected' : ''}>${escapeHtml(WORK_LOCATION_LABELS[l])}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="form-control edit-manager small" style="min-width:130px;" onchange="rosterFieldChanged(${e.id}, 'managerEmployeeId', this)">
          <option value="">— None —</option>
          ${managerOptions(e.id)}
        </select>
      </td>
      <td style="text-align:center;">${e.authRole === 'people_culture' ? '<span class="badge badge-approved">P&amp;C</span>' : ''}</td>
      <td style="text-align:center;">
        ${canAssignTeamHead()
          ? `<input type="checkbox" class="edit-team-head" ${e.isTeamHead ? 'checked' : ''} title="Team Head" onchange="rosterFieldChanged(${e.id}, 'isTeamHead', this)">`
          : (e.isTeamHead ? '<span class="badge badge-approved">Team Head</span>' : '')}
      </td>
      <td>
        ${e.status === 'on_leave'
          ? `<span class="badge ${STATUS_BADGE_CLASS.on_leave}">${STATUS_LABELS.on_leave}</span><div class="small muted">computed from approved leave</div>`
          : `<select class="form-control edit-status small" style="min-width:100px;" onchange="rosterFieldChanged(${e.id}, 'status', this)">
              ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select>`}
      </td>
      <td>${e.active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
      <td>
        <button class="btn small ${e.active ? 'danger' : ''}" onclick="rosterToggleActive(${e.id}, ${!e.active})">${e.active ? 'Deactivate' : 'Reactivate'}</button>
      </td>
    </tr>`).join('');

  $('#roster-table-body').innerHTML = rows || '<tr><td colspan="15" class="empty-state">No employees in the roster yet</td></tr>';

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
        <select class="form-control" id="roster-department">
          <option value="">— None yet —</option>
          ${window.Departments.list().filter((d) => d.active).map((d) => `<option value="${d.code}">${escapeHtml(d.label)}</option>`).join('')}
        </select>
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
      <div class="form-group full" id="roster-create-result"></div>
      <div class="form-group full"><button class="btn primary" id="roster-create-btn">Add to Roster</button></div>
    </div>`;
  $('#roster-create-btn').addEventListener('click', submitCreate);
}

/* ── Departments (manager/people_culture/operations/admin — the same
   canManageRoster role set that already gates this whole page — can add
   one, and rename an existing one in place; see docs/adr/0011). Editing
   only ever changes the display label, never `code` (the FK target every
   employee row's department actually points to), so a rename can never
   orphan an existing assignment. Same list+inline-add-form shape as Team
   Conflict Pairs below; editing reuses the same reveal-a-form-inline
   pattern as timeOff.js's cancel-confirm and team.js's reject-note. */
async function addDepartment() {
  const input = $('#dept-add-input');
  const label = input.value.trim();
  if (!label) { toast('Enter a department name', 'danger'); return; }
  try {
    await apiFetch('/api/employees/departments', { method: 'POST', body: JSON.stringify({ label }) });
    toast('Department added', 'info');
    await window.Departments.refresh(apiFetch);
    await renderRoster();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.deptAdd = addDepartment;

let editingDepartmentId = null;

function askEditDepartment(id) {
  editingDepartmentId = id;
  renderDepartmentsSection();
}
window.deptAskEdit = askEditDepartment;

function cancelEditDepartment() {
  editingDepartmentId = null;
  renderDepartmentsSection();
}
window.deptCancelEdit = cancelEditDepartment;

async function saveEditDepartment(id) {
  const input = $('#dept-edit-input-' + id);
  const label = input.value.trim();
  if (!label) { toast('Enter a department name', 'danger'); return; }
  try {
    await apiFetch(`/api/employees/departments/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) });
    toast('Department updated', 'info');
    editingDepartmentId = null;
    await window.Departments.refresh(apiFetch);
    await renderRoster();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.deptSaveEdit = saveEditDepartment;

function renderDepartmentsSection() {
  const departments = window.Departments.list();
  $('#departments-list').innerHTML = departments.length
    ? departments.map((d) => `<div class="request-card" style="margin-bottom:6px;">
        ${editingDepartmentId === d.id
          ? `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
              <input class="form-control" id="dept-edit-input-${d.id}" value="${escapeHtml(d.label)}" style="flex:1; min-width:200px;">
              <button class="btn small primary" onclick="deptSaveEdit(${d.id})">Save</button>
              <button class="btn small" onclick="deptCancelEdit()">Cancel</button>
            </div>`
          : `<div class="request-card-top">
              <div>${escapeHtml(d.label)} <span class="small muted">${escapeHtml(d.code)}</span></div>
              <button class="btn small" onclick="deptAskEdit(${d.id})">Edit</button>
            </div>`}
      </div>`).join('')
    : `<div class="empty-state small">No departments yet</div>`;

  $('#departments-form').innerHTML = `
    <div class="form-grid">
      <div class="form-group full">
        <input class="form-control" id="dept-add-input" placeholder="Department name (e.g. AI &amp; Innovation)">
      </div>
      <div class="form-group full"><button class="btn small" id="dept-add-btn">Add Department</button></div>
    </div>`;
  $('#dept-add-btn').addEventListener('click', addDepartment);
}

/* ── Conflict pairs — manager/people_culture/operations/admin (same
   canManageRoster role set gating this whole page) can add one, edit which
   two employees it covers in place, or delete it outright. Delete is a
   real removal (not a revoke/deactivate) — see conflictPairRepository.
   remove's own comment on why that's safe for this table specifically. */
async function loadConflictPairs() {
  const res = await apiFetch('/api/employees/conflict-pairs');
  return res.conflictPairs || [];
}

function directoryName(id) {
  const e = directoryCache.find((d) => d.id === id);
  return e ? `${e.firstName} ${e.lastName}` : `#${id}`;
}

function employeeOptionsHtml(selectedId) {
  return directoryCache
    .map((e) => `<option value="${e.id}" ${e.id === selectedId ? 'selected' : ''}>${escapeHtml(e.firstName + ' ' + e.lastName)}</option>`)
    .join('');
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

let editingConflictPairId = null;
let confirmingDeleteConflictPairId = null;

function askEditConflictPair(id) {
  editingConflictPairId = id;
  confirmingDeleteConflictPairId = null;
  renderConflictPairs();
}
window.cpAskEdit = askEditConflictPair;

function cancelEditConflictPair() {
  editingConflictPairId = null;
  renderConflictPairs();
}
window.cpCancelEdit = cancelEditConflictPair;

async function saveEditConflictPair(id) {
  const a = Number($(`#cp-edit-a-${id}`).value);
  const b = Number($(`#cp-edit-b-${id}`).value);
  if (!a || !b || a === b) { toast('Pick two different employees', 'danger'); return; }
  try {
    await apiFetch(`/api/employees/conflict-pairs/${id}`, { method: 'PATCH', body: JSON.stringify({ employeeIdA: a, employeeIdB: b }) });
    toast('Conflict pair updated', 'info');
    editingConflictPairId = null;
    await renderConflictPairs();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.cpSaveEdit = saveEditConflictPair;

function askDeleteConflictPair(id) {
  confirmingDeleteConflictPairId = id;
  editingConflictPairId = null;
  renderConflictPairs();
}
window.cpAskDelete = askDeleteConflictPair;

function cancelDeleteConflictPair() {
  confirmingDeleteConflictPairId = null;
  renderConflictPairs();
}
window.cpCancelDelete = cancelDeleteConflictPair;

async function deleteConflictPair(id) {
  try {
    await apiFetch(`/api/employees/conflict-pairs/${id}`, { method: 'DELETE' });
    toast('Conflict pair deleted', 'info');
    confirmingDeleteConflictPairId = null;
    await renderConflictPairs();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.cpDelete = deleteConflictPair;

function conflictPairRowHtml(p) {
  if (editingConflictPairId === p.id) {
    return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
      <select class="form-control" id="cp-edit-a-${p.id}" style="flex:1; min-width:160px;">${employeeOptionsHtml(p.employeeIdA)}</select>
      <select class="form-control" id="cp-edit-b-${p.id}" style="flex:1; min-width:160px;">${employeeOptionsHtml(p.employeeIdB)}</select>
      <button class="btn small primary" onclick="cpSaveEdit(${p.id})">Save</button>
      <button class="btn small" onclick="cpCancelEdit()">Cancel</button>
    </div>`;
  }
  if (confirmingDeleteConflictPairId === p.id) {
    return `<div class="request-card-top">
      <span class="small">Delete this pair? </span>
      <span>
        <button class="btn small danger" onclick="cpDelete(${p.id})">Yes</button>
        <button class="btn small" onclick="cpCancelDelete()">No</button>
      </span>
    </div>`;
  }
  return `<div class="request-card-top">
    <div>${escapeHtml(directoryName(p.employeeIdA))} ↔ ${escapeHtml(directoryName(p.employeeIdB))}</div>
    <span>
      <button class="btn small" onclick="cpAskEdit(${p.id})">Edit</button>
      <button class="btn small danger" onclick="cpAskDelete(${p.id})">Delete</button>
    </span>
  </div>`;
}

async function renderConflictPairs() {
  const pairs = await loadConflictPairs();
  $('#conflict-pairs-list').innerHTML = pairs.length
    ? pairs.map((p) => `<div class="request-card" style="margin-bottom:6px;">${conflictPairRowHtml(p)}</div>`).join('')
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
      <div class="card-title">Departments</div>
      <div id="departments-list" class="mt-8"></div>
      <div id="departments-form" class="mt-16"></div>
    </div>
    <div class="card section">
      <div class="card-title">All Employees</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Job Title</th><th>Department</th><th>KPI Profile</th><th>Employment Type</th><th>Joining Date</th><th>Work Location</th><th>Manager</th><th>P&amp;C</th><th>Team Head</th><th>Status</th><th>Active</th><th></th></tr></thead>
          <tbody id="roster-table-body"><tr><td colspan="15" class="empty-state">Loading...</td></tr></tbody>
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
  renderDepartmentsSection();
  await renderCreateForm();
  await renderConflictPairs();
}
