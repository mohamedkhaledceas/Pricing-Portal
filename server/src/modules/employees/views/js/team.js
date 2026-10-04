import { $, escapeHtml, fmtDate } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { panel, split, colTitle, personRow, list, plural, loadErrorPanel, fullName, peopleRowHtml } from './panels.js';

let directoryById = {};
async function loadDirectoryIndex() {
  const res = await apiFetch('/api/employees/directory');
  const employees = res.employees || [];
  directoryById = {};
  employees.forEach((e) => { directoryById[e.id] = e; });
  return employees;
}

// My Reporting Line — the requirement doc's "Reporting line (full chain)"
// bullet (Portal §2), distinct from the Organization Chart on the Teams
// tab: that's the whole company's tree, this is just *your* path up it.
// Walks managerEmployeeId upward through the already-loaded directory (no
// new endpoint), stopping at the CEO (isCompanyManager) since nothing above
// them is meaningful, or at the first break in the chain (no manager
// assigned, or one who isn't in the active directory) — capped with a
// `seen` set so a data cycle (A manages B manages A) can't loop forever.
function reportingLineHtml() {
  const myEmployeeId = state.myEmployee && state.myEmployee.id;
  const me = myEmployeeId ? directoryById[myEmployeeId] : null;
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

  const roleOf = (e) => (e.isCompanyManager ? 'CEO' : e.isTeamHead ? 'Team head' : '');
  const steps = chain.map((e, i) => {
    const role = roleOf(e);
    return `<span class="chain-step">${i === 0 ? '<strong>You</strong>' : escapeHtml(fullName(e))}${role ? ` <span class="muted">(${role})</span>` : ''}</span>`;
  }).join('<span class="chain-arrow" aria-hidden="true">→</span>');
  const noManagerYet = chain.length === 1 && !me.isCompanyManager;

  return `<div class="context-line" aria-label="Your reporting line">
    <span class="muted">Reporting line</span>
    <span class="chain">${steps}</span>
    ${noManagerYet ? '<span class="chain-warn">No manager assigned yet</span>' : ''}
  </div>`;
}

// Everyone has this context regardless of whether they manage anyone —
// their own manager, plus their team. Membership itself (direct reports
// plus department for anyone who manages others, department alone
// otherwise) is decided once, server-side, by rosterService.getMyTeam /
// services/teamMembership.js — the single source of truth every team-scoped
// screen shares. This only resolves the returned ids against the
// already-loaded directory for photo/email/manager display fields.
function teamListHtml(myTeam) {
  const me = state.myEmployee;
  const myManagerId = me.managerEmployeeId;
  const manager = myManagerId ? directoryById[myManagerId] : null;
  const teammates = (myTeam.employees || [])
    .map((e) => directoryById[e.id])
    .filter((e) => e && e.id !== me.id && e.id !== myManagerId);

  // Manager first, then your direct reports, then everyone else — each
  // group alphabetical.
  const isReport = (e) => e.managerEmployeeId === me.id;
  const byName = (a, b) => fullName(a).localeCompare(fullName(b));
  const ordered = [...teammates.filter(isReport).sort(byName), ...teammates.filter((e) => !isReport(e)).sort(byName)];

  const rows = [];
  if (manager) rows.push(peopleRowHtml(manager, [{ label: 'Your manager', tone: 'approved' }]));
  ordered.forEach((e) => {
    const badges = [];
    if (isReport(e)) badges.push({ label: 'Reports to you', tone: 'manager_approved' });
    if (e.isTeamHead) badges.push({ label: 'Team head', tone: 'neutral' });
    rows.push(peopleRowHtml(e, badges));
  });

  if (rows.length) return { count: rows.length, reports: ordered.filter(isReport).length, html: `<ul class="list people-list">${rows.join('')}</ul>` };
  const message = (myManagerId || me.department)
    ? 'No other teammates found yet.'
    : 'You haven’t been assigned a direct manager or department yet — once you are, your team will show up here.';
  return { count: 0, reports: 0, html: `<div class="list-empty">${escapeHtml(message)}</div>` };
}

// Approved-only, name + date range — scoped server-side to the same team
// definition as the list beside it (timeOffService.listUpcomingTeamLeave).
function upcomingLeaveHtml(upcoming) {
  const rows = upcoming.map((u) => personRow(u.name, u.startDate === u.endDate ? fmtDate(u.startDate) : `${fmtDate(u.startDate)} – ${fmtDate(u.endDate)}`));
  return colTitle('Upcoming leave', 'approved only') + list(rows, 'No approved leave coming up for your team.');
}

// Approval queues moved to the Requests tab (requestsCenter.js); My Team
// shows team-member/org info plus upcoming approved team leave.
export async function renderTeam() {
  const container = $('#team-content');
  if (!state.myEmployee) {
    container.innerHTML = panel({ title: 'Your team', body: '<div class="panel-body"><div class="list-empty">No team information available for this account — it has no employee profile.</div></div>' });
    return;
  }
  container.innerHTML = panel({ title: 'Your team', body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });

  let myTeamRes, upcomingRes;
  try {
    [, myTeamRes, , upcomingRes] = await Promise.all([
      loadDirectoryIndex(),
      apiFetch('/api/employees/team/mine'),
      window.Departments.load(apiFetch),
      apiFetch('/api/employees/leave-requests/team/upcoming'),
    ]);
  } catch (err) {
    console.error('My Team failed to load', err);
    container.innerHTML = loadErrorPanel('Your team couldn’t load', err, 'data-team-retry');
    container.querySelector('[data-team-retry]').addEventListener('click', renderTeam);
    return;
  }

  const team = teamListHtml(myTeamRes);
  const meta = team.count
    ? `${team.count} ${plural(team.count, 'person', 'people')}${team.reports ? `, ${team.reports} ${plural(team.reports, 'reports', 'report')} to you` : ''}`
    : '';
  container.innerHTML = `${reportingLineHtml()}
    ${panel({
      title: 'Your team',
      meta,
      body: split([{ html: team.html }, { html: upcomingLeaveHtml(upcomingRes.upcoming || []) }], '2.2fr 1fr'),
    })}`;
}
