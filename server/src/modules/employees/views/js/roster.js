import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';
import { state } from './state.js';
import { panel, split, colTitle, plural, loadErrorPanel, fullName } from './panels.js';

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
// Team Head toggle rendering — matches rosterService.canManageRoster/
// canAssignTeamHead exactly (same role set, both gates are equivalent).
const canAssignTeamHead = () => ['admin', 'ceo', 'operations', 'people_culture'].includes(state.currentUser && state.currentUser.role);

// Deliberately narrower than the rest of this page (admin/people_culture
// only) — matches conflictPairService.requireCanManage exactly, which has
// never included ceo/operations. The card used to render unconditionally
// for every canManageRoster role, so a ceo/operations viewer got an
// uncaught 403 exception from loadConflictPairs on every Roster page load
// (found 2026-09-28 while browser-testing an unrelated change) — hiding
// the card for roles the backend was already rejecting fixes that at the
// source instead of chasing the exception.
const canManageConflictPairs = () => ['admin', 'people_culture'].includes(state.currentUser && state.currentUser.role);

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

// Loaded once per roster-page visit (see renderRosterTable), not per row —
// backs the ClickUp ID column below so an admin can search by name/email
// instead of needing to already know someone's raw numeric ClickUp id.
let clickupMembersCache = [];

async function loadClickupMembers() {
  try {
    const res = await apiFetch('/api/employees/clickup-members');
    clickupMembersCache = res.members || [];
  } catch (err) {
    clickupMembersCache = []; // ClickUp unreachable — falls back to the raw-id option below, same as departmentOptionsHtml's own precedent
  }
}

// Same "current value survives even if unmatched" fallback as
// departmentOptionsHtml/jobTitleOptionsHtml above — an employee's stored
// clickup_user_id may point at someone who's since left the ClickUp
// workspace, or the fetch above may have failed outright.
function clickupMemberOptionsHtml(currentId) {
  const options = clickupMembersCache.map((m) => `<option value="${m.id}" ${String(m.id) === String(currentId) ? 'selected' : ''}>${escapeHtml(m.name)} (${escapeHtml(m.email)})</option>`);
  if (currentId && !clickupMembersCache.some((m) => String(m.id) === String(currentId))) {
    options.push(`<option value="${escapeHtml(String(currentId))}" selected>#${escapeHtml(String(currentId))} (not found in ClickUp)</option>`);
  }
  return options.join('');
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

// Deactivating ends someone's employment status (reactivating restores it),
// so it's confirmed inline first — no native confirm(), per project rule.
let confirmingDeactivateId = null;

function statusCellHtml(e) {
  if (!e.active) {
    return `<span class="badge badge-neutral">Inactive</span>
      <button class="btn small" data-roster-action="toggle-active" data-employee-id="${e.id}" data-new-active="true">Reactivate</button>`;
  }
  if (confirmingDeactivateId === e.id) {
    return `<span class="small">Deactivate ${escapeHtml(fullName(e))}?</span>
      <button class="btn small danger" data-roster-action="toggle-active" data-employee-id="${e.id}" data-new-active="false">Yes, deactivate</button>
      <button class="btn small" data-roster-action="cancel-deactivate" data-employee-id="${e.id}">No</button>`;
  }
  return `<span class="badge badge-approved">Active</span>
    <button class="btn small" data-roster-action="ask-deactivate" data-employee-id="${e.id}">Deactivate</button>`;
}

function setStatusCell(id) {
  const e = rosterCache.find((x) => x.id === id);
  const cell = document.querySelector(`#roster-row-${id} .roster-status-cell`);
  if (e && cell) cell.innerHTML = statusCellHtml(e);
}

// Search + status filter are applied by hiding rows, never by re-rendering —
// a re-render would throw away any dropdown the user is mid-way through.
// "Login mismatch" matches the Overview attention row that links here:
// employment status (active) and login access (isAccountActive) disagree.
function applyRosterFilters() {
  const q = ($('#roster-search') ? $('#roster-search').value : '').trim().toLowerCase();
  const status = $('#roster-status-filter') ? $('#roster-status-filter').value : '';
  let shown = 0;
  rosterCache.forEach((e) => {
    const row = document.getElementById('roster-row-' + e.id);
    if (!row) return;
    const text = `${fullName(e)} ${e.email || ''} ${e.jobTitle || ''} ${e.department ? window.Departments.labelFor(e.department) : ''}`.toLowerCase();
    const statusOk = !status
      || (status === 'active' && e.active)
      || (status === 'inactive' && !e.active)
      || (status === 'mismatch' && e.isAccountActive !== e.active);
    const match = statusOk && (!q || text.includes(q));
    row.hidden = !match;
    if (match) shown += 1;
  });
  const meta = $('#roster-count');
  if (meta) meta.textContent = shown === rosterCache.length ? `${rosterCache.length} ${plural(rosterCache.length, 'employee', 'employees')}` : `${shown} of ${rosterCache.length} shown`;
  const empty = $('#roster-filter-empty');
  if (empty) empty.hidden = shown > 0 || rosterCache.length === 0;
}

async function toggleActive(id, active) {
  confirmingDeactivateId = null;
  try {
    await apiFetch(`/api/employees/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' });
    toast(active ? 'Reactivated' : 'Deactivated', 'info');
    await renderRoster();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function renderRosterTable() {
  const [res] = await Promise.all([apiFetch('/api/employees'), window.Departments.load(apiFetch), loadClickupMembers()]);
  rosterCache = res.employees || [];
  directoryCache = rosterCache.map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName }));

  const rows = rosterCache.map((e) => `
    <tr id="roster-row-${e.id}" class="${e.active ? '' : 'is-inactive'}">
      <td class="roster-name-cell">
        <div class="roster-name">
          <span class="people-avatar people-avatar-sm">${window.AccountMenu.avatarHtml(e.photoUrl, e)}</span>
          <div class="list-main">
            <div class="list-title">${escapeHtml(fullName(e))}${e.isAccountActive !== e.active ? ' <span class="badge badge-pending" title="Login access and employment status disagree">Login mismatch</span>' : ''}</div>
            <div class="list-meta">${escapeHtml(e.email || '')}</div>
          </div>
        </div>
      </td>
      <td>
        <select class="form-control edit-job-title small" style="min-width:110px;" data-roster-field-change data-employee-id="${e.id}" data-field="jobTitle">
          <option value="">—</option>
          ${jobTitleOptionsHtml(e.jobTitle)}
        </select>
      </td>
      <td>
        <select class="form-control edit-department small" style="min-width:150px;" data-roster-field-change data-employee-id="${e.id}" data-field="department">
          <option value="">—</option>
          ${departmentOptionsHtml(e.department)}
        </select>
      </td>
      <td>
        <select class="form-control edit-kpi-profile small" style="min-width:120px;" data-roster-field-change data-employee-id="${e.id}" data-field="kpiProfile">
          <option value="">—</option>
          ${KPI_PROFILES.map((p) => `<option value="${p}" ${e.kpiProfile === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="form-control edit-employment-type small" style="min-width:110px;" data-roster-field-change data-employee-id="${e.id}" data-field="employmentType">
          <option value="">—</option>
          ${EMPLOYMENT_TYPES.map((t) => `<option value="${t}" ${e.employmentType === t ? 'selected' : ''}>${EMPLOYMENT_TYPE_LABELS[t]}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" class="form-control edit-joining-date small" value="${escapeHtml(e.joiningDate || '')}" style="min-width:130px;" data-roster-field-change data-employee-id="${e.id}" data-field="joiningDate"></td>
      <td>
        <select class="form-control edit-work-location small" style="min-width:120px;" data-roster-field-change data-employee-id="${e.id}" data-field="workLocation">
          <option value="">—</option>
          ${WORK_LOCATIONS.map((l) => `<option value="${l}" ${e.workLocation === l ? 'selected' : ''}>${escapeHtml(WORK_LOCATION_LABELS[l])}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="form-control edit-manager small" style="min-width:130px;" data-roster-field-change data-employee-id="${e.id}" data-field="managerEmployeeId">
          <option value="">— None —</option>
          ${managerOptions(e.id)}
        </select>
      </td>
      <td>
        <select class="form-control edit-clickup-id small" style="min-width:170px;" data-roster-field-change data-employee-id="${e.id}" data-field="clickupUserId">
          <option value="">— Unlinked —</option>
          ${clickupMemberOptionsHtml(e.clickupUserId)}
        </select>
      </td>
      <td style="text-align:center;">${e.authRole === 'people_culture' ? '<span class="badge badge-approved">P&amp;C</span>' : ''}</td>
      <td style="text-align:center;">
        ${canAssignTeamHead()
          ? `<input type="checkbox" class="edit-team-head" ${e.isTeamHead ? 'checked' : ''} title="Team Head" data-roster-field-change data-employee-id="${e.id}" data-field="isTeamHead">`
          : (e.isTeamHead ? '<span class="badge badge-approved">Team Head</span>' : '')}
      </td>
      <td class="roster-status-cell">${statusCellHtml(e)}</td>
    </tr>`).join('');

  $('#roster-table-body').innerHTML = rows || '<tr><td colspan="12"><div class="list-empty">No employees in the roster yet.</div></td></tr>';

  // Pre-select each row's manager dropdown now that options exist.
  rosterCache.forEach((e) => {
    const sel = document.querySelector(`#roster-row-${e.id} .edit-manager`);
    if (sel && e.managerEmployeeId) sel.value = String(e.managerEmployeeId);
  });
  applyRosterFilters();
}

async function renderCreateForm() {
  const users = await loadCandidateUsers();
  const managerOpts = managerOptions(null);
  $('#roster-create-panel').innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label" for="${users.length ? 'roster-user-select' : 'roster-user-manual'}">Account *</label>
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
      <div class="form-group full"><div style="display:flex; gap:8px;"><button class="btn primary" id="roster-create-btn">Add to roster</button><button class="btn" data-roster-action="close-create">Cancel</button></div></div>
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

let editingDepartmentId = null;
let expandedDepartmentId = null;

function toggleDepartmentExpand(id) {
  expandedDepartmentId = expandedDepartmentId === id ? null : id;
  renderDepartmentsSection();
}

function askEditDepartment(id) {
  editingDepartmentId = id;
  renderDepartmentsSection();
}

function cancelEditDepartment() {
  editingDepartmentId = null;
  renderDepartmentsSection();
}

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

function deptMemberRowHtml(e) {
  return `<li class="list-row">
    <div class="list-main"><div class="list-title" style="font-weight:500;">${escapeHtml(fullName(e))}${e.active ? '' : ' <span class="badge badge-neutral">Inactive</span>'}</div>
    <div class="list-meta">${escapeHtml(e.jobTitle || 'No job title')}</div></div>
  </li>`;
}

function renderDepartmentsSection() {
  const departments = window.Departments.list();
  $('#departments-list').innerHTML = departments.length
    ? `<ul class="list admin-list">${departments.map((d) => {
        const isExpanded = expandedDepartmentId === d.id;
        const members = rosterCache.filter((e) => e.department === d.code);
        if (editingDepartmentId === d.id) {
          return `<li class="admin-row">
            <div class="admin-row-edit">
              <input class="form-control" id="dept-edit-input-${d.id}" value="${escapeHtml(d.label)}" aria-label="Department name">
              <button class="btn small primary" data-dept-action="save-edit" data-dept-id="${d.id}">Save</button>
              <button class="btn small" data-dept-action="cancel-edit">Cancel</button>
            </div>
          </li>`;
        }
        return `<li class="admin-row">
          <div class="admin-row-top">
            <button class="admin-row-toggle" data-dept-action="toggle-expand" data-dept-id="${d.id}" aria-expanded="${isExpanded}">
              <span class="admin-row-chev" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
              <span class="list-title">${escapeHtml(d.label)}</span>
              ${d.active ? '' : '<span class="badge badge-neutral">Inactive</span>'}
              <span class="list-meta">${members.length} ${plural(members.length, 'person', 'people')}</span>
            </button>
            <button class="btn small" data-dept-action="ask-edit" data-dept-id="${d.id}">Rename</button>
          </div>
          ${isExpanded ? (members.length
            ? `<ul class="list admin-row-members">${members.map(deptMemberRowHtml).join('')}</ul>`
            : '<div class="list-empty admin-row-members">Nobody in this department.</div>') : ''}
        </li>`;
      }).join('')}</ul>`
    : '<div class="list-empty">No departments yet.</div>';

  $('#departments-form').innerHTML = `
    <div class="admin-add">
      <input class="form-control" id="dept-add-input" placeholder="New department name (e.g. AI &amp; Innovation)" aria-label="New department name">
      <button class="btn small" id="dept-add-btn">Add department</button>
    </div>`;
  $('#dept-add-btn').addEventListener('click', addDepartment);
}

/* ── Conflict pairs — admin/people_culture only (see canManageConflictPairs
   above; deliberately narrower than the rest of this page) can add one,
   edit which two employees it covers in place, or delete it outright.
   Delete is a real removal (not a revoke/deactivate) — see
   conflictPairRepository.remove's own comment on why that's safe for this
   table specifically. */
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

let editingConflictPairId = null;
let confirmingDeleteConflictPairId = null;

function askEditConflictPair(id) {
  editingConflictPairId = id;
  confirmingDeleteConflictPairId = null;
  renderConflictPairs();
}

function cancelEditConflictPair() {
  editingConflictPairId = null;
  renderConflictPairs();
}

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

function askDeleteConflictPair(id) {
  confirmingDeleteConflictPairId = id;
  editingConflictPairId = null;
  renderConflictPairs();
}

function cancelDeleteConflictPair() {
  confirmingDeleteConflictPairId = null;
  renderConflictPairs();
}

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

function conflictPairRowHtml(p) {
  if (editingConflictPairId === p.id) {
    return `<li class="admin-row"><div class="admin-row-edit">
      <select class="form-control" id="cp-edit-a-${p.id}" aria-label="First employee">${employeeOptionsHtml(p.employeeIdA)}</select>
      <select class="form-control" id="cp-edit-b-${p.id}" aria-label="Second employee">${employeeOptionsHtml(p.employeeIdB)}</select>
      <button class="btn small primary" data-cp-action="save-edit" data-cp-id="${p.id}">Save</button>
      <button class="btn small" data-cp-action="cancel-edit">Cancel</button>
    </div></li>`;
  }
  const names = `${escapeHtml(directoryName(p.employeeIdA))} <span class="muted">↔</span> ${escapeHtml(directoryName(p.employeeIdB))}`;
  if (confirmingDeleteConflictPairId === p.id) {
    return `<li class="admin-row"><div class="admin-row-top">
      <span class="small">Delete ${names}?</span>
      <span class="admin-row-actions">
        <button class="btn small danger" data-cp-action="delete" data-cp-id="${p.id}">Yes, delete</button>
        <button class="btn small" data-cp-action="cancel-delete">No</button>
      </span>
    </div></li>`;
  }
  return `<li class="admin-row"><div class="admin-row-top">
    <span class="list-title" style="font-weight:500;">${names}</span>
    <span class="admin-row-actions">
      <button class="btn small" data-cp-action="ask-edit" data-cp-id="${p.id}">Edit</button>
      <button class="btn small" data-cp-action="ask-delete" data-cp-id="${p.id}">Delete</button>
    </span>
  </div></li>`;
}

async function renderConflictPairs() {
  let pairs;
  try {
    pairs = await loadConflictPairs();
  } catch (err) {
    $('#conflict-pairs-list').innerHTML = `<div class="list-empty">Conflict pairs couldn’t load: ${escapeHtml(err.message)}</div>`;
    return;
  }
  $('#conflict-pairs-list').innerHTML = pairs.length
    ? `<ul class="list admin-list">${pairs.map(conflictPairRowHtml).join('')}</ul>`
    : '<div class="list-empty">No conflict pairs recorded.</div>';

  $('#conflict-pairs-form').innerHTML = `
    <div class="admin-add">
      <select class="form-control" id="cp-a" aria-label="First employee"><option value="">Employee A</option>${managerOptions(null)}</select>
      <select class="form-control" id="cp-b" aria-label="Second employee"><option value="">Employee B</option>${managerOptions(null)}</select>
      <button class="btn small" id="cp-add-btn">Add pair</button>
    </div>`;
  $('#cp-add-btn').addEventListener('click', addConflictPair);
}

// Delegated on #roster-content — covers all three sections (roster table
// field-changes/toggle-active, departments, conflict pairs). Guarded
// against double-binding since renderRoster() re-runs on this same
// persisting element after several actions (toggleActive, addDepartment,
// saveEditDepartment, submitCreate all call it again), even though the
// three sub-sections also have their own standalone re-render paths
// (renderDepartmentsSection/renderConflictPairs/renderRosterTable) that
// don't recreate #roster-content itself — delegation survives those
// automatically, only the container-level rebind needs guarding.
//
// Ordering matters here, not stopPropagation: dept-member cards nest
// inside an expanded department card, and edit-mode buttons nest inside
// the same card that (when not editing) has its own toggle-expand handler
// — checking the most-specific selector first and returning early gets the
// same effect the original onclick="event.stopPropagation()" calls did,
// without needing to actually stop propagation.
//
// Replaces onclick=".../onchange="..." attributes, which the CSP's
// script-src-attr 'none' silently blocks (confirmed live, 2026-09-28, on
// the sibling Overview-page/Team-Reviews bugs — same root cause).
function bindRosterUi(container) {
  if (container._rosterBound) return;
  container._rosterBound = true;

  container.addEventListener('change', (e) => {
    const el = e.target.closest('[data-roster-field-change]');
    if (!el) return;
    rosterFieldChanged(Number(el.dataset.employeeId), el.dataset.field, el);
  });

  container.addEventListener('click', (e) => {
    const deptBtn = e.target.closest('[data-dept-action]');
    if (deptBtn) {
      const deptId = Number(deptBtn.dataset.deptId);
      const action = deptBtn.dataset.deptAction;
      if (action === 'toggle-expand') toggleDepartmentExpand(deptId);
      if (action === 'ask-edit') askEditDepartment(deptId);
      if (action === 'save-edit') saveEditDepartment(deptId);
      if (action === 'cancel-edit') cancelEditDepartment();
      return;
    }

    const cpBtn = e.target.closest('[data-cp-action]');
    if (cpBtn) {
      const cpId = Number(cpBtn.dataset.cpId);
      const action = cpBtn.dataset.cpAction;
      if (action === 'ask-edit') askEditConflictPair(cpId);
      if (action === 'save-edit') saveEditConflictPair(cpId);
      if (action === 'cancel-edit') cancelEditConflictPair();
      if (action === 'ask-delete') askDeleteConflictPair(cpId);
      if (action === 'delete') deleteConflictPair(cpId);
      if (action === 'cancel-delete') cancelDeleteConflictPair();
      return;
    }

    const rosterBtn = e.target.closest('[data-roster-action]');
    if (!rosterBtn) return;
    const action = rosterBtn.dataset.rosterAction;
    const id = Number(rosterBtn.dataset.employeeId);
    if (action === 'toggle-active') toggleActive(id, rosterBtn.dataset.newActive === 'true');
    if (action === 'ask-deactivate') { confirmingDeactivateId = id; setStatusCell(id); }
    if (action === 'cancel-deactivate') { confirmingDeactivateId = null; setStatusCell(id); }
    if (action === 'open-create') { $('#roster-create-wrap').hidden = false; rosterBtn.hidden = true; }
    if (action === 'close-create') { $('#roster-create-wrap').hidden = true; const open = container.querySelector('[data-roster-action="open-create"]'); if (open) open.hidden = false; }
  });

  container.addEventListener('input', (e) => {
    if (e.target.id === 'roster-search') applyRosterFilters();
  });
  container.addEventListener('change', (e) => {
    if (e.target.id === 'roster-status-filter') applyRosterFilters();
  });
}

function settingsBodyHtml() {
  const deptCol = colTitle('Departments', 'rename only changes the label') + '<div id="departments-list"></div><div id="departments-form"></div>';
  if (!canManageConflictPairs()) return `<div class="panel-body">${deptCol}</div>`;
  return split([
    { html: deptCol },
    { html: colTitle('Team conflict pairs', 'warn-only, not enforced') + '<div id="conflict-pairs-list"></div><div id="conflict-pairs-form"></div>' },
  ]);
}

export async function renderRoster() {
  const container = $('#roster-content');
  confirmingDeactivateId = null;
  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Employee Roster</div>
      <div class="page-subtitle">Every employee record. Changes save as soon as you change a field.</div>
    </div>
    <div class="stack">
      ${panel({
        title: 'Employees',
        meta: '<span id="roster-count"></span>',
        actions: `<input type="search" class="form-control dir-search" id="roster-search" placeholder="Search name, email, title…" aria-label="Search employees">
          <select class="form-control roster-filter" id="roster-status-filter" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="mismatch">Login mismatch</option>
          </select>
          <button class="small" data-roster-action="open-create">Add employee</button>`,
        body: `<div class="roster-create" id="roster-create-wrap" hidden>
            ${colTitle('Add an employee', 'creates their employee record for an existing account')}
            <div id="roster-create-panel"><div class="list-empty">Loading…</div></div>
          </div>
          <div class="table-scroll roster-table-wrap">
            <table class="data-table roster-table">
              <thead><tr><th class="roster-name-cell">Name</th><th>Job title</th><th>Department</th><th>KPI profile</th><th>Employment type</th><th>Joining date</th><th>Work location</th><th>Manager</th><th>ClickUp user</th><th>P&amp;C</th><th>Team head</th><th>Status</th></tr></thead>
              <tbody id="roster-table-body"><tr><td colspan="12"><div class="list-empty">Loading…</div></td></tr></tbody>
            </table>
          </div>
          <div class="list-empty" id="roster-filter-empty" hidden style="padding:12px 18px;">No employees match these filters.</div>`,
      })}
      ${panel({ title: 'Organization settings', body: settingsBodyHtml() })}
    </div>
  `;
  bindRosterUi(container);
  try {
    await renderRosterTable();
  } catch (err) {
    console.error('Roster failed to load', err);
    container.innerHTML = loadErrorPanel('The roster couldn’t load', err, 'data-roster-retry');
    container.querySelector('[data-roster-retry]').addEventListener('click', renderRoster);
    return;
  }
  renderDepartmentsSection();
  await renderCreateForm();
  if (canManageConflictPairs()) await renderConflictPairs();
}
