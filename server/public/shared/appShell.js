/* The portal's shared shell: a left rail with the page's own sections, the
   other portal pages the user can open, Users (for user managers), search
   (⌘K / Ctrl+K), appearance and the account button at the bottom.
   Collapses to icons (remembered per browser); below 860px it's an
   off-canvas drawer behind a slim top bar.

   Classic script (window.AppShell), same convention as accountMenu.js, so
   ES-module pages and Margin Planner's classic scripts can both use it.

   The page links only mirror each page's existing role gate so nobody is
   offered a page that would refuse them — every page and API still
   enforces its own access server-side. */
(function () {
  const I = {
    home: '<path d="M3 9.5 10 4l7 5.5"/><path d="M5 9v7h10V9"/>',
    focus: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none"/>',
    money: '<circle cx="10" cy="10" r="7"/><path d="M10 6v8M8 8.2h3.4M8 11.8h3.4"/>',
    budget: '<path d="M3.5 5.5h13v9h-13z"/><path d="M3.5 8.5h13"/><path d="M6.5 11.5h3"/><path d="M13 11.5h1.2"/>',
    delivery: '<path d="M4 5.5h12v9H4z"/><path d="M4 9h12"/><path d="M8 12.2h4"/>',
    risks: '<path d="M10 3.5 17 16H3z"/><path d="M10 8.5v3M10 13.6v.1"/>',
    calendar: '<rect x="3.5" y="4.5" width="13" height="12" rx="1.5"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/>',
    inbox: '<path d="M3.5 11 5.5 4.5h9l2 6.5v4.5h-13z"/><path d="M3.5 11h4l1 2h3l1-2h4"/>',
    targets: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3"/><circle cx="10" cy="10" r=".9" fill="currentColor"/>',
    people: '<circle cx="10" cy="6.5" r="2.8"/><path d="M4 16c0-3 2.7-5 6-5s6 2 6 5"/>',
    clients: '<circle cx="7.5" cy="7" r="2.6"/><path d="M3 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><circle cx="14" cy="7.5" r="2"/><path d="M13 12.2c2 .2 4 1.3 4 3.8"/>',
    roster: '<path d="M4.5 3.5h11v13h-11z"/><path d="M7.5 7h5M7.5 10h5M7.5 13h3"/>',
    report: '<path d="M4 16V9M8.5 16V5M13 16v-5M17 16H3"/>',
    key: '<circle cx="7" cy="12" r="3"/><path d="M9.2 9.8 16 3M13.5 5.5l2 2"/>',
    gauge: '<path d="M3.5 14a6.5 6.5 0 1 1 13 0"/><path d="M10 14l3-4.5"/>',
    calc: '<rect x="4.5" y="3" width="11" height="14" rx="1.5"/><path d="M7 6.5h6M7.5 10h.1M10 10h.1M12.5 10h.1M7.5 13h.1M10 13h.1M12.5 13h.1"/>',
    growth: '<path d="M3.5 14.5 8 10l3 3 5.5-6"/><path d="M13 7h3.5v3.5"/>',
    link: '<path d="M8.5 11.5 11.5 8.5"/><path d="M9 6l1.5-1.5a3 3 0 0 1 4.2 4.2L13.2 10M11 14l-1.5 1.5a3 3 0 0 1-4.2-4.2L6.8 10"/>',
    receipt: '<path d="M5 3.5h10v13l-2-1.3-1.5 1.3-1.5-1.3-1.5 1.3L7 15.2l-2 1.3z"/><path d="M7.5 7h5M7.5 10h5"/>',
    layers: '<path d="M10 3.5 17 7l-7 3.5L3 7z"/><path d="M3 10.5 10 14l7-3.5"/>',
    doc: '<path d="M5 3.5h7l3 3v10H5z"/><path d="M12 3.5v3h3M7.5 10h5M7.5 13h5"/>',
    settings: '<circle cx="10" cy="10" r="2.6"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4"/>',
    list: '<path d="M7 6h9M7 10h9M7 14h9"/><path d="M4 6h.1M4 10h.1M4 14h.1"/>',
    clock: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
    search: '<circle cx="9" cy="9" r="5"/><path d="m16 16-3.4-3.4"/>',
    collapse: '<path d="M12.5 5 7.5 10l5 5"/>',
    expand: '<path d="M7.5 5 12.5 10l-5 5"/>',
    menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
    dark: '<path d="M15.5 12.3A6 6 0 0 1 7.7 4.5a6 6 0 1 0 7.8 7.8z"/>',
    system: '<rect x="3" y="4" width="14" height="9.5" rx="1.3"/><path d="M7.5 16.5h5M10 13.5v3"/>',
    light: '<circle cx="10" cy="10" r="3"/><path d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1"/>',
  };
  const ico = (n) => `<svg viewBox="0 0 20 20" aria-hidden="true">${I[n] || I.home}</svg>`;

  /* Every portal page, with the roles its own page gate lets in. */
  const PAGES = [
    { id: 'employees', href: '/', label: 'Employees', icon: 'people' },
    { id: 'ceo', href: '/ceo', label: 'Control Room', icon: 'gauge', roles: ['ceo', 'admin', 'operations', 'people_culture'],
      labelFor: { operations: 'Budget & clients', people_culture: 'Budget' }, hrefFor: { people_culture: '/ceo#budget', operations: '/ceo#budget' } },
    { id: 'planner', href: '/planner', label: 'Margin Planner', icon: 'calc', roles: ['ceo', 'operations', 'admin'] },
    { id: 'commercial-lead', href: '/commercial-lead', label: 'Commercial Lead', icon: 'growth', roles: ['admin', 'ceo', 'operations'] },
    { id: 'client-mapping', href: '/client-mapping', label: 'Client mapping', icon: 'link', roles: ['admin', 'ceo', 'operations'] },
  ];
  // Users lives on the Employees page (/?open=users); same gate as there.
  const USER_MANAGER_ROLES = ['admin', 'ceo', 'operations'];
  const NARROW_KEY = 'portalRailNarrow';
  const THEME_KEY = 'pricingPortalTheme';
  const THEMES = [
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
  ];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  let cfg = null;
  let app = null;
  let hidden = new Set();
  let active = null;

  function pagesFor(role) {
    return PAGES.filter((p) => !p.roles || p.roles.includes(role)).map((p) => ({
      ...p,
      label: (p.labelFor && p.labelFor[role]) || p.label,
      href: (p.hrefFor && p.hrefFor[role]) || p.href,
    }));
  }
  const canManageUsers = () => USER_MANAGER_ROLES.includes(cfg.role);
  const visibleItems = () => (cfg.items || []).filter((it) => !hidden.has(it.id));

  /* ── theme ── */
  function themePref() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (err) { return 'system'; }
  }
  function setTheme(value) {
    if (value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
    try {
      if (value === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, value);
    } catch (err) {}
    renderTheme();
    if (cfg && cfg.onThemeChange) cfg.onThemeChange(value);
  }

  /* ── rail ── */
  function itemHtml(it) {
    const badge = it.badge ? `<span class="ps-bd${it.badgeQuiet ? ' q' : ''}">${esc(it.badge)}</span>` : '';
    return `<button type="button" class="ps-item" data-ps-item="${esc(it.id)}" title="${esc(it.label)}"
      aria-current="${it.id === active ? 'page' : 'false'}">${ico(it.icon)}<span class="ps-lb">${esc(it.label)}</span>${badge}</button>`;
  }

  function buildRail() {
    const rail = app.querySelector('.ps-rail');
    rail.innerHTML = `
      <a class="ps-home" href="/" title="CEAS Portal home"><div class="ps-mark">C</div>
        <div class="ps-home-tx"><b>CEAS Portal</b><span>${esc(cfg.pageLabel)}</span></div></a>
      <button type="button" class="ps-item" data-ps-search title="Search">${ico('search')}<span class="ps-lb">Search</span><span class="ps-kbd">${isMac ? '⌘K' : 'Ctrl K'}</span></button>
      <div class="ps-scroll"></div>
      <div class="ps-foot">
        <div class="ps-theme" role="group" aria-label="Appearance"></div>
        <button type="button" class="ps-item ps-collapse" data-ps-collapse></button>
        <div class="ps-account" id="psAccount"></div>
      </div>`;
    renderItems();
    renderTheme();
    renderCollapse();
    if (cfg.mountAccount) cfg.mountAccount(rail.querySelector('#psAccount'));
  }

  function renderItems() {
    const pages = pagesFor(cfg.role);
    const items = visibleItems();
    const usersHere = cfg.page === 'employees' && active === 'users';
    // Items may carry a group (the Control Room's "The business", …); a new
    // group starts a new heading, otherwise the page's name heads them all.
    let group = null;
    const itemsHtml = items.map((it) => {
      const g = it.group || cfg.pageLabel;
      const head = g !== group ? `<div class="ps-sec">${esc(g)}</div>` : '';
      group = g;
      return head + itemHtml(it);
    }).join('');
    app.querySelector('.ps-scroll').innerHTML = `
      ${itemsHtml}
      ${pages.length > 1 ? `<div class="ps-sec">Portal</div>
      ${pages.map((p) => `<a class="ps-item" href="${esc(p.href)}" title="${esc(p.label)}"
        aria-current="${p.id === cfg.page && !usersHere ? 'page' : 'false'}">${ico(p.icon)}<span class="ps-lb">${esc(p.label)}</span></a>`).join('')}` : ''}
      ${canManageUsers() ? `<div class="ps-sec">Admin</div>
      <a class="ps-item" href="/?open=users" data-ps-users title="Users" aria-current="${usersHere ? 'page' : 'false'}">${ico('key')}<span class="ps-lb">Users</span></a>` : ''}`;
    const title = app.querySelector('.ps-mbar-title');
    const cur = (cfg.items || []).find((it) => it.id === active);
    if (title) title.textContent = usersHere ? 'Users' : cur ? cur.label : cfg.pageLabel;
  }

  /* Expanded: a three-way segment. Collapsed: one button showing the
     current choice, cycling dark → system → light. */
  function renderTheme() {
    const box = app && app.querySelector('.ps-theme');
    if (!box) return;
    const pref = themePref();
    const cur = THEMES.find((t) => t.value === pref) || THEMES[1];
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    box.innerHTML = `
      <span class="ps-theme-lb">Appearance</span>
      <div class="ps-seg">${THEMES.map((t) => `<button type="button" data-ps-theme="${t.value}" aria-pressed="${t.value === pref}"
        title="${t.label}" aria-label="${t.label}">${ico(t.value)}</button>`).join('')}</div>
      <button type="button" class="ps-item ps-theme-one" data-ps-theme="${next.value}"
        title="Appearance: ${cur.label} — switch to ${next.label}" aria-label="Appearance: ${cur.label}. Switch to ${next.label}">${ico(cur.value)}</button>`;
  }

  function renderCollapse() {
    const narrow = app.classList.contains('ps-narrow');
    const btn = app.querySelector('[data-ps-collapse]');
    btn.title = narrow ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-expanded', String(!narrow));
    btn.innerHTML = `${ico(narrow ? 'expand' : 'collapse')}<span class="ps-lb">Collapse sidebar</span>`;
  }

  function setNarrow(on) {
    app.classList.toggle('ps-narrow', on);
    try { if (on) localStorage.setItem(NARROW_KEY, '1'); else localStorage.removeItem(NARROW_KEY); } catch (err) {}
    renderCollapse();
    if (cfg.onResize) setTimeout(cfg.onResize, 50);
  }

  const setOpen = (on) => app.classList.toggle('ps-open', on);

  /* ── ⌘K (pages without their own search) ── */
  let cmdSel = 0;
  let cmdList = [];
  /* The other pages, Users and appearance — also handed to a page that
     runs its own search (portalEntries), so ⌘K covers them everywhere. */
  function portalEntries() {
    const pages = pagesFor(cfg.role).filter((p) => p.id !== cfg.page)
      .map((p) => ({ label: p.label, kind: 'Open page', icon: p.icon, run: () => { window.location.href = p.href; } }));
    const admin = canManageUsers() ? [{ label: 'Users', kind: 'Admin', icon: 'key', run: openUsers }] : [];
    const themes = THEMES.map((t) => ({ label: `Appearance: ${t.label}`, kind: 'Appearance', icon: t.value, run: () => setTheme(t.value) }));
    return pages.concat(admin, themes);
  }
  function cmdEntries(q) {
    const items = visibleItems().map((it) => ({ label: it.label, kind: it.group || cfg.pageLabel, icon: it.icon, run: () => select(it.id) }));
    const all = items.concat(portalEntries());
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((e) => e.label.toLowerCase().includes(needle)) : all;
  }
  function drawCmd() {
    const box = document.getElementById('psCmdList');
    cmdList = cmdEntries(document.getElementById('psCmdIn').value);
    if (cmdSel >= cmdList.length) cmdSel = Math.max(0, cmdList.length - 1);
    box.innerHTML = cmdList.length
      ? cmdList.map((e, i) => `<div class="ps-ci" role="option" data-i="${i}" aria-selected="${i === cmdSel}">${ico(e.icon)}<span>${esc(e.label)}</span><span class="ps-ck">${esc(e.kind)}</span></div>`).join('')
      : '<div class="ps-cempty">Nothing matches. Try a section or page name.</div>';
  }
  function openSearch() {
    setOpen(false);
    if (cfg.onSearch) { cfg.onSearch(); return; }
    document.getElementById('psCmd').dataset.open = 'true';
    const input = document.getElementById('psCmdIn');
    input.value = '';
    cmdSel = 0;
    drawCmd();
    input.focus();
  }
  const closeCmd = () => { document.getElementById('psCmd').dataset.open = 'false'; };
  function runCmd(i) {
    const e = cmdList[i];
    if (!e) return;
    closeCmd();
    e.run();
  }

  function select(id) {
    setOpen(false);
    if (cfg.onSelect) cfg.onSelect(id);
  }
  function openUsers() {
    setOpen(false);
    if (cfg.onUsers) cfg.onUsers();
    else window.location.href = '/?open=users';
  }

  function bind() {
    app.addEventListener('click', (e) => {
      const item = e.target.closest('[data-ps-item]');
      if (item) { select(item.dataset.psItem); return; }
      const users = e.target.closest('[data-ps-users]');
      if (users && cfg.onUsers) { e.preventDefault(); openUsers(); return; }
      const theme = e.target.closest('[data-ps-theme]');
      if (theme) { setTheme(theme.dataset.psTheme); return; }
      if (e.target.closest('[data-ps-search]')) { openSearch(); return; }
      if (e.target.closest('[data-ps-collapse]')) { setNarrow(!app.classList.contains('ps-narrow')); return; }
      if (e.target.closest('[data-ps-menu]')) { setOpen(true); return; }
      if (e.target.closest('.ps-scrim')) setOpen(false);
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (themePref() === 'system' && cfg.onThemeChange) cfg.onThemeChange('system');
      });
    }
    if (cfg.onSearch) {
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.classList.contains('ps-open')) setOpen(false); });
      return; // the page owns ⌘K
    }
    const cmd = document.getElementById('psCmd');
    cmd.addEventListener('click', (e) => {
      const ci = e.target.closest('.ps-ci');
      if (ci) runCmd(Number(ci.dataset.i));
      else if (e.target === cmd) closeCmd();
    });
    document.getElementById('psCmdIn').addEventListener('input', () => { cmdSel = 0; drawCmd(); });
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (cmd.dataset.open === 'true') closeCmd(); else openSearch();
        return;
      }
      if (cmd.dataset.open === 'true') {
        if (e.key === 'Escape') { closeCmd(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!cmdList.length) return;
          cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + cmdList.length) % cmdList.length;
          drawCmd();
          const sel = document.querySelector('.ps-ci[aria-selected="true"]');
          if (sel) sel.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdSel); }
        return;
      }
      if (e.key === 'Escape' && app.classList.contains('ps-open')) setOpen(false);
    });
  }

  /* opts: { appEl, page, pageLabel, role, items: [{ id, label, icon, badge? }],
     hidden, active, onSelect(id), onUsers(), onSearch(), onThemeChange(value),
     onResize(), mountAccount(containerEl) }. The page's content must already
     sit in appEl's .ps-main. */
  function mount(opts) {
    cfg = opts;
    app = opts.appEl;
    active = opts.active || null;
    hidden = new Set(opts.hidden || []);
    app.classList.add('ps-app');
    let narrow = false;
    try { narrow = localStorage.getItem(NARROW_KEY) === '1'; } catch (err) {}
    app.classList.toggle('ps-narrow', narrow);

    const rail = document.createElement('nav');
    rail.className = 'ps-rail';
    rail.setAttribute('aria-label', 'Portal');
    app.insertBefore(rail, app.firstChild);
    const scrim = document.createElement('div');
    scrim.className = 'ps-scrim';
    app.appendChild(scrim);
    const main = app.querySelector('.ps-main');
    const bar = document.createElement('div');
    bar.className = 'ps-mbar';
    bar.innerHTML = `<button type="button" data-ps-menu aria-label="Open menu">${ico('menu')}</button>
      <div class="ps-mbar-title"></div>
      <button type="button" data-ps-search aria-label="Search">${ico('search')}</button>`;
    main.insertBefore(bar, main.firstChild);

    if (!opts.onSearch) {
      const cmd = document.createElement('div');
      cmd.className = 'ps-cmd';
      cmd.id = 'psCmd';
      cmd.dataset.open = 'false';
      cmd.innerHTML = `<div class="ps-cmdbox" role="dialog" aria-label="Search">
        <input class="ps-cmdin" id="psCmdIn" placeholder="Go to a section or page…" autocomplete="off" aria-label="Search sections and pages">
        <div class="ps-cmdl" id="psCmdList" role="listbox"></div></div>`;
      document.body.appendChild(cmd);
    }

    buildRail();
    bind();
  }

  function setActive(id) {
    active = id;
    if (app) renderItems();
  }
  function setHidden(id, isHidden) {
    if (isHidden) hidden.add(id); else hidden.delete(id);
    if (app) renderItems();
  }
  /* Replace the page's items (e.g. new badge counts) without remounting. */
  function setItems(items) {
    cfg.items = items;
    if (app) renderItems();
  }

  window.AppShell = { mount, setActive, setHidden, setItems, setTheme, themePref, portalEntries, icon: ico };
})();
