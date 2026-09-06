import { $, escapeHtml, toast } from './dom.js';
import { apiFetch } from './apiClient.js';
import { state } from './state.js';

const KPI_PROFILES = ['content', 'artdirector', 'aidesigner', 'production', 'am', 'pandc', 'heads', 'design'];
// Fixed-value lists live in window.OrgConstants (shared/orgConstants.js) —
// single source of truth also used by the signup wizard and Account
// Settings' Work Details section. Server-side enforcement is the real
// gate (rosterService.validateFixedFields); this is display/dropdown-
// population only.
const { DEPARTMENTS, DEPARTMENT_LABELS, WORK_LOCATIONS, WORK_LOCATION_LABELS, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } = window.OrgConstants;
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

// Deliberately not apiFetch — it hardcodes a JSON Content-Type header,
// which breaks multipart uploads (the browser needs to set its own
// Content-Type with the multipart boundary for FormData bodies).
async function uploadPhoto(id, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('photo', file);
  try {
    const res = await fetch(`/api/employees/${id}/photo`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + state.accessToken },
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Upload failed');
    }
    toast('Photo updated', 'info');
    await renderRoster();
  } catch (err) {
    toast(err.message, 'danger');
  } finally {
    input.value = '';
  }
}
window.rosterUploadPhoto = uploadPhoto;

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
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:28px; height:28px; border-radius:50%; overflow:hidden; flex-shrink:0;">${window.AccountMenu.avatarHtml(e.photoUrl, e)}</div>
          <div>
            ${escapeHtml(e.firstName + ' ' + e.lastName)}<div class="small muted">${escapeHtml(e.email)}</div>
            <label class="small muted" style="cursor:pointer;">
              Change photo
              <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none;" onchange="rosterUploadPhoto(${e.id}, this)">
            </label>
          </div>
        </div>
      </td>
      <td><input class="form-control edit-job-title small" value="${escapeHtml(e.jobTitle || '')}" style="min-width:110px;" onchange="rosterFieldChanged(${e.id}, 'jobTitle', this)"></td>
      <td>
        <select class="form-control edit-department small" style="min-width:150px;" onchange="rosterFieldChanged(${e.id}, 'department', this)">
          <option value="">—</option>
          ${DEPARTMENTS.map((d) => `<option value="${d}" ${e.department === d ? 'selected' : ''}>${escapeHtml(DEPARTMENT_LABELS[d])}</option>`).join('')}
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
      <td><input class="form-control edit-working-hours small" value="${escapeHtml(e.workingHours || '')}" style="min-width:130px;" placeholder="e.g. 10:00 AM – 6:00 PM" onchange="rosterFieldChanged(${e.id}, 'workingHours', this)"></td>
      <td><input class="form-control edit-work-schedule small" value="${escapeHtml(e.workSchedule || '')}" style="min-width:110px;" placeholder="e.g. Sun – Thu" onchange="rosterFieldChanged(${e.id}, 'workSchedule', this)"></td>
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
          ${DEPARTMENTS.map((d) => `<option value="${d}">${escapeHtml(DEPARTMENT_LABELS[d])}</option>`).join('')}
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
          <thead><tr><th>Name</th><th>Job Title</th><th>Department</th><th>KPI Profile</th><th>Employment Type</th><th>Joining Date</th><th>Work Location</th><th>Working Hours</th><th>Work Schedule</th><th>Manager</th><th>P&amp;C</th><th>Team Head</th><th>Status</th><th>Active</th><th></th></tr></thead>
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
  await renderCreateForm();
  await renderConflictPairs();
}
