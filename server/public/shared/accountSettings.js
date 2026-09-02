/* Account Settings modal, shared by every frontend surface — see
   accountMenu.js's top comment for why this is a classic script and not
   an ES module. Loaded after accountMenu.js (extends window.AccountMenu
   rather than replacing it).

   A modal, not a page/view, deliberately: it's the only shape that works
   identically dropped into all 4 pages without hooking into each page's
   own (different) tab/view-routing system. Replaces Margin Planner's old
   in-page #accountSettingsView, which is being deleted. */
(function () {
  const escapeHtml = window.AccountMenu.escapeHtml;
  const avatarHtml = window.AccountMenu.avatarHtml;

  const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function closeModal() {
    const overlay = document.getElementById('accountSettingsOverlay');
    if (overlay) overlay.remove();
  }

  function fieldError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  // Raw fetch, not opts.apiFetch — apiFetch hardcodes a JSON Content-Type
  // header, which breaks multipart bodies (the browser has to set its own
  // Content-Type with the multipart boundary for FormData). Same reasoning
  // as roster.js's admin-side photo upload.
  async function rawFetch(opts, path, options) {
    const res = await fetch(path, {
      ...options,
      headers: { Authorization: 'Bearer ' + opts.getAccessToken(), ...(options && options.headers) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || 'Request failed.');
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function loadMyEmployee(opts) {
    try {
      const res = await opts.apiFetch('/api/employees/me');
      return { employee: res.employee || null, pendingChangeRequest: res.pendingChangeRequest || null };
    } catch (err) {
      return { employee: null, pendingChangeRequest: null };
    }
  }

  // Only fetched when the employee actually has a manager — directory is a
  // full company list, so this is a mild over-fetch for just one name, but
  // reuses the existing authenticated /directory endpoint rather than
  // adding a new one just for this lookup.
  async function loadManagerName(opts, managerEmployeeId) {
    if (!managerEmployeeId) return null;
    try {
      const res = await opts.apiFetch('/api/employees/directory');
      const manager = (res.employees || []).find((e) => e.id === managerEmployeeId);
      return manager ? `${manager.firstName} ${manager.lastName}` : null;
    } catch (err) {
      return null;
    }
  }

  function renderPhotoSection(employee) {
    if (!employee) {
      return `
        <p class="account-modal-hint">
          You're not on the employee roster yet, so there's no profile photo to set.
          Ask People &amp; Culture to add you, then come back here.
        </p>`;
    }
    return `
      <div class="account-photo-row">
        <div id="acctPhotoPreview">${avatarHtml(employee.photoUrl, opts_currentUserRef)}</div>
        <div class="account-photo-actions">
          <label class="btn small account-photo-upload-label">
            Upload photo
            <input type="file" id="acctPhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none;">
          </label>
          <button type="button" class="btn small account-btn-danger" id="acctPhotoRemove" ${employee.photoUrl ? '' : 'disabled'}>Remove photo</button>
        </div>
      </div>
      <div id="acctPhotoError" class="account-field-error" role="alert" hidden></div>`;
  }

  // Set by openSettings() before renderPhotoSection() runs, so the preview
  // can compute initials from the same currentUser object mount() uses —
  // avoids needing a second copy of the initials logic here.
  let opts_currentUserRef = null;

  function bindPhotoHandlers(opts, employee) {
    if (!employee) return;
    const input = document.getElementById('acctPhotoInput');
    const removeBtn = document.getElementById('acctPhotoRemove');

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      fieldError('acctPhotoError', '');
      if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        fieldError('acctPhotoError', 'Only JPEG, PNG, or WebP images are allowed.');
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        fieldError('acctPhotoError', 'Photo must be 2MB or smaller.');
        return;
      }
      const formData = new FormData();
      formData.append('photo', file);
      try {
        const result = await rawFetch(opts, '/api/employees/me/photo', { method: 'POST', body: formData });
        document.getElementById('acctPhotoPreview').innerHTML = avatarHtml(result.employee.photoUrl, opts.currentUser);
        removeBtn.disabled = !result.employee.photoUrl;
        window.AccountMenu.refresh();
      } catch (err) {
        fieldError('acctPhotoError', err.message);
      }
    });

    removeBtn.addEventListener('click', async () => {
      fieldError('acctPhotoError', '');
      try {
        const result = await rawFetch(opts, '/api/employees/me/photo', { method: 'DELETE' });
        document.getElementById('acctPhotoPreview').innerHTML = avatarHtml(null, opts.currentUser);
        removeBtn.disabled = true;
        window.AccountMenu.refresh();
      } catch (err) {
        fieldError('acctPhotoError', err.message);
      }
    });
  }

  function bindInfoForm(opts) {
    const form = document.getElementById('acctInfoForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fieldError('acctInfoError', '');
      fieldError('acctInfoSuccess', '');
      const firstName = document.getElementById('acctFirstName').value.trim();
      const lastName = document.getElementById('acctLastName').value.trim();
      if (!firstName || !lastName) {
        fieldError('acctInfoError', 'Please fill in both first and last name.');
        return;
      }
      try {
        const result = await opts.apiFetch('/api/me/profile', { method: 'PATCH', body: JSON.stringify({ firstName, lastName }) });
        Object.assign(opts.currentUser, result.user);
        document.getElementById('accountSettingsEmail').textContent = result.user.email || '';
        document.getElementById('acctInfoSuccess').hidden = false;
        document.getElementById('acctInfoSuccess').textContent = 'Saved.';
        window.AccountMenu.refresh();
      } catch (err) {
        fieldError('acctInfoError', err.message);
      }
    });
  }

  function bindPasswordForm(opts) {
    const form = document.getElementById('acctPasswordForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fieldError('acctPasswordError', '');
      fieldError('acctPasswordSuccess', '');
      const currentPassword = document.getElementById('acctCurrentPassword').value;
      const newPassword = document.getElementById('acctNewPassword').value;
      const newPasswordConfirm = document.getElementById('acctNewPasswordConfirm').value;
      if (!currentPassword || !newPassword || !newPasswordConfirm) {
        fieldError('acctPasswordError', 'Please fill in every field.');
        return;
      }
      if (newPassword.length < 8) {
        fieldError('acctPasswordError', 'New password must be at least 8 characters long.');
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        fieldError('acctPasswordError', 'New passwords do not match.');
        return;
      }
      try {
        await opts.apiFetch('/api/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
        form.reset();
        document.getElementById('acctPasswordSuccess').hidden = false;
        document.getElementById('acctPasswordSuccess').textContent = 'Password changed.';
      } catch (err) {
        fieldError('acctPasswordError', err.message);
      }
    });
  }

  const WORK_DETAIL_FIELD_IDS = {
    jobTitle: 'acctJobTitle',
    department: 'acctDepartment',
    employmentType: 'acctEmploymentType',
    joiningDate: 'acctJoiningDate',
    workLocation: 'acctWorkLocation',
    workingHours: 'acctWorkingHours',
    workSchedule: 'acctWorkSchedule',
  };

  function renderWorkDetailsSection(employee, pendingChangeRequest, managerName) {
    if (!employee) {
      return `
        <p class="account-modal-hint">
          You're not on the employee roster yet, so there are no work details to set.
          Ask People &amp; Culture to add you, then come back here.
        </p>`;
    }
    const oc = window.OrgConstants;
    const statusLabel = employee.status === 'on_leave' ? 'On Leave' : (employee.status === 'remote' ? 'Remote' : 'Active');
    const managerText = employee.managerEmployeeId ? escapeHtml(managerName || `Employee #${employee.managerEmployeeId}`) : 'No manager assigned yet';

    if (pendingChangeRequest) {
      const diffHtml = Object.keys(pendingChangeRequest.changes)
        .map((field) => `<li>${escapeHtml(WORK_DETAIL_FIELD_IDS[field] ? field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) : field)}</li>`)
        .join('');
      return `
        <p class="account-modal-hint">
          A change you submitted is awaiting approval from your manager, admin, or People &amp; Culture —
          you can't submit another until it's decided.
        </p>
        <ul class="account-pending-changes">${diffHtml}</ul>`;
    }

    return `
      <form id="acctWorkDetailsForm">
        <div class="account-form-row">
          <div class="account-field"><label>Job title</label><input id="acctJobTitle" value="${escapeHtml(employee.jobTitle || '')}" required></div>
          <div class="account-field">
            <label>Department</label>
            <select id="acctDepartment" required>
              <option value="">— Select —</option>
              ${oc.DEPARTMENTS.map((d) => `<option value="${d}" ${employee.department === d ? 'selected' : ''}>${escapeHtml(oc.DEPARTMENT_LABELS[d])}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="account-form-row">
          <div class="account-field">
            <label>Employment type</label>
            <select id="acctEmploymentType" required>
              <option value="">— Select —</option>
              ${oc.EMPLOYMENT_TYPES.map((t) => `<option value="${t}" ${employee.employmentType === t ? 'selected' : ''}>${escapeHtml(oc.EMPLOYMENT_TYPE_LABELS[t])}</option>`).join('')}
            </select>
          </div>
          <div class="account-field"><label>Joining date</label><input id="acctJoiningDate" type="date" value="${escapeHtml(employee.joiningDate || '')}" required></div>
        </div>
        <div class="account-form-row">
          <div class="account-field">
            <label>Work location</label>
            <select id="acctWorkLocation" required>
              <option value="">— Select —</option>
              ${oc.WORK_LOCATIONS.map((l) => `<option value="${l}" ${employee.workLocation === l ? 'selected' : ''}>${escapeHtml(oc.WORK_LOCATION_LABELS[l])}</option>`).join('')}
            </select>
          </div>
          <div class="account-field"><label>Working hours</label><input id="acctWorkingHours" placeholder="e.g. 10:00 AM – 6:00 PM" value="${escapeHtml(employee.workingHours || '')}" required></div>
        </div>
        <div class="account-form-row">
          <div class="account-field"><label>Work schedule</label><input id="acctWorkSchedule" placeholder="e.g. Sun – Thu" value="${escapeHtml(employee.workSchedule || '')}" required></div>
          <div class="account-field"><label>Manager</label><div class="account-readonly">${managerText}</div></div>
        </div>
        <div class="account-form-row">
          <div class="account-field">
            <label>Status</label>
            <div class="account-readonly">${escapeHtml(statusLabel)}${employee.isTeamHead ? ' <span class="badge badge-approved">Team Head</span>' : ''}</div>
          </div>
        </div>
        ${employee.profileLocked ? `<p class="account-modal-hint">Further changes to these fields require approval from your manager, admin, or People &amp; Culture.</p>` : ''}
        <div id="acctWorkDetailsError" class="account-field-error" role="alert" hidden></div>
        <div id="acctWorkDetailsSuccess" class="account-field-success" role="status" hidden></div>
        <button type="submit" class="btn small account-btn-primary">Save</button>
      </form>`;
  }

  function bindWorkDetailsForm(opts, employee) {
    const form = document.getElementById('acctWorkDetailsForm');
    if (!form || !employee) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      fieldError('acctWorkDetailsError', '');
      fieldError('acctWorkDetailsSuccess', '');
      const payload = {};
      Object.keys(WORK_DETAIL_FIELD_IDS).forEach((field) => {
        payload[field] = document.getElementById(WORK_DETAIL_FIELD_IDS[field]).value;
      });
      try {
        const result = await opts.apiFetch('/api/employees/me', { method: 'PATCH', body: JSON.stringify(payload) });
        if (result.pending) {
          const employeeAgain = await loadMyEmployee(opts);
          const managerName = await loadManagerName(opts, employeeAgain.employee && employeeAgain.employee.managerEmployeeId);
          const section = document.getElementById('acctWorkDetailsSection');
          section.outerHTML = `<div id="acctWorkDetailsSection">${renderWorkDetailsSection(employeeAgain.employee, employeeAgain.pendingChangeRequest, managerName)}</div>`;
          return;
        }
        fieldError('acctWorkDetailsSuccess', 'Saved.');
        document.getElementById('acctWorkDetailsSuccess').hidden = false;
      } catch (err) {
        fieldError('acctWorkDetailsError', err.message);
      }
    });
  }

  async function openSettings(opts) {
    closeModal(); // in case one is somehow already open
    opts_currentUserRef = opts.currentUser;

    const overlay = document.createElement('div');
    overlay.id = 'accountSettingsOverlay';
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal" role="dialog" aria-modal="true" aria-label="Account Settings">
        <div class="account-modal-header">
          <div>
            <h2>Account Settings</h2>
            <div class="account-modal-sub" id="accountSettingsEmail">${escapeHtml((opts.currentUser && opts.currentUser.email) || '')}</div>
          </div>
          <button type="button" class="ghost" id="acctSettingsClose" aria-label="Close">&times;</button>
        </div>
        <div class="account-modal-body">
          <section class="account-modal-section">
            <h3>Profile photo</h3>
            <div id="acctPhotoSection" class="account-modal-loading">Loading…</div>
          </section>
          <section class="account-modal-section">
            <h3>Work details</h3>
            <div id="acctWorkDetailsSection" class="account-modal-loading">Loading…</div>
          </section>
          <section class="account-modal-section">
            <h3>Account info</h3>
            <form id="acctInfoForm">
              <div class="account-form-row">
                <div class="account-field"><label>First name</label><input id="acctFirstName" required></div>
                <div class="account-field"><label>Last name</label><input id="acctLastName" required></div>
              </div>
              <div id="acctInfoError" class="account-field-error" role="alert" hidden></div>
              <div id="acctInfoSuccess" class="account-field-success" role="status" hidden></div>
              <button type="submit" class="btn small account-btn-primary">Save</button>
            </form>
          </section>
          <section class="account-modal-section">
            <h3>Change password</h3>
            <form id="acctPasswordForm">
              <div class="account-form-row">
                <div class="account-field"><label>Current password</label><input id="acctCurrentPassword" type="password" autocomplete="current-password" required></div>
                <div class="account-field"><label>New password</label><input id="acctNewPassword" type="password" autocomplete="new-password" minlength="8" placeholder="at least 8 characters" required></div>
                <div class="account-field"><label>Confirm new password</label><input id="acctNewPasswordConfirm" type="password" autocomplete="new-password" required></div>
              </div>
              <div id="acctPasswordError" class="account-field-error" role="alert" hidden></div>
              <div id="acctPasswordSuccess" class="account-field-success" role="status" hidden></div>
              <button type="submit" class="btn small account-btn-primary">Save</button>
            </form>
          </section>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('acctSettingsClose').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key !== 'Escape') return;
      closeModal();
      document.removeEventListener('keydown', escHandler);
    });

    document.getElementById('acctFirstName').value = (opts.currentUser && opts.currentUser.firstName) || '';
    document.getElementById('acctLastName').value = (opts.currentUser && opts.currentUser.lastName) || '';
    bindInfoForm(opts);
    bindPasswordForm(opts);

    const { employee, pendingChangeRequest } = await loadMyEmployee(opts);
    const photoSection = document.getElementById('acctPhotoSection');
    if (photoSection) {
      photoSection.outerHTML = `<div id="acctPhotoSection">${renderPhotoSection(employee)}</div>`;
      bindPhotoHandlers(opts, employee);
    }

    const managerName = await loadManagerName(opts, employee && employee.managerEmployeeId);
    const workDetailsSection = document.getElementById('acctWorkDetailsSection');
    if (workDetailsSection) {
      workDetailsSection.outerHTML = `<div id="acctWorkDetailsSection">${renderWorkDetailsSection(employee, pendingChangeRequest, managerName)}</div>`;
      bindWorkDetailsForm(opts, employee);
    }
  }

  window.AccountMenu = window.AccountMenu || {};
  window.AccountMenu.openSettings = openSettings;
})();
