/* The account button at the bottom of the portal's shared sidebar
   (appShell.js) on every page: avatar, name and email; its menu opens
   upward with Account Settings and Log out. Appearance and Users live in
   the sidebar itself. Loaded as a plain classic script (window.AccountMenu)
   so ES-module pages and Margin Planner's classic scripts can both use it.

   Each page keeps its own apiClient — this takes small injected functions
   instead of importing any page's copy. */
(function () {
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

  function buttonHtml(opts) {
    const user = opts.currentUser || {};
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Account';
    return `<button type="button" id="btnAccountMenu" class="account-rail-btn" aria-haspopup="true" aria-expanded="false" title="Account">
        <span class="account-rail-avatar">${avatarHtml(state.photoUrl, user)}</span>
        <span class="account-rail-tx"><b>${escapeHtml(name)}</b><span>${escapeHtml(user.email || '')}</span></span>
      </button>`;
  }

  function menuHtml(opts) {
    return `
      ${buttonHtml(opts)}
      <div id="accountMenu" hidden role="menu" class="account-menu-dropdown">
        <div id="accountMenuEmail" class="account-menu-email">${escapeHtml((opts.currentUser && opts.currentUser.email) || '')}</div>
        <button type="button" id="btnAccountSettings" role="menuitem" class="ghost account-menu-item">Account Settings</button>
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
    document.getElementById('btnAccountSettings').addEventListener('click', () => {
      closeMenu();
      if (window.AccountMenu.openSettings) window.AccountMenu.openSettings(opts);
    });
    document.getElementById('btnLogout').addEventListener('click', () => {
      closeMenu();
      opts.onLogout();
    });
  }

  // One document-level listener total, bound once in mount() — not one per
  // render() — since render() can re-run (e.g. after Account Settings
  // changes the name or photo) without re-registering.
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
