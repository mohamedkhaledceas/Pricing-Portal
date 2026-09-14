/* Single account-menu implementation shared by every frontend surface
   (Employees, CEO Dashboard, Commercial Lead, Margin Planner). Loaded as a
   plain classic script (not an ES module) specifically so it can be used
   both by the three ES-module pages (a `type="module"` script can freely
   call a global) and by Margin Planner's legacy inline classic <script>,
   with no format conversion needed on either side.

   Each page keeps its own dom.js/state.js/apiClient.js/theme.js — this
   module takes small injected functions instead of importing any of them,
   so it doesn't need to pick one page's copy over another's. */
(function () {
  const ICON_MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const ICON_SYSTEM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  const ICON_SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initials(user) {
    const f = (user && user.firstName ? user.firstName.trim()[0] : '') || '';
    const l = (user && user.lastName ? user.lastName.trim()[0] : '') || '';
    return (f + l).toUpperCase() || '?';
  }

  function initialsHtml(user) {
    return `<span class="account-avatar-initials">${escapeHtml(initials(user))}</span>`;
  }

  function avatarHtml(photoUrl, user) {
    if (photoUrl) {
      // onerror falls back to initials if the file is missing (e.g. a
      // photo_url left over from before uploads moved onto the persistent
      // disk) — otherwise a dead reference renders as a broken-image icon
      // forever instead of degrading gracefully.
      return `<img src="${escapeHtml(photoUrl)}" alt="" class="account-avatar-img" data-fallback="${escapeHtml(initialsHtml(user))}" onerror="this.outerHTML=this.dataset.fallback">`;
    }
    return initialsHtml(user);
  }

  let state = { photoUrl: null, opts: null, containerEl: null };

  function menuHtml(opts) {
    return `
      <button type="button" id="btnAccountMenu" class="ghost account-avatar-btn" aria-haspopup="true" aria-expanded="false" title="Account menu">
        ${avatarHtml(state.photoUrl, opts.currentUser)}
      </button>
      <div id="accountMenu" hidden role="menu" class="account-menu-dropdown">
        <div id="accountMenuEmail" class="account-menu-email">${escapeHtml((opts.currentUser && opts.currentUser.email) || '')}</div>
        <button type="button" id="btnAccountSettings" role="menuitem" class="ghost account-menu-item">Account Settings</button>
        <button type="button" id="btnTeamsView" role="menuitem" class="ghost account-menu-item">Teams</button>
        <div class="account-menu-appearance">
          <div class="account-menu-appearance-label">Appearance</div>
          <div class="theme-seg" role="group" aria-label="Appearance">
            <button type="button" class="theme-seg-btn" data-theme-value="dark" aria-label="Dark" title="Dark">${ICON_MOON}</button>
            <button type="button" class="theme-seg-btn" data-theme-value="system" aria-label="System" title="System">${ICON_SYSTEM}</button>
            <button type="button" class="theme-seg-btn" data-theme-value="light" aria-label="Light" title="Light">${ICON_SUN}</button>
          </div>
        </div>
        ${opts.canManageUsers ? `<button type="button" id="btnUsersView" role="menuitem" class="ghost account-menu-item">Users</button>` : ''}
        <div class="account-menu-divider"></div>
        <button type="button" id="btnLogout" role="menuitem" class="ghost account-menu-item account-menu-item-danger">Log out</button>
      </div>
    `;
  }

  function closeMenu() {
    const dropdown = document.getElementById('accountMenu');
    const btn = document.getElementById('btnAccountMenu');
    if (dropdown) dropdown.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  async function fetchMyPhoto(opts) {
    try {
      const res = await opts.apiFetch('/api/employees/me');
      return res && res.employee ? res.employee.photoUrl : null;
    } catch (err) {
      return null;
    }
  }

  function render() {
    const opts = state.opts;
    if (!opts || !state.containerEl) return;
    state.containerEl.innerHTML = menuHtml(opts);
    if (opts.updateAppearanceControls) opts.updateAppearanceControls();
    bindHandlers(opts);
  }

  function bindHandlers(opts) {
    const btn = document.getElementById('btnAccountMenu');
    const dropdown = document.getElementById('accountMenu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
      btn.setAttribute('aria-expanded', String(!dropdown.hidden));
    });
    document.querySelectorAll('.theme-seg-btn').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.setTheme(seg.dataset.themeValue);
        if (opts.updateAppearanceControls) opts.updateAppearanceControls();
        if (opts.onThemeChange) opts.onThemeChange();
      });
    });
    document.getElementById('btnAccountSettings').addEventListener('click', () => {
      closeMenu();
      if (window.AccountMenu.openSettings) window.AccountMenu.openSettings(opts);
    });
    document.getElementById('btnTeamsView').addEventListener('click', () => {
      closeMenu();
      if (window.AccountMenu.openTeams) window.AccountMenu.openTeams(opts);
    });
    const usersBtn = document.getElementById('btnUsersView');
    if (usersBtn) {
      usersBtn.addEventListener('click', () => {
        closeMenu();
        if (opts.onUsersClick) opts.onUsersClick();
        else window.location.href = '/?open=users';
      });
    }
    document.getElementById('btnLogout').addEventListener('click', () => {
      closeMenu();
      opts.onLogout();
    });
  }

  // One document-level listener total, bound once in mount() — not one per
  // render() — since render() can re-run (e.g. after Account Settings
  // changes canManageUsers-irrelevant fields) without re-registering.
  let documentListenersBound = false;
  function bindDocumentListenersOnce() {
    if (documentListenersBound) return;
    documentListenersBound = true;
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  }

  // Synchronous — renders immediately with initials (or a cached photo, if
  // this is a re-mount) so the header never blocks on a network round trip;
  // the real photo swaps in a moment later via refresh() below.
  function mount(containerEl, opts) {
    if (!containerEl) return;
    state.containerEl = containerEl;
    state.opts = opts;
    containerEl.style.position = 'relative';
    render();
    bindDocumentListenersOnce();
    refresh();
  }

  // Re-fetches photoUrl and re-renders — called once right after mount(),
  // and again by accountSettings.js after an upload/remove so every open
  // menu (there's only ever one per page, but this stays correct if that
  // ever changes) picks up the new avatar immediately.
  async function refresh() {
    if (!state.opts) return;
    state.photoUrl = await fetchMyPhoto(state.opts);
    render();
  }

  window.AccountMenu = window.AccountMenu || {};
  window.AccountMenu.mount = mount;
  window.AccountMenu.refresh = refresh;
  window.AccountMenu.escapeHtml = escapeHtml;
  window.AccountMenu.avatarHtml = avatarHtml;
})();
