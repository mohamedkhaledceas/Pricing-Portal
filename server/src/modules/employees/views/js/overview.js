import { $, escapeHtml, fmtDate, fmtDateTime, skeletonBlock } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel } from './leaveTypes.js';

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

function renderNoProfile() {
  $('#ov-content').innerHTML = `
    <div class="card empty-state">
      <div style="font-weight:650;margin-bottom:4px;">You don't have an employee profile yet</div>
      <div class="muted">Time Off and KPI tracking need a completed employee record. Contact People &amp; Culture to get set up.</div>
    </div>`;
}

function statCard(title, body) {
  return `<div class="stat-card">
    <div class="stat-card-title">${escapeHtml(title)}</div>
    ${body}
  </div>`;
}

// Shared by "Who's Off Today" and "Who's Online" — same tile grid shape,
// just a different item renderer and empty message.
function tileGrid(tilesHtml, emptyMessage) {
  return `<div class="team-grid">${tilesHtml.length
    ? tilesHtml.join('')
    : `<div class="empty-state" style="grid-column:1/-1;padding:18px;">${escapeHtml(emptyMessage)}</div>`}</div>`;
}

function offTodayTile(o) {
  return `<div class="team-tile">
    <div class="team-tile-name">${escapeHtml(o.name)}</div>
    <div class="team-tile-meta">${escapeHtml(leaveTypeLabel(o.leaveType))}${o.halfDay ? ' · half-day' : ''}${o.department ? ' · ' + escapeHtml(o.department) : ''}</div>
  </div>`;
}

function onlineTile(e) {
  return `<div class="team-tile">
    <div class="team-tile-name"><span class="presence-dot online"></span>${escapeHtml(e.firstName + ' ' + e.lastName)}</div>
    <div class="team-tile-meta">${e.department ? escapeHtml(e.department) : '—'}</div>
  </div>`;
}

function whosOffTodaySection(offToday) {
  return `
    <div class="card section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="card-title" style="margin-bottom:0;">Who's Off Today</div>
        <div class="small muted">${fmtDate(todayIso())}</div>
      </div>
      ${tileGrid(offToday.map(offTodayTile), "Nobody's off today")}
    </div>`;
}

// online/lastSeenAt come from the directory endpoint (open to any
// authenticated employee — see rosterService.listDirectory) so this widget
// works the same for a plain employee and for manager/admin/P&C's
// no-profile company-wide view. "Online" itself is last_seen_at within 5
// minutes, computed in SQL by employeeRepository (see its SELECT_WITH_USER
// comment) — there's no heartbeat ping, so it really means "made an API
// call recently," which for an internal tool with no idle screen is a
// reasonable proxy for "has the app open right now."
function whosOnlineSection(directory) {
  const online = directory.filter((e) => e.online);
  const offlineCount = directory.length - online.length;
  return `
    <div class="card section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div class="card-title" style="margin-bottom:0;">Who's Online</div>
        <div class="small muted">${online.length} online · ${offlineCount} offline</div>
      </div>
      ${tileGrid(online.map(onlineTile), 'Nobody is online right now')}
    </div>`;
}

const STATUS_LABELS = {
  pending: 'Pending', manager_approved: 'Manager-Approved', approved: 'Approved',
  rejected: 'Rejected', auto_rejected: 'Auto-Rejected', cancelled: 'Cancelled',
};

// Manager-only — company-wide status shape, not just the raw pending count
// already shown elsewhere. Requests are already fetched company-wide for
// 'manager' via listTeam (see timeOffService.listTeam), so this is a pure
// client-side group-by, no new endpoint.
function statusBreakdownCard(requests) {
  const counts = {};
  requests.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const rows = Object.keys(STATUS_LABELS)
    .filter((status) => counts[status])
    .map((status) => `<div class="stat-row"><span class="stat-num" style="font-size:18px;">${counts[status]}</span><span class="stat-lbl">${escapeHtml(STATUS_LABELS[status])}</span></div>`)
    .join('');
  return statCard('Leave Requests (company-wide)', rows || `<div class="muted small mt-8">No requests yet</div>`);
}

// Shared by manager (company-wide via listTeam) and P&C (dedicated
// /leave-requests/auto-rejected endpoint, since listPcPending only ever
// surfaces manager_approved rows — auto-rejects never reach that stage).
function autoRejectAlertCard(requests) {
  const cutoff = isoCutoff(30);
  const recent = requests.filter((r) => r.status === 'auto_rejected' && r.createdAt >= cutoff);
  return statCard('Policy Auto-Rejects (last 30 days)', recent.length
    ? `<div class="stat-row mt-8">
        <span class="stat-num" style="font-size:22px;">${recent.length}</span><span class="stat-lbl">auto-rejected</span>
      </div>
      <div class="muted small mt-8">Notice-window or WFH-quota violations, caught automatically at submission.</div>`
    : `<div class="muted small mt-8">No policy auto-rejects in the last 30 days</div>`);
}

// Shared by manager and P&C — both already have `roster` fetched for their
// existing widgets (Company Roster / KPI Setup), so this is pure client-side
// grouping, no new endpoint.
function departmentBreakdownSection(roster) {
  const counts = {};
  roster.filter((e) => e.active).forEach((e) => {
    const dept = e.department || 'Unassigned';
    counts[dept] = (counts[dept] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = entries.length ? entries[0][1] : 0;
  const rows = entries.map(([dept, n]) => `
    <div class="dept-row">
      <div class="dept-row-label">${escapeHtml(dept)}</div>
      <div class="dept-bar-track"><div class="dept-bar-fill" style="width:${max ? Math.round((n / max) * 100) : 0}%;"></div></div>
      <div class="dept-row-count">${n}</div>
    </div>`).join('');
  return `
    <div class="card section">
      <div class="card-title">Department Headcount</div>
      ${rows || `<div class="empty-state">No active employees</div>`}
    </div>`;
}

// P&C only — flags accounts where login access (users.is_active) and
// employment status (employees.active) disagree, e.g. someone offboarded
// whose login was never revoked, or a reactivated employee whose account is
// still disabled. Both fields already ride along on every /api/employees
// row (employeeModel.toEmployee) — no new endpoint.
function statusMismatchCard(roster) {
  const mismatched = roster.filter((e) => e.isAccountActive !== e.active);
  return statCard('Login / Employment Status Mismatch', mismatched.length
    ? `<div class="stat-row mt-8">
        <span class="stat-num" style="font-size:22px;">${mismatched.length}</span><span class="stat-lbl">accounts to review</span>
      </div>
      <div class="muted small mt-8">Employment status and login access disagree — likely an incomplete offboarding or reactivation.</div>
      <div class="mt-8">
        <button onclick="switchMainTab('roster', document.getElementById('maintab-roster'))"
          style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">
          Review Roster →
        </button>
      </div>`
    : `<div class="muted small mt-8">Login access matches employment status for everyone</div>`);
}

// manager (the CEO's account), admin (the developer's own escape-hatch
// role, strictly more privileged than manager), and people_culture all get
// company-wide visibility even without a roster record of their own —
// unlike a plain employee, who genuinely has nothing to show until P&C
// onboards them. Built from existing pieces only: off-today is already
// role-agnostic, and the roster list is reachable to all three roles via
// rosterService.canManageRoster.
const COMPANY_OVERVIEW_ROLES = { manager: 'Manager (CEO)', admin: 'Admin', people_culture: 'People & Culture' };

// Own-queue widget for whoever a request is actually waiting on right now —
// role-agnostic on purpose: any employee can end up with direct reports via
// manager_employee_id regardless of their auth role, and 'manager' role
// always gets it shown (even at 0) the same way P&C's action card always
// shows. Reuses /api/employees/leave-requests/team, which now returns []
// instead of 403 when the viewer has no employee profile of their own.
function pendingMyDecisionCard(teamRequests, role) {
  const myPending = teamRequests.filter((r) => r.status === 'pending');
  if (!myPending.length && !teamRequests.length && role !== 'manager') return '';
  const title = role === 'manager' ? 'Pending My Decision (company-wide)' : 'Pending My Decision';
  return statCard(title, myPending.length
    ? `<div class="stat-row mt-8">
        <span class="stat-num" style="font-size:22px;">${myPending.length}</span><span class="stat-lbl">awaiting your decision</span>
      </div>
      <div class="mt-8">
        <button onclick="switchMainTab('team', document.getElementById('maintab-team'))"
          style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">
          Go to Team →
        </button>
      </div>`
    : `<div class="muted small mt-8">No pending requests</div>`);
}

async function renderManagerOverview(role) {
  const container = $('#ov-content');
  const isPeopleCulture = role === 'people_culture';
  container.innerHTML = `<div class="cards-row section">${Array.from({ length: 2 }, () => statCard('', skeletonBlock('60%', '30px'))).join('')}</div>`;

  const isManager = role === 'manager';
  const [rosterRes, offTodayRes, pendingRes, directoryRes, teamRes, autoRejectRes] = await Promise.all([
    apiFetch('/api/employees'),
    apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    apiFetch('/api/employees/directory'),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/auto-rejected') : Promise.resolve(null),
  ]);

  const roster = rosterRes.employees || [];
  const active = roster.filter((e) => e.active).length;
  const inactive = roster.length - active;
  const directory = directoryRes.employees || [];
  const teamRequests = teamRes.requests || [];
  const myDecisionCard = pendingMyDecisionCard(teamRequests, role);
  // Manager already has every request company-wide via teamRequests
  // (listTeam); P&C needs the dedicated endpoint since listPcPending only
  // ever returns manager_approved rows.
  const autoRejectSource = isManager ? teamRequests : (autoRejectRes ? autoRejectRes.requests || [] : []);

  container.innerHTML = `
    <div class="cards-row section">
      ${statCard('Company Roster', `
        <div class="stat-row mt-8">
          <span class="stat-num" style="font-size:22px;">${active}</span><span class="stat-lbl">Active</span>
        </div>
        <div class="stat-row">
          <span class="stat-num" style="font-size:22px;">${inactive}</span><span class="stat-lbl">Inactive</span>
        </div>
        <div class="mt-8">
          <button onclick="switchMainTab('roster', document.getElementById('maintab-roster'))"
            style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">
            Manage Roster →
          </button>
        </div>`)}
      ${statCard('Reporting', `<div class="mt-8"><span class="badge badge-approved">${escapeHtml(COMPANY_OVERVIEW_ROLES[role])}</span></div>`)}
      ${myDecisionCard}
      ${isManager ? statusBreakdownCard(teamRequests) : ''}
      ${isManager || isPeopleCulture ? autoRejectAlertCard(autoRejectSource) : ''}
      ${isPeopleCulture ? statusMismatchCard(roster) : ''}
    </div>

    ${isPeopleCulture ? pcActionCards(pendingRes.requests || [], roster) : ''}

    ${(isManager || isPeopleCulture) ? departmentBreakdownSection(roster) : ''}
    ${whosOnlineSection(directory)}
    ${whosOffTodaySection(offTodayRes.offToday || [])}
  `;
}

// Summary + link only, not a second copy of the actual confirm/edit UI —
// "Pending Your Confirmation" points at team.js's existing P&C queue
// (pcConfirm), "KPI Setup" points at roster.js's existing kpiProfile
// editor. Both fetches reuse endpoints already gated server-side for
// people_culture; nothing new to authorize here.
function pcActionCards(pending, roster) {
  const missingKpi = roster.filter((e) => e.active && !e.kpiProfile).length;

  return `
    <div class="cards-row section">
      ${statCard('Pending Your Confirmation', pending.length
        ? `<div class="stat-row mt-8">
            <span class="stat-num" style="font-size:22px;">${pending.length}</span><span class="stat-lbl">awaiting confirmation</span>
          </div>
          <div class="muted small mt-8">Oldest: ${fmtDateTime(pending[0].createdAt)}</div>
          <div class="mt-8">
            <button onclick="switchMainTab('team', document.getElementById('maintab-team'))"
              style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">
              Go to Queue →
            </button>
          </div>`
        : `<div class="muted small mt-8">All caught up</div>`)}
      ${statCard('KPI Setup', missingKpi
        ? `<div class="stat-row mt-8">
            <span class="stat-num" style="font-size:22px;">${missingKpi}</span><span class="stat-lbl">missing a KPI profile</span>
          </div>
          <div class="mt-8">
            <button onclick="switchMainTab('roster', document.getElementById('maintab-roster'))"
              style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;">
              Manage Roster →
            </button>
          </div>`
        : `<div class="muted small mt-8">All employees have a KPI profile</div>`)}
    </div>`;
}

export async function renderOverview() {
  const container = $('#ov-content');
  const emp = state.myEmployee;
  if (!emp) {
    const role = state.currentUser && state.currentUser.role;
    if (role && COMPANY_OVERVIEW_ROLES[role]) { await renderManagerOverview(role); return; }
    renderNoProfile();
    return;
  }

  container.innerHTML = `<div class="cards-row section">${Array.from({ length: 3 }, () => statCard('', skeletonBlock('60%', '30px'))).join('')}</div>`;

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManager = role === 'manager';
  const [mineRes, offTodayRes, pendingRes, rosterRes, directoryRes, teamRes, autoRejectRes] = await Promise.all([
    apiFetch('/api/employees/leave-requests/mine'),
    apiFetch('/api/employees/leave-requests/off-today?date=' + todayIso()),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    (isPeopleCulture || isManager) ? apiFetch('/api/employees') : Promise.resolve(null),
    apiFetch('/api/employees/directory'),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/auto-rejected') : Promise.resolve(null),
  ]);

  const requests = mineRes.requests || [];
  const counts = { approved: 0, pending: 0, rejected: 0 };
  requests.forEach((r) => {
    if (r.status === 'approved') counts.approved += 1;
    else if (r.status === 'pending' || r.status === 'manager_approved') counts.pending += 1;
    else if (r.status === 'rejected' || r.status === 'auto_rejected') counts.rejected += 1;
  });

  const directory = directoryRes.employees || [];
  const teamRequests = teamRes.requests || [];
  const myDecisionCard = pendingMyDecisionCard(teamRequests, role);
  const roster = rosterRes ? rosterRes.employees || [] : [];
  const autoRejectSource = isManager ? teamRequests : (autoRejectRes ? autoRejectRes.requests || [] : []);

  container.innerHTML = `
    <div class="cards-row section">
      ${statCard('My Requests', `
        <div class="stat-row mt-8">
          <span class="stat-num" style="font-size:22px;">${counts.approved}</span><span class="stat-lbl">Approved</span>
        </div>
        <div class="stat-row">
          <span class="stat-num" style="font-size:22px;">${counts.pending}</span><span class="stat-lbl">Pending</span>
        </div>
        <div class="stat-row">
          <span class="stat-num" style="font-size:22px;">${counts.rejected}</span><span class="stat-lbl">Rejected</span>
        </div>`)}
      ${statCard('Department', `<div class="mt-8" style="font-weight:650;">${escapeHtml(emp.department || '—')}</div>
        <div class="muted small mt-8">${emp.kpiProfile ? 'KPI profile: ' + escapeHtml(emp.kpiProfile) : 'No KPI profile assigned'}</div>`)}
      ${statCard('Reporting', `<div class="mt-8">${isPeopleCulture ? '<span class="badge badge-approved">People &amp; Culture</span>' : '<span class="badge badge-neutral">Team member</span>'}</div>`)}
      ${myDecisionCard}
      ${isManager ? statusBreakdownCard(teamRequests) : ''}
      ${isManager || isPeopleCulture ? autoRejectAlertCard(autoRejectSource) : ''}
      ${isPeopleCulture ? statusMismatchCard(roster) : ''}
    </div>

    ${isPeopleCulture ? pcActionCards(pendingRes.requests || [], roster) : ''}

    ${(isManager || isPeopleCulture) ? departmentBreakdownSection(roster) : ''}
    ${whosOnlineSection(directory)}
    ${whosOffTodaySection(offTodayRes.offToday || [])}

    <div class="card section">
      <div class="card-title">Recent Requests</div>
      ${requests.slice(0, 5).length ? `
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Type</th><th>Dates</th><th>Status</th></tr></thead>
            <tbody>
              ${requests.slice(0, 5).map((r) => `<tr>
                <td>${escapeHtml(leaveTypeLabel(r.leaveType))}</td>
                <td>${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ' → ' + fmtDate(r.endDate) : ''}</td>
                <td><span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty-state">No requests yet</div>`}
    </div>
  `;
}
