/* Teams directory modal, shared by every frontend surface — same reasoning
   and loading convention as accountSettings.js: a modal, not a page/view,
   so it drops into all 4 pages identically without hooking into any page's
   own tab/view-routing. Reached via the "Teams" item in accountMenu.js's
   dropdown, visible to every authenticated role (not just employee — a
   manager or admin browsing colleagues is just as useful a case).

   Groups the company directory by department into sections of clickable
   cards; clicking a card expands it inline (no modal-within-modal, no new
   dialog primitive — this codebase deliberately avoids native
   confirm()/alert() and modal stacking, see timeOff.js's own two-click
   confirm pattern for the same reasoning). */
(function () {
  const escapeHtml = window.AccountMenu.escapeHtml;
  const avatarHtml = window.AccountMenu.avatarHtml;

  function closeModal() {
    const overlay = document.getElementById('teamsDirectoryOverlay');
    if (overlay) overlay.remove();
  }

  async function loadDirectory(opts) {
    try {
      const res = await opts.apiFetch('/api/employees/directory');
      return res.employees || [];
    } catch (err) {
      return [];
    }
  }

  // Seeded from every known department, active or not — an employee on a
  // deactivated department still gets its own real section (with its real
  // label) instead of falling into "Other". Only a genuinely unmatched
  // code (no departments row at all) lands there.
  function groupByDepartment(entries) {
    const groups = new Map();
    window.Departments.list().forEach((d) => groups.set(d.code, []));
    const other = [];
    entries.forEach((e) => {
      if (e.department && groups.has(e.department)) {
        groups.get(e.department).push(e);
      } else {
        other.push(e);
      }
    });
    if (other.length) groups.set(null, other);
    return groups;
  }

  function departmentLabel(dept) {
    if (!dept) return 'Other';
    return window.Departments.labelFor(dept);
  }

  function statusLabel(status) {
    if (status === 'on_leave') return 'On Leave';
    if (status === 'remote') return 'Remote';
    return 'Active';
  }

  function cardHtml(e) {
    return `
      <div class="team-directory-card" id="team-directory-card-${e.id}" role="button" tabindex="0" onclick="teamsDirectoryToggle(${e.id})">
        <div class="team-directory-card-summary">
          <div class="team-directory-card-avatar">${avatarHtml(e.photoUrl, e)}</div>
          <div>
            <div class="team-directory-card-name">${escapeHtml(e.firstName + ' ' + e.lastName)}${e.isTeamHead ? ' <span class="badge badge-approved">Team Head</span>' : ''}</div>
            <div class="team-directory-card-title small muted">${escapeHtml(e.jobTitle || '')}</div>
          </div>
        </div>
        <div class="team-directory-card-detail" id="team-directory-detail-${e.id}" hidden>
          <div><strong>Department:</strong> ${escapeHtml(departmentLabel(e.department))}</div>
          <div><strong>Status:</strong> ${escapeHtml(statusLabel(e.status))}</div>
          <div><strong>Email:</strong> ${e.email ? `<a href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '—'}</div>
          <div><strong>Manager:</strong> ${e.managerName
            ? `${escapeHtml(e.managerName)}${e.managerEmail ? ` (<a href="mailto:${escapeHtml(e.managerEmail)}">${escapeHtml(e.managerEmail)}</a>)` : ''}`
            : 'No manager assigned yet'}</div>
        </div>
      </div>`;
  }

  // Accordion, not independent toggles — opening a card closes whichever
  // other one was open, so at most one is ever expanded at a time (same
  // behavior as the employees app's own My Team roster cards).
  function toggleCard(id) {
    const detail = document.getElementById('team-directory-detail-' + id);
    if (!detail) return;
    const wasHidden = detail.hidden;
    document.querySelectorAll('[id^="team-directory-detail-"]').forEach((d) => { d.hidden = true; });
    detail.hidden = !wasHidden;
  }
  window.teamsDirectoryToggle = toggleCard;

  function sectionsHtml(entries) {
    const groups = groupByDepartment(entries);
    const sections = [];
    groups.forEach((members, dept) => {
      if (!members.length) return;
      sections.push(`
        <section class="team-directory-section">
          <h3>${escapeHtml(departmentLabel(dept))} <span class="small muted">(${members.length})</span></h3>
          <div class="team-directory-grid">${members.map(cardHtml).join('')}</div>
        </section>`);
    });
    return sections.join('') || '<div class="empty-state">No colleagues found.</div>';
  }

  async function openTeams(opts) {
    closeModal(); // in case one is somehow already open

    const overlay = document.createElement('div');
    overlay.id = 'teamsDirectoryOverlay';
    overlay.className = 'account-modal-overlay';
    overlay.innerHTML = `
      <div class="account-modal team-directory-modal" role="dialog" aria-modal="true" aria-label="Teams">
        <div class="account-modal-header">
          <div><h2>Teams</h2></div>
          <button type="button" class="ghost" id="teamsDirectoryClose" aria-label="Close">&times;</button>
        </div>
        <div class="account-modal-body" id="teamsDirectoryBody">
          <div class="account-modal-loading">Loading…</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('teamsDirectoryClose').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key !== 'Escape') return;
      closeModal();
      document.removeEventListener('keydown', escHandler);
    });

    const [entries] = await Promise.all([loadDirectory(opts), window.Departments.load(opts.apiFetch)]);
    const body = document.getElementById('teamsDirectoryBody');
    if (body) body.innerHTML = sectionsHtml(entries);
  }

  window.AccountMenu = window.AccountMenu || {};
  window.AccountMenu.openTeams = openTeams;
})();
