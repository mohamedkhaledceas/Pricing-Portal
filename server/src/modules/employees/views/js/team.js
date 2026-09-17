import { $, escapeHtml } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';

let directoryById = {};
async function loadDirectoryIndex() {
  const res = await apiFetch('/api/employees/directory');
  const employees = res.employees || [];
  directoryById = {};
  employees.forEach((e) => { directoryById[e.id] = e; });
  return employees;
}

// Same clickable-card look and click-to-expand behavior as the Teams tab
// (see ./teamsDirectory.js's cardHtml/toggleCard) — reuses its CSS
// (already loaded globally via accountMenu.css) so a card here looks and
// behaves identically to one there. Kept as its own markup/toggle
// (my-team-* ids) rather than calling into that module, matching that
// module's own precedent: tab-panels are only hidden, not removed from the
// DOM, so both sets of cards coexist and would otherwise collide on the
// same #team-directory-card-N ids.
function myTeamCardHtml(e, roleLabel) {
  const avatarHtml = window.AccountMenu.avatarHtml(e.photoUrl, e);
  const dept = e.department ? window.Departments.labelFor(e.department) : null;
  return `
    <div class="team-directory-card" id="my-team-card-${e.id}" role="button" tabindex="0" onclick="myTeamToggleCard(${e.id})">
      <div class="team-directory-card-summary">
        <div class="team-directory-card-avatar">${avatarHtml}</div>
        <div>
          <div class="team-directory-card-name">${escapeHtml(e.firstName + ' ' + e.lastName)}${roleLabel ? ` <span class="badge badge-approved">${escapeHtml(roleLabel)}</span>` : ''}</div>
          <div class="team-directory-card-title small muted">${escapeHtml(e.jobTitle || '')}</div>
        </div>
      </div>
      <div class="team-directory-card-detail" id="my-team-detail-${e.id}" hidden>
        <div><strong>Department:</strong> ${escapeHtml(dept || '—')}</div>
        <div><strong>Email:</strong> ${e.email ? `<a href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '—'}</div>
        <div><strong>Manager:</strong> ${e.managerName
          ? `${escapeHtml(e.managerName)}${e.managerEmail ? ` (<a href="mailto:${escapeHtml(e.managerEmail)}">${escapeHtml(e.managerEmail)}</a>)` : ''}`
          : 'No manager assigned yet'}</div>
      </div>
    </div>`;
}
// Accordion, not independent toggles — opening a card closes whichever
// other one was open, so at most one is ever expanded at a time.
window.myTeamToggleCard = function (id) {
  const detail = document.getElementById('my-team-detail-' + id);
  if (!detail) return;
  const wasHidden = detail.hidden;
  document.querySelectorAll('[id^="my-team-detail-"]').forEach((d) => { d.hidden = true; });
  detail.hidden = !wasHidden;
};

// Same clickable-card look as My Team's cards (myTeamCardHtml above) —
// own id namespace (reporting-line-card-/reporting-line-detail-) since
// the chain below can include the very same employee (your manager) that
// My Team's own grid also renders on the same tab at the same time.
// badges is a list rather than a single roleLabel since one card can
// legitimately need two ("You" + "Team Head" when you manage a team
// yourself).
function reportingLineCardHtml(e, badges) {
  const avatarHtml = window.AccountMenu.avatarHtml(e.photoUrl, e);
  const dept = e.department ? window.Departments.labelFor(e.department) : null;
  const badgeHtml = badges.map((b) => ` <span class="badge badge-approved">${escapeHtml(b)}</span>`).join('');
  return `
    <div class="team-directory-card" id="reporting-line-card-${e.id}" role="button" tabindex="0" onclick="reportingLineToggleCard(${e.id})">
      <div class="team-directory-card-summary">
        <div class="team-directory-card-avatar">${avatarHtml}</div>
        <div>
          <div class="team-directory-card-name">${escapeHtml(e.firstName + ' ' + e.lastName)}${badgeHtml}</div>
          <div class="team-directory-card-title small muted">${escapeHtml(e.jobTitle || '')}</div>
        </div>
      </div>
      <div class="team-directory-card-detail" id="reporting-line-detail-${e.id}" hidden>
        <div><strong>Department:</strong> ${escapeHtml(dept || '—')}</div>
        <div><strong>Email:</strong> ${e.email ? `<a href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '—'}</div>
        <div><strong>Manager:</strong> ${e.managerName
          ? `${escapeHtml(e.managerName)}${e.managerEmail ? ` (<a href="mailto:${escapeHtml(e.managerEmail)}">${escapeHtml(e.managerEmail)}</a>)` : ''}`
          : 'No manager assigned yet'}</div>
      </div>
    </div>`;
}
// Accordion, not independent toggles — same rule as My Team's cards.
window.reportingLineToggleCard = function (id) {
  const detail = document.getElementById('reporting-line-detail-' + id);
  if (!detail) return;
  const wasHidden = detail.hidden;
  document.querySelectorAll('[id^="reporting-line-detail-"]').forEach((d) => { d.hidden = true; });
  detail.hidden = !wasHidden;
};

// My Reporting Line — the requirement doc's "Reporting line (full chain)"
// bullet (Portal §2), distinct from the Organization Chart on the Teams
// tab: that's the whole company's tree, this is just *your* path up it,
// front and center on My Team instead of buried in a shared tree you'd
// have to find yourself in. Walks managerEmployeeId upward through the
// same already-loaded directory the org chart uses (no new endpoint),
// stopping at the CEO (isCompanyManager) since nothing above them is
// meaningful, or at the first break in the chain (no manager assigned, or
// one who isn't in the active directory) — capped with a `seen` set so a
// data cycle (A manages B manages A) can't loop forever.
function myReportingLineSectionHtml() {
  const myEmployeeId = state.myEmployee && state.myEmployee.id;
  if (!myEmployeeId) return '';
  const me = directoryById[myEmployeeId];
  if (!me) return '';

  const chain = [me];
  const seen = new Set([me.id]);
  let current = me;
  while (current.managerEmployeeId && !current.isCompanyManager) {
    const next = directoryById[current.managerEmployeeId];
    if (!next || seen.has(next.id)) break;
    chain.push(next);
    seen.add(next.id);
    current = next;
  }

  const badgesFor = (e, isMe) => {
    const badges = isMe ? ['You'] : [];
    if (e.isCompanyManager) badges.push('CEO');
    else if (e.isTeamHead) badges.push('Team Head');
    return badges;
  };
  const noManagerYet = chain.length === 1 && !me.isCompanyManager;
  const cardsHtml = chain
    .map((e, i) => (i === 0 ? '' : '<span class="reporting-line-arrow">→</span>') + reportingLineCardHtml(e, badgesFor(e, i === 0)))
    .join('');

  return `<div class="card section">
    <div class="card-title">My Reporting Line</div>
    <div class="reporting-line-row">${cardsHtml}</div>
    ${noManagerYet ? '<div class="empty-state">You haven’t been assigned a manager yet.</div>' : ''}
  </div>`;
}

// Everyone has this context regardless of whether they manage anyone —
// their own manager, plus their team. Membership itself (direct reports
// plus department for anyone who manages others, department alone
// otherwise) is decided once, server-side, by rosterService.getMyTeam /
// services/teamMembership.js — the single source of truth every team-scoped
// screen shares. This only resolves the returned ids against the
// already-loaded directory so cards get the directory's cross-referenced
// managerName/managerEmail display fields.
function myTeamSectionHtml(myTeam) {
  const myEmployeeId = state.myEmployee && state.myEmployee.id;
  if (!myEmployeeId) return '';
  const myManagerId = state.myEmployee.managerEmployeeId;
  const manager = myManagerId ? directoryById[myManagerId] : null;
  const teammates = (myTeam.employees || [])
    .map((e) => directoryById[e.id])
    .filter((e) => e && e.id !== myEmployeeId && e.id !== myManagerId);

  let body;
  if (manager || teammates.length) {
    body = `<div class="team-directory-grid">
      ${manager ? myTeamCardHtml(manager, 'Manager') : ''}
      ${teammates.map((t) => myTeamCardHtml(t)).join('')}
    </div>`;
  } else if (myManagerId || state.myEmployee.department) {
    body = `<div class="empty-state">No other teammates found yet.</div>`;
  } else {
    body = `<div class="empty-state">You haven't been assigned a direct manager or department yet — once you are, your team will show up here.</div>`;
  }

  return `<div class="card section">
    <div class="card-title">My Team</div>
    ${body}
  </div>`;
}

// Approval queues (Pending My Decision, All Requests, Pending P&C
// Confirmation, Pending Profile Changes) moved to the new Requests Center
// tab (requestsCenter.js) — gathered there alongside the employee's own
// request history, per Portal §21. My Team now shows only team-member/org
// info.
export async function renderTeam() {
  const container = $('#team-content');
  container.innerHTML = `<div class="empty-state">Loading...</div>`;

  const [, myTeamRes] = await Promise.all([
    loadDirectoryIndex(),
    apiFetch('/api/employees/team/mine'),
    window.Departments.load(apiFetch),
  ]);

  const sections = [myReportingLineSectionHtml(), myTeamSectionHtml(myTeamRes)].filter(Boolean);
  container.innerHTML = sections.length ? sections.join('') : `<div class="empty-state">No team information available for this account.</div>`;
}
