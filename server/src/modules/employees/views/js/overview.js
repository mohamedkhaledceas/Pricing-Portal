import { $, escapeHtml, fmtDate, fmtDateTime, skeletonBlock } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel, availabilityLabel, STATUS_LABELS as REQUEST_STATUS_LABELS } from './leaveTypes.js';
import { switchMainTab } from './main.js';
import { plural, panel, split, colTitle, personRow, list, balancesHtml, loadErrorPanel } from './panels.js';

// Layout follows the panel system in employees.css: an attention list for
// anything the viewer has to act on, then full-width panels whose bodies
// split into columns, then unboxed lists inside those. Every widget below
// renders into one of those three levels — none gets a box of its own.

// #ov-content is a static element present from page load (see index.html)
// — its innerHTML gets replaced on every render, but the element itself
// never does, so one delegated listener bound here (via bindOverviewUi,
// called once at app init) keeps working across every future re-render.
// Replaces onclick="switchMainTab(...)" attributes, which the CSP's
// script-src-attr 'none' silently blocks — confirmed live (2026-09-28):
// calling switchMainTab directly via JS worked, but clicking the actual
// rendered button did nothing at all, no console error.
export function bindOverviewUi() {
  const container = $('#ov-content');
  if (!container) return;
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-ov-retry]')) { renderOverview(); return; }
    const btn = e.target.closest('[data-goto-tab]');
    if (!btn) return;
    const tab = btn.dataset.gotoTab;
    switchMainTab(tab, { kpiView: btn.dataset.gotoKpiView });
  });
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// SQLite's CURRENT_TIMESTAMP (used for leave_requests.created_at) is UTC
// text shaped "YYYY-MM-DD HH:MM:SS" with no timezone marker — parsing that
// with `new Date(...)` is host-timezone-dependent (see
// refreshTokenRepository.findRecentlyRevoked's comment for the same
// gotcha). Comparing against a freshly-*formatted* (never parsed) cutoff of
// the same shape sidesteps it entirely, since zero-padded ISO-like strings
// sort lexicographically the same as chronologically.
function isoCutoff(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function gotoButton(tab, label, extra) {
  return `<button class="small" data-goto-tab="${tab}"${extra || ''}>${escapeHtml(label)}</button>`;
}

function renderSkeleton(panelCount) {
  $('#ov-content').innerHTML = `<div class="stack">${Array.from({ length: panelCount }, () => `
    <section class="panel"><div class="panel-head">${skeletonBlock('140px', '18px')}</div>
      <div class="panel-body">${skeletonBlock('70%', '14px')}<div class="mt-8"></div>${skeletonBlock('45%', '14px')}</div>
    </section>`).join('')}</div>`;
}

function renderLoadError(err) {
  $('#ov-content').innerHTML = loadErrorPanel('Overview couldn’t load', err, 'data-ov-retry');
}

function renderNoProfile() {
  $('#ov-content').innerHTML = `
    <section class="panel"><div class="panel-body">
      <div style="font-weight:650;margin-bottom:4px;">You don't have an employee profile yet</div>
      <div class="muted">Time Off and KPI tracking need a completed employee record. Contact People &amp; Culture to get set up.</div>
    </div></section>`;
}

// ── Level 1: attention ──────────────────────────────────────────────────

function attnRow({ count, text, sub, action, warn }) {
  return `<div class="attn-row${warn ? ' is-warn' : ''}">
    <div class="attn-count">${count}</div>
    <div class="attn-text">${text}${sub ? `<span class="attn-sub">${sub}</span>` : ''}</div>
    ${action || ''}
  </div>`;
}

// alwaysShow: roles that own an approval queue (CEO, P&C) see a calm
// "nothing waiting" line rather than the section vanishing, so an empty
// queue reads as confirmed-empty instead of possibly-not-loaded.
function attentionSection(rows, alwaysShow) {
  const filled = rows.filter(Boolean);
  if (!filled.length && !alwaysShow) return '';
  return `<section class="attn" aria-label="Needs your attention">
    ${filled.length ? filled.join('') : '<div class="attn-calm">Nothing needs your attention right now.</div>'}
  </section>`;
}

function peerReviewRow(peerReview) {
  if (!(peerReview && peerReview.open && peerReview.submitted < peerReview.expected)) return '';
  return attnRow({
    warn: true,
    count: peerReview.expected - peerReview.submitted,
    text: 'Team reviews are open and yours isn’t submitted',
    sub: `${peerReview.submitted} of ${peerReview.expected} reviews done`,
    action: gotoButton('kpi', 'Open team reviews', ' data-goto-kpi-view="peerReview"'),
  });
}

// A decision is always scoped to actual direct reports, for every role
// including the company-wide `ceo` role — see team.js's own
// isMyDirectReport for the same rule applied to the actionable list itself;
// this just keeps the count consistent with what My Team will actually let
// this account act on. Role-agnostic on purpose: any employee can end up
// with direct reports via manager_employee_id regardless of auth role.
function pendingMyDecisionRow(teamRequests, directory, myEmployeeId) {
  const directoryById = {};
  directory.forEach((e) => { directoryById[e.id] = e; });
  const myPending = teamRequests.filter((r) => {
    const target = directoryById[r.employeeId];
    return r.status === 'pending' && !!target && !!myEmployeeId && target.managerEmployeeId === myEmployeeId;
  });
  if (!myPending.length) return '';
  return attnRow({
    count: myPending.length,
    text: `Leave ${plural(myPending.length, 'request', 'requests')} waiting for your decision`,
    sub: 'From your direct reports',
    action: gotoButton('requests', 'Review requests'),
  });
}

// Summary + link only, not a second copy of the actual confirm/edit UI —
// these point at requestsCenter.js's existing P&C queue (pcConfirm) and roster.js's
// existing kpiProfile editor. Both fetches reuse endpoints already gated
// server-side for people_culture; nothing new to authorize here.
function pcConfirmRow(pending) {
  if (!pending.length) return '';
  return attnRow({
    count: pending.length,
    text: `Manager-approved ${plural(pending.length, 'request', 'requests')} waiting for P&C confirmation`,
    sub: `Oldest submitted ${fmtDateTime(pending[0].createdAt)}`,
    action: gotoButton('requests', 'Open confirmation queue'),
  });
}

function pcKpiSetupRow(roster) {
  const missingKpi = roster.filter((e) => e.active && !e.kpiProfile).length;
  if (!missingKpi) return '';
  return attnRow({
    count: missingKpi,
    text: `Active ${plural(missingKpi, 'employee has', 'employees have')} no KPI profile`,
    sub: 'They can’t be scored until one is assigned',
    action: gotoButton('roster', 'Assign in Roster'),
  });
}

// P&C only — flags accounts where login access (users.is_active) and
// employment status (employees.active) disagree, e.g. someone offboarded
// whose login was never revoked, or a reactivated employee whose account is
// still disabled. Both fields already ride along on every /api/employees
// row (employeeModel.toEmployee) — no new endpoint.
function pcStatusMismatchRow(roster) {
  const mismatched = roster.filter((e) => e.isAccountActive !== e.active).length;
  if (!mismatched) return '';
  return attnRow({
    warn: true,
    count: mismatched,
    text: `${plural(mismatched, 'Account has', 'Accounts have')} login access that doesn’t match employment status`,
    sub: 'Usually an incomplete offboarding or reactivation',
    action: gotoButton('roster', 'Review in Roster'),
  });
}

// ── Level 2: panels ─────────────────────────────────────────────────────

function recentRequestRow(r) {
  const dates = fmtDate(r.startDate) + (r.endDate !== r.startDate ? ' – ' + fmtDate(r.endDate) : '');
  return `<li class="list-row">
    <div class="list-main">
      <div class="list-title">${escapeHtml(leaveTypeLabel(r.leaveType))}</div>
      <div class="list-meta">${dates}</div>
    </div>
    <span class="badge badge-${escapeHtml(r.status)}">${escapeHtml(REQUEST_STATUS_LABELS[r.status] || r.status)}</span>
  </li>`;
}

function timeOffPanel(requests, balances) {
  const counts = { approved: 0, pending: 0, rejected: 0 };
  requests.forEach((r) => {
    if (r.status === 'approved') counts.approved += 1;
    else if (r.status === 'pending' || r.status === 'manager_approved') counts.pending += 1;
    else if (r.status === 'rejected' || r.status === 'auto_rejected') counts.rejected += 1;
  });
  const recent = requests.slice(0, 5);
  return panel({
    title: 'Your time off',
    actions: gotoButton('requests', 'All requests') + gotoButton('timeoff', 'New request'),
    body: split([
      { html: colTitle('Balance remaining') + balancesHtml(balances) },
      { html: colTitle('Your requests')
          + `<div class="count-row"><span><strong>${counts.approved}</strong>approved</span><span><strong>${counts.pending}</strong>pending</span><span><strong>${counts.rejected}</strong>rejected</span></div>`
          + list(recent.map(recentRequestRow), 'You haven’t made any requests yet.') },
    ], '1.15fr 1fr'),
  });
}

const BREAKDOWN_LABELS = {
  pending: 'Pending', manager_approved: 'Manager-approved', approved: 'Approved',
  rejected: 'Rejected', auto_rejected: 'Auto-rejected', cancelled: 'Cancelled',
};

// Shared by manager and P&C — both already have `roster` fetched, so this
// is pure client-side grouping, no new endpoint.
function departmentHeadcountHtml(roster) {
  const counts = {};
  roster.filter((e) => e.active).forEach((e) => {
    const dept = e.department || 'Unassigned';
    counts[dept] = (counts[dept] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 0;
  if (!entries.length) return '<div class="list-empty">No active employees.</div>';
  return entries.map(([dept, n]) => `
    <div class="dept-row">
      <div class="dept-row-label">${escapeHtml(dept)}</div>
      <div class="dept-bar-track"><div class="dept-bar-fill" style="width:${max ? Math.round((n / max) * 100) : 0}%;"></div></div>
      <div class="dept-row-count">${n}</div>
    </div>`).join('');
}

function metric(value, label) {
  return `<div><div class="metric-value">${value}</div><div class="metric-label">${escapeHtml(label)}</div></div>`;
}

// CEO sees the company-wide status shape (requests are already fetched
// company-wide for 'ceo' via listTeam — see timeOffService.listTeam), CEO
// and P&C see policy auto-rejects; manager (company-wide via listTeam) and
// P&C (dedicated /leave-requests/auto-rejected endpoint, since
// listPcPending only ever surfaces manager_approved rows) feed autoRejects.
function companyPanel({ roster, showHeadcount, statusRequests, autoRejects }) {
  const active = roster.filter((e) => e.active).length;
  const metrics = [metric(active, 'Active employees'), metric(roster.length - active, 'Inactive')];
  if (autoRejects) {
    const cutoff = isoCutoff(30);
    metrics.push(metric(autoRejects.filter((r) => r.status === 'auto_rejected' && r.createdAt >= cutoff).length, 'Policy auto-rejects, last 30 days'));
  }
  let left = colTitle('People') + `<div class="metric-grid">${metrics.join('')}</div>`;
  if (statusRequests) {
    const counts = {};
    statusRequests.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const rows = Object.keys(BREAKDOWN_LABELS).filter((s) => counts[s]).map((s) => `<li class="list-row">
        <div class="list-main"><div class="list-title" style="font-weight:400;">${escapeHtml(BREAKDOWN_LABELS[s])}</div></div>
        <span class="metric-value" style="font-size:15px;">${counts[s]}</span>
      </li>`);
    left += colTitle('Leave requests, company-wide') + list(rows, 'No requests yet.');
  }
  const cols = [{ html: left }];
  if (showHeadcount) cols.push({ html: colTitle('Headcount by department') + departmentHeadcountHtml(roster) });
  return panel({
    title: 'Company',
    actions: gotoButton('roster', 'Manage roster'),
    body: cols.length > 1 ? split(cols) : `<div class="panel-body">${left}</div>`,
  });
}

// ── Team today ──────────────────────────────────────────────────────────

// partnerIds: Set of employee ids that are the viewer's own active
// conflict partner(s) (from GET /employees/conflict-pairs/mine) — passive
// highlighting only, computed client-side against data already being
// fetched for this same widget; no per-entry backend flag needed.
function offTodayHtml(offToday, partnerIds) {
  const rows = offToday.map((o) => {
    const isPartner = !!(partnerIds && partnerIds.has(o.employeeId));
    const meta = [leaveTypeLabel(o.leaveType), o.availability ? availabilityLabel(o.availability) : null, o.department].filter(Boolean).map(escapeHtml).join(', ');
    return personRow(o.name, meta, { flagged: isPartner, flag: isPartner ? 'Your conflict pair' : '' });
  });
  return colTitle('Off today', escapeHtml(fmtDate(todayIso()))) + list(rows, 'Nobody is off today.');
}

// Approved-only, name + date range — nothing else (no leave type, no
// reason). Backed by timeOffService.listUpcomingTeamLeave, which is
// already scoped server-side to the viewer's own team (teamMembership's
// direct-reports-union-department definition) and to today-or-later, so
// this just renders whatever comes back.
function upcomingLeaveHtml(upcoming) {
  const rows = upcoming.map((u) => personRow(u.name, u.startDate === u.endDate ? fmtDate(u.startDate) : `${fmtDate(u.startDate)} – ${fmtDate(u.endDate)}`));
  return colTitle('Coming up') + list(rows, 'No approved leave coming up for your team.');
}

// online comes from the directory endpoint (open to any authenticated
// employee — see rosterService.listDirectory) so this works the same for a
// plain employee and for manager/admin/P&C's no-profile company-wide
// view. "Online" itself is real-time Socket.IO presence (see
// common/realtime) — kept fresh between full re-renders via
// applyPresenceChange below, which swaps just this column's innerHTML.
function whosOnlineHtml(directory) {
  const online = directory.filter((e) => e.online);
  const rows = online.map((e) => personRow(`${e.firstName} ${e.lastName}`, e.department ? escapeHtml(e.department) : '', { online: true }));
  return colTitle('Online now', `${online.length} of ${directory.length}`) + list(rows, 'Nobody is online right now.', 'list-cols');
}

// Pure client-side aggregate over the same directory fetch — status is
// already decorated server-side to 'active' | 'remote' | 'on_leave'
// (rosterService.decorateStatusList cross-references today's approved
// leave), so no new endpoint or per-employee lookup is needed here.
function availabilitySummary(directory) {
  const counts = { active: 0, remote: 0, on_leave: 0 };
  directory.forEach((e) => { if (counts[e.status] !== undefined) counts[e.status] += 1; });
  return `${counts.active} working, ${counts.remote} remote, ${counts.on_leave} on leave`;
}

function teamTodayPanel({ directory, offToday, partnerIds, upcoming }) {
  const left = offTodayHtml(offToday, partnerIds) + (upcoming ? upcomingLeaveHtml(upcoming) : '');
  return panel({
    title: 'Team today',
    meta: availabilitySummary(directory),
    body: split([{ html: left }, { id: 'whosOnlineCard', html: whosOnlineHtml(directory) }], '1fr 1.4fr'),
  });
}

// Cache of the last-fetched directory, kept only so a live presence event
// (see realtime.js) can patch a single entry's `online` flag and re-render
// just the Online column — without it, every presence change would need a
// fresh /api/employees/directory fetch (or a full renderOverview() re-run)
// just to know everyone else's current department/name again, which a
// live push event has no reason to need. Deliberately not exported.
let cachedDirectory = null;

// Called by realtime.js on every 'presence:change' push. No-ops quietly if
// Overview hasn't been rendered yet (cachedDirectory is null) or isn't the
// currently-visible tab (#whosOnlineCard not in the DOM) — either way
// there's nothing to patch, and the next real renderOverview() call will
// fetch fresh data anyway.
export function applyPresenceChange(userId, online) {
  if (!cachedDirectory) return;
  const entry = cachedDirectory.find((e) => e.userId === userId);
  if (!entry || entry.online === online) return;
  entry.online = online;
  const col = document.getElementById('whosOnlineCard');
  if (col) col.innerHTML = whosOnlineHtml(cachedDirectory);
}

// manager (the CEO's account), admin (the developer's own escape-hatch
// role, strictly more privileged than manager), and people_culture all get
// company-wide visibility even without a roster record of their own —
// unlike a plain employee, who genuinely has nothing to show until P&C
// onboards them. Built from existing pieces only: off-today is already
// role-agnostic, and the roster list is reachable to all three roles via
// rosterService.canManageRoster.
const COMPANY_OVERVIEW_ROLES = { ceo: 'CEO', admin: 'Admin', people_culture: 'People & Culture' };

function contextLine(parts) {
  return `<div class="context-line">${parts.filter(Boolean).join('')}</div>`;
}

async function renderManagerOverview(role) {
  const container = $('#ov-content');
  const isPeopleCulture = role === 'people_culture';
  const isManager = role === 'ceo';
  renderSkeleton(2);

  const [rosterRes, offTodayRes, pendingRes, directoryRes, teamRes, autoRejectRes] = await Promise.all([
    apiFetch('/api/employees'),
    apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    apiFetch('/api/employees/directory'),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/auto-rejected') : Promise.resolve(null),
  ]);

  const roster = rosterRes.employees || [];
  const directory = directoryRes.employees || [];
  cachedDirectory = directory;
  const teamRequests = teamRes.requests || [];
  // Manager already has every request company-wide via teamRequests
  // (listTeam); P&C needs the dedicated endpoint since listPcPending only
  // ever returns manager_approved rows.
  const autoRejectSource = isManager ? teamRequests : (autoRejectRes ? autoRejectRes.requests || [] : []);

  // No employee profile on this path, so the viewer structurally can't be
  // anyone's direct manager — no "waiting for your decision" row.
  container.innerHTML = `
    ${contextLine([`<span class="badge badge-approved">${escapeHtml(COMPANY_OVERVIEW_ROLES[role])}</span>`, '<span>Company-wide view</span>'])}
    <div class="stack">
      ${attentionSection(isPeopleCulture
        ? [pcConfirmRow(pendingRes.requests || []), pcStatusMismatchRow(roster), pcKpiSetupRow(roster)]
        : [], isManager || isPeopleCulture)}
      ${companyPanel({
        roster,
        showHeadcount: isManager || isPeopleCulture,
        statusRequests: isManager ? teamRequests : null,
        autoRejects: (isManager || isPeopleCulture) ? autoRejectSource : null,
      })}
      ${teamTodayPanel({ directory, offToday: offTodayRes.offToday || [] })}
    </div>`;
}

async function renderEmployeeOverview(emp) {
  const container = $('#ov-content');
  renderSkeleton(3);

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManager = role === 'ceo';
  const [mineRes, balancesRes, offTodayRes, pendingRes, rosterRes, directoryRes, teamRes, autoRejectRes, myPartnersRes, peerReviewStatusRes, upcomingTeamLeaveRes] = await Promise.all([
    apiFetch('/api/employees/leave-requests/mine'),
    apiFetch('/api/employees/leave-requests/balances/mine'),
    apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    (isPeopleCulture || isManager) ? apiFetch('/api/employees') : Promise.resolve(null),
    apiFetch('/api/employees/directory'),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/auto-rejected') : Promise.resolve(null),
    apiFetch('/api/employees/conflict-pairs/mine'),
    apiFetch('/api/employees/kpi/peer-review/my-status').catch(() => null),
    apiFetch('/api/employees/leave-requests/team/upcoming'),
  ]);

  const directory = directoryRes.employees || [];
  cachedDirectory = directory;
  const teamRequests = teamRes.requests || [];
  const roster = rosterRes ? rosterRes.employees || [] : [];
  const autoRejectSource = isManager ? teamRequests : (autoRejectRes ? autoRejectRes.requests || [] : []);

  container.innerHTML = `
    ${contextLine([
      `<span>${escapeHtml(emp.department || 'No department')}</span>`,
      `<span>${emp.kpiProfile ? 'KPI profile: ' + escapeHtml(emp.kpiProfile) : 'No KPI profile assigned'}</span>`,
      isPeopleCulture ? '<span><span class="badge badge-approved">People &amp; Culture</span></span>' : '',
    ])}
    <div class="stack">
      ${attentionSection([
        peerReviewRow(peerReviewStatusRes),
        pendingMyDecisionRow(teamRequests, directory, emp.id),
        isPeopleCulture ? pcConfirmRow(pendingRes.requests || []) : '',
        isPeopleCulture ? pcStatusMismatchRow(roster) : '',
        isPeopleCulture ? pcKpiSetupRow(roster) : '',
      ], isManager || isPeopleCulture)}
      ${timeOffPanel(mineRes.requests || [], balancesRes && balancesRes.balances)}
      ${(isManager || isPeopleCulture) ? companyPanel({
        roster,
        showHeadcount: true,
        statusRequests: isManager ? teamRequests : null,
        autoRejects: autoRejectSource,
      }) : ''}
      ${teamTodayPanel({
        directory,
        offToday: offTodayRes.offToday || [],
        partnerIds: new Set((myPartnersRes.partners || []).map((p) => p.id)),
        upcoming: upcomingTeamLeaveRes.upcoming || [],
      })}
    </div>`;
}

export async function renderOverview() {
  const emp = state.myEmployee;
  const role = state.currentUser && state.currentUser.role;
  if (!emp && !(role && COMPANY_OVERVIEW_ROLES[role])) { renderNoProfile(); return; }
  try {
    if (emp) await renderEmployeeOverview(emp);
    else await renderManagerOverview(role);
  } catch (err) {
    console.error('Overview failed to load', err);
    renderLoadError(err);
  }
}
