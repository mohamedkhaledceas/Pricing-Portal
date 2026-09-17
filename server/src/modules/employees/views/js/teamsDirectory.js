// The "Teams" tab: the company's reporting-line org chart, plus the full
// directory grouped by department. Ported from the old
// /shared/teamsDirectory.js modal (retired: it was reached only via
// accountMenu.js's "Teams" item, which no longer exists — this tab is now
// the one place any of this lives) and team.js's old "Organization Chart"
// card (moved here so reporting structure and the department directory
// live on the same tab). Same card look and expand-on-click behavior as My
// Team in team.js, reusing the same global team-directory-* CSS
// (accountMenu.css) — own id namespaces per section (teams-tab-*,
// org-chart-*) since both sections are mounted on the same tab panel at
// once and the accordion toggles are scoped by id prefix.
import { $, escapeHtml } from './dom.js';
import { apiFetch } from './apiClient.js';

function departmentLabel(dept) {
  if (!dept) return 'Other';
  return window.Departments.labelFor(dept);
}

function statusLabel(status) {
  if (status === 'on_leave') return 'On Leave';
  if (status === 'remote') return 'Remote';
  return 'Active';
}

function cardBodyHtml(e) {
  const avatarHtml = window.AccountMenu.avatarHtml(e.photoUrl, e);
  return `
    <div class="team-directory-card-summary">
      <div class="team-directory-card-avatar">${avatarHtml}</div>
      <div>
        <div class="team-directory-card-name">${escapeHtml(e.firstName + ' ' + e.lastName)}${e.isTeamHead ? ' <span class="badge badge-approved">Team Head</span>' : ''}</div>
        <div class="team-directory-card-title small muted">${escapeHtml(e.jobTitle || '')}</div>
      </div>
    </div>`;
}

function cardDetailHtml(e) {
  return `
    <div><strong>Department:</strong> ${escapeHtml(departmentLabel(e.department))}</div>
    <div><strong>Status:</strong> ${escapeHtml(statusLabel(e.status))}</div>
    <div><strong>Email:</strong> ${e.email ? `<a href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '—'}</div>
    <div><strong>Manager:</strong> ${e.managerName
      ? `${escapeHtml(e.managerName)}${e.managerEmail ? ` (<a href="mailto:${escapeHtml(e.managerEmail)}">${escapeHtml(e.managerEmail)}</a>)` : ''}`
      : 'No manager assigned yet'}</div>`;
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

function directoryCardHtml(e) {
  return `
    <div class="team-directory-card" id="teams-tab-card-${e.id}" role="button" tabindex="0" onclick="teamsTabToggleCard(${e.id})">
      ${cardBodyHtml(e)}
      <div class="team-directory-card-detail" id="teams-tab-detail-${e.id}" hidden>${cardDetailHtml(e)}</div>
    </div>`;
}

// Accordion, not independent toggles.
window.teamsTabToggleCard = function (id) {
  const detail = document.getElementById('teams-tab-detail-' + id);
  if (!detail) return;
  const wasHidden = detail.hidden;
  document.querySelectorAll('[id^="teams-tab-detail-"]').forEach((d) => { d.hidden = true; });
  detail.hidden = !wasHidden;
};

function departmentSectionsHtml(entries) {
  const groups = groupByDepartment(entries);
  const sections = [];
  groups.forEach((members, dept) => {
    if (!members.length) return;
    sections.push(`
      <section class="team-directory-section">
        <h3>${escapeHtml(departmentLabel(dept))} <span class="small muted">(${members.length})</span></h3>
        <div class="team-directory-grid">${members.map(directoryCardHtml).join('')}</div>
      </section>`);
  });
  return sections.join('') || '<div class="empty-state">No colleagues found.</div>';
}

// ── Organization chart ────────────────────────────────────────────────
// Deliberately not a pure managerEmployeeId tree (team.js's old version
// was): the root is always the one 'manager'-role account (this org's CEO
// — see employee.model.js's toDirectoryEntry comment) regardless of that
// account's own managerEmployeeId, and every team head sits directly under
// the root as its own flat tier regardless of their managerEmployeeId too
// — team heads are the company's real org units and shouldn't nest under
// each other or wherever a possibly-stale FK happens to point. Everyone
// else nests recursively under their real manager, same as before.
function orgChartCardHtml(e) {
  return `
    <div class="team-directory-card" id="org-chart-card-${e.id}" role="button" tabindex="0" onclick="orgChartToggleCard(${e.id})">
      ${cardBodyHtml(e)}
      <div class="team-directory-card-detail" id="org-chart-detail-${e.id}" hidden>${cardDetailHtml(e)}</div>
    </div>`;
}

window.orgChartToggleCard = function (id) {
  const detail = document.getElementById('org-chart-detail-' + id);
  if (!detail) return;
  const wasHidden = detail.hidden;
  document.querySelectorAll('[id^="org-chart-detail-"]').forEach((d) => { d.hidden = true; });
  detail.hidden = !wasHidden;
};

function orgChartNodeHtml(e, childrenByManager) {
  const kids = childrenByManager[e.id] || [];
  return `<li>
    ${orgChartCardHtml(e)}
    ${kids.length ? `<ul class="org-chart-children">${kids.map((k) => orgChartNodeHtml(k, childrenByManager)).join('')}</ul>` : ''}
  </li>`;
}

function orgChartSectionHtml(entries) {
  if (!entries.length) return '';
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rootManager = entries.find((e) => e.isCompanyManager);
  const teamHeadIds = new Set(entries.filter((e) => e.isTeamHead).map((e) => e.id));

  const childrenByManager = {};
  // Team heads (flat, under the root) plus anyone whose manager doesn't
  // resolve to a real, other employee (bad data, or a genuine orphan) —
  // surfaced here rather than silently dropped from the chart, same rule
  // this tree always applied to unresolvable managers.
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
  // still belongs at tier 2 alongside the team heads — only team heads
  // were named in the ask, but nobody should disappear just for
  // reporting straight to the CEO without that flag set.
  if (rootManager && childrenByManager[rootManager.id]) {
    secondTier.push(...childrenByManager[rootManager.id]);
  }

  // Alphabetical within each level — no seniority/title data to sort by
  // otherwise, and this keeps the tree deterministic across reloads.
  const byName = (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
  secondTier.sort(byName);
  Object.values(childrenByManager).forEach((list) => list.sort(byName));

  let tree;
  if (rootManager) {
    childrenByManager[rootManager.id] = secondTier;
    tree = orgChartNodeHtml(rootManager, childrenByManager);
  } else {
    // No 'manager'-role account in the directory — shouldn't happen in
    // practice, but fall back to every team head/orphan as its own root
    // rather than rendering nothing.
    tree = secondTier.map((r) => orgChartNodeHtml(r, childrenByManager)).join('');
  }

  return `<div class="card section">
    <div class="card-title">Organization Chart</div>
    <ul class="org-chart-tree">${tree}</ul>
  </div>`;
}

export async function renderTeamsDirectory() {
  const container = $('#teams-content');
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;

  const [res] = await Promise.all([apiFetch('/api/employees/directory'), window.Departments.load(apiFetch)]);
  const entries = res.employees || [];
  container.innerHTML = departmentSectionsHtml(entries) + orgChartSectionHtml(entries);
}
