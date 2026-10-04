// The "Teams" tab: the full company directory grouped by department (with
// search), plus the reporting-line org chart. Every person is one row with
// all their details visible — the old click-to-expand cards are gone.
import { $, escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';
import { panel, colTitle, plural, loadErrorPanel, fullName, peopleRowHtml } from './panels.js';

function departmentLabel(dept) {
  if (!dept) return 'Other';
  return window.Departments.labelFor(dept);
}

// Only the non-default states earn a badge — "Active" on everyone is noise.
function badgesFor(e) {
  const badges = [];
  if (e.isCompanyManager) badges.push({ label: 'CEO', tone: 'approved' });
  else if (e.isTeamHead) badges.push({ label: 'Team head', tone: 'approved' });
  if (e.status === 'on_leave') badges.push({ label: 'On leave', tone: 'pending' });
  if (e.status === 'remote') badges.push({ label: 'Remote', tone: 'manager_approved' });
  return badges;
}

// What the directory search matches against — name, title, email,
// department label, manager name.
function searchText(e) {
  return [fullName(e), e.jobTitle, e.email, departmentLabel(e.department), e.managerName].filter(Boolean).join(' ').toLowerCase();
}

// ── Department directory ──────────────────────────────────────────────
// Seeded from every known department, active or not — a deactivated
// department still gets its own real section instead of falling into
// "Other". Only a genuinely unmatched code lands there.
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

function directoryHtml(entries) {
  const byName = (a, b) => fullName(a).localeCompare(fullName(b));
  const sections = [];
  groupByDepartment(entries).forEach((members, dept) => {
    if (!members.length) return;
    sections.push(`<section class="dir-section" data-dir-section>
      ${colTitle(departmentLabel(dept), `<span data-dir-count>${members.length}</span>`)}
      <ul class="list people-list people-list-grouped">${[...members].sort(byName).map((e) => peopleRowHtml(e, badgesFor(e), ` data-dir-row data-search="${escapeHtml(searchText(e))}"`)).join('')}</ul>
    </section>`);
  });
  return sections.length
    ? sections.join('') + '<div class="list-empty" data-dir-nomatch hidden>No one matches that search.</div>'
    : '<div class="list-empty">No colleagues found.</div>';
}

// Hides non-matching rows, then any department left empty; counts update
// to the visible rows so a section heading never lies about what's under it.
function applySearch(container, query) {
  const q = query.trim().toLowerCase();
  let anyVisible = false;
  container.querySelectorAll('[data-dir-section]').forEach((section) => {
    let visible = 0;
    section.querySelectorAll('[data-dir-row]').forEach((row) => {
      const match = !q || row.dataset.search.includes(q);
      row.hidden = !match;
      if (match) visible += 1;
    });
    section.hidden = visible === 0;
    section.querySelector('[data-dir-count]').textContent = String(visible);
    if (visible) anyVisible = true;
  });
  const none = container.querySelector('[data-dir-nomatch]');
  if (none) none.hidden = anyVisible;
}

// ── Organization chart ────────────────────────────────────────────────
// Deliberately not a pure managerEmployeeId tree: the root is always the
// one 'ceo'-role account (this org's single top-level exec — see
// employee.model.js's toDirectoryEntry comment) regardless of that
// account's own managerEmployeeId, and every team head sits directly under
// the root as its own flat tier regardless of their managerEmployeeId too
// — team heads are the company's real org units and shouldn't nest under
// each other or wherever a possibly-stale FK happens to point. Everyone
// else nests recursively under their real manager.
function orgNodeHtml(e, childrenByManager) {
  const kids = childrenByManager[e.id] || [];
  const role = e.isCompanyManager ? 'CEO' : e.isTeamHead ? 'Team head' : '';
  return `<li>
    <div class="org-node">
      <span class="people-avatar people-avatar-sm">${window.AccountMenu.avatarHtml(e.photoUrl, e)}</span>
      <span class="org-node-name">${escapeHtml(fullName(e))}</span>
      ${role ? `<span class="badge badge-approved">${role}</span>` : ''}
      <span class="org-node-meta">${escapeHtml([e.jobTitle, departmentLabel(e.department)].filter(Boolean).join(' · '))}</span>
      ${kids.length ? `<span class="org-node-count">${kids.length} ${plural(kids.length, 'report', 'reports')}</span>` : ''}
    </div>
    ${kids.length ? `<ul class="org-children">${kids.map((k) => orgNodeHtml(k, childrenByManager)).join('')}</ul>` : ''}
  </li>`;
}

function orgChartHtml(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rootManager = entries.find((e) => e.isCompanyManager);
  const teamHeadIds = new Set(entries.filter((e) => e.isTeamHead).map((e) => e.id));

  const childrenByManager = {};
  // Team heads (flat, under the root) plus anyone whose manager doesn't
  // resolve to a real, other employee (bad data, or a genuine orphan) —
  // surfaced here rather than silently dropped from the chart.
  const secondTier = [];
  entries.forEach((e) => {
    if (rootManager && e.id === rootManager.id) return; // the root is never rendered as anyone's child
    if (teamHeadIds.has(e.id)) { secondTier.push(e); return; }
    if (e.managerEmployeeId && e.managerEmployeeId !== e.id && byId.has(e.managerEmployeeId)) {
      if (!childrenByManager[e.managerEmployeeId]) childrenByManager[e.managerEmployeeId] = [];
      childrenByManager[e.managerEmployeeId].push(e);
    } else {
      secondTier.push(e);
    }
  });
  // A real direct report of the root who isn't flagged as a team head
  // still belongs at tier 2 alongside the team heads — nobody should
  // disappear just for reporting straight to the CEO without that flag set.
  if (rootManager && childrenByManager[rootManager.id]) {
    secondTier.push(...childrenByManager[rootManager.id]);
  }

  // Alphabetical within each level — no seniority/title data to sort by
  // otherwise, and this keeps the tree deterministic across reloads.
  const byName = (a, b) => fullName(a).localeCompare(fullName(b));
  secondTier.sort(byName);
  Object.values(childrenByManager).forEach((list) => list.sort(byName));

  if (rootManager) {
    childrenByManager[rootManager.id] = secondTier;
    return `<ul class="org-tree">${orgNodeHtml(rootManager, childrenByManager)}</ul>`;
  }
  // No 'ceo'-role account in the directory — shouldn't happen in
  // practice, but fall back to every team head/orphan as its own root
  // rather than rendering nothing.
  return `<ul class="org-tree">${secondTier.map((r) => orgNodeHtml(r, childrenByManager)).join('')}</ul>`;
}

export async function renderTeamsDirectory() {
  const container = $('#teams-content');
  container.innerHTML = panel({ title: 'Company directory', body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });

  let entries;
  try {
    const [res] = await Promise.all([apiFetch('/api/employees/directory'), window.Departments.load(apiFetch)]);
    entries = res.employees || [];
  } catch (err) {
    console.error('Teams failed to load', err);
    container.innerHTML = loadErrorPanel('The directory couldn’t load', err, 'data-teams-retry');
    container.querySelector('[data-teams-retry]').addEventListener('click', renderTeamsDirectory);
    return;
  }

  container.innerHTML = `<div class="stack">
    ${panel({
      title: 'Company directory',
      meta: `${entries.length} ${plural(entries.length, 'person', 'people')}`,
      actions: '<input type="search" class="form-control dir-search" id="teams-search" placeholder="Search name, title, email…" aria-label="Search the directory">',
      body: `<div class="panel-body">${directoryHtml(entries)}</div>`,
    })}
    ${entries.length ? panel({ title: 'Organization chart', meta: 'CEO, then team heads, then everyone under their manager', body: `<div class="panel-body">${orgChartHtml(entries)}</div>` }) : ''}
  </div>`;

  const search = $('#teams-search');
  if (search) search.addEventListener('input', () => applySearch(container, search.value));
}
