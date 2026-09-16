import { $, escapeHtml, fmtDate, fmtDateTime, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { leaveTypeLabel, availabilityLabel, STATUS_LABELS } from './leaveTypes.js';

let directoryById = {};
async function loadDirectoryIndex() {
  const res = await apiFetch('/api/employees/directory');
  const employees = res.employees || [];
  directoryById = {};
  employees.forEach((e) => { directoryById[e.id] = e; });
  return employees;
}
function nameFor(employeeId) {
  const e = directoryById[employeeId];
  return e ? `${e.firstName} ${e.lastName}` : `Employee #${employeeId}`;
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

// r.conflictWarnings comes attached from the backend (timeOffService's
// withConflictWarnings, see timeOffService.js) — warn-only, never blocks
// anything; this just labels the card so a manager can see it before
// deciding.
function conflictWarningHtml(r) {
  if (!r.conflictWarnings || !r.conflictWarnings.length) return '';
  return r.conflictWarnings.map((w) => `
    <div class="request-card-conflict">
      ⚠ Conflict pair ${escapeHtml(w.partnerName)}: ${escapeHtml((STATUS_LABELS[w.status] || w.status).toLowerCase())}
      ${escapeHtml(leaveTypeLabel(w.leaveType))} ${fmtDate(w.startDate)}${w.endDate !== w.startDate ? ' → ' + fmtDate(w.endDate) : ''}
    </div>`).join('');
}

// A skip-the-manager-stage auto-route (see timeOffService.submit) is a
// manager_approved request with no human approver — the only case where
// that status pairs a null managerDecisionBy with a note. Flags it for
// P&C so "why is this already at my queue with no manager decision" is
// answered on the card itself, not left implicit.
function noManagerFlagHtml(r) {
  if (r.status !== 'manager_approved' || r.managerDecisionBy || !r.managerDecisionNote) return '';
  return `<div class="request-card-conflict">⚠ ${escapeHtml(r.managerDecisionNote)}</div>`;
}

// P&C-only warning (see timeOffService.listPcPending's wfhSubmittedLate
// flag / timeOffRules.isWfhLateSameDaySubmission) — a WFH request for today,
// submitted at/after 9:00 AM, isn't auto-rejected, but P&C needs to see it
// flagged so they can apply a deduction via their existing dropdown
// (pcActions). Passed in per-call (extraWarningHtml below) rather than
// computed unconditionally in requestCard, since this same card renderer is
// shared with the manager's queue, which doesn't set deductions and
// shouldn't show it.
function lateWfhWarningHtml(r) {
  if (!r.wfhSubmittedLate) return '';
  return `<div class="request-card-conflict">⚠ Submitted at ${escapeHtml(fmtDateTime(r.createdAt))} — after 9:00 AM for a same-day WFH request. A deduction should be applied.</div>`;
}

// P&C-only context (see timeOffService.listPcPending's leaveTypeUsage) —
// the requester's own current standing for the SPECIFIC leave type this
// request is for, not a fixed sick+unpaid pair regardless of type. Capped
// types (planned/combined/wfh/excuse) show "used/total"; sick/unpaid show
// just a running "taken" count, since they have no cap; null (public
// holiday) shows nothing. Same reasoning lateWfhWarningHtml above only
// applies to the P&C card, not the shared manager queue.
function leaveTypeUsageHtml(r) {
  const u = r.leaveTypeUsage;
  if (!u) return '';
  const unitSuffix = u.unit === 'hours' ? 'h' : '';
  const periodText = u.period === 'month' ? 'this month' : 'this year';
  const text = u.total != null
    ? `${escapeHtml(u.label)}: ${escapeHtml(String(u.used))}/${escapeHtml(String(u.total))}${unitSuffix} used ${periodText}`
    : `${escapeHtml(u.label)} taken ${periodText}: ${escapeHtml(String(u.used))} day${u.used === 1 ? '' : 's'}`;
  return `<div class="request-card-meta">${text}</div>`;
}

function requestCard(r, actionsHtml, extraWarningHtml) {
  return `<div class="request-card" id="team-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(nameFor(r.employeeId))}</div>
        <div class="request-card-meta">${escapeHtml(leaveTypeLabel(r.leaveType))} · ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ' → ' + fmtDate(r.endDate) : ''}${r.availability ? ' (' + escapeHtml(availabilityLabel(r.availability)) + ')' : (r.halfDay ? ' (half-day)' : '')}</div>
      </div>
      <span class="badge badge-${r.status}">${escapeHtml(r.status.replace('_', ' '))}</span>
    </div>
    ${r.reason ? `<div class="request-card-reason">${escapeHtml(r.reason)}</div>` : ''}
    ${conflictWarningHtml(r)}
    ${noManagerFlagHtml(r)}
    ${extraWarningHtml || ''}
    ${actionsHtml || ''}
  </div>`;
}

// Native window.confirm()/prompt() blocks the whole tab — a reject comment
// is captured via this same inline reveal-a-form pattern timeOff.js already
// uses for Cancel, not a prompt().
let rejectingId = null;

function askReject(id) {
  rejectingId = id;
  renderTeam();
}
window.askReject = askReject;

function cancelReject() {
  rejectingId = null;
  renderTeam();
}
window.cancelReject = cancelReject;

async function managerDecide(id, decision, btn) {
  const card = $('#team-card-' + id);
  let decisionNote;
  if (decision === 'rejected') {
    decisionNote = (card && card.querySelector('.reject-note') ? card.querySelector('.reject-note').value : '').trim();
    if (!decisionNote) {
      toast('A comment is required to reject.', 'danger');
      return;
    }
  }
  btn.closest('.request-card-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/manager-decision`, { method: 'PATCH', body: JSON.stringify({ decision, decisionNote }) });
    toast(decision === 'approved' ? 'Approved' : 'Rejected', 'info');
    rejectingId = null;
    renderTeam();
  } catch (err) {
    toast(err.message, 'danger');
    renderTeam();
  }
}
window.managerDecide = managerDecide;

async function pcConfirm(id, decision) {
  const card = $('#team-card-' + id);
  const deductionSel = card ? card.querySelector('.pc-deduction') : null;
  const salaryDeduction = deductionSel ? deductionSel.value : 'none';
  const unpaidInput = card ? card.querySelector('.pc-unpaid-days') : null;
  const doctorNoteCheckbox = card ? card.querySelector('.pc-doctor-note') : null;
  const doctorNoteProvided = doctorNoteCheckbox ? doctorNoteCheckbox.checked : undefined;
  let decisionNote;
  if (decision === 'rejected') {
    decisionNote = (card && card.querySelector('.reject-note') ? card.querySelector('.reject-note').value : '').trim();
    if (!decisionNote) {
      toast('A comment is required to reject.', 'danger');
      return;
    }
  }
  try {
    await apiFetch(`/api/employees/leave-requests/${id}/pc-confirm`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, decisionNote, salaryDeduction, unpaidDaysCount: unpaidInput ? Number(unpaidInput.value) || undefined : undefined, doctorNoteProvided }),
    });
    toast(decision === 'approved' ? 'Confirmed' : 'Rejected', 'info');
    rejectingId = null;
    renderTeam();
  } catch (err) {
    toast(err.message, 'danger');
  }
}
window.pcConfirm = pcConfirm;

function rejectNoteForm(id, confirmOnclick) {
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    <textarea class="form-control reject-note" placeholder="Reason for rejecting (required)" rows="2" style="width:100%;"></textarea>
    <button class="btn danger small" onclick="${confirmOnclick}">Confirm Reject</button>
    <button class="btn small" onclick="cancelReject()">Cancel</button>
  </div>`;
}

function managerActions(r) {
  if (r.status !== 'pending') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, `managerDecide(${r.id},'rejected',this)`);
  return `<div class="request-card-actions">
    <button class="btn primary small" onclick="managerDecide(${r.id},'approved',this)">✓ Approve</button>
    <button class="btn danger small" onclick="askReject(${r.id})">✕ Reject</button>
  </div>`;
}

// Human-readable labels for the raw field keys stored in a change
// request's JSON diff (see rosterService.updateMine) — same field set as
// Account Settings' Work Details section.
const CHANGE_FIELD_LABELS = {
  jobTitle: 'Job Title',
  department: 'Department',
  employmentType: 'Employment Type',
  joiningDate: 'Joining Date',
  workLocation: 'Work Location',
  managerEmployeeId: 'Manager',
};

function formatChangeValue(field, value) {
  if (field === 'department') return window.Departments.labelFor(value);
  if (field === 'workLocation') return (window.OrgConstants.WORK_LOCATION_LABELS[value] || value);
  if (field === 'employmentType') return (window.OrgConstants.EMPLOYMENT_TYPE_LABELS[value] || value);
  if (field === 'managerEmployeeId') return nameFor(value);
  return value;
}

function changeRequestCard(r) {
  const diffHtml = Object.keys(r.changes).map((field) =>
    `<div>${escapeHtml(CHANGE_FIELD_LABELS[field] || field)}: <strong>${escapeHtml(String(formatChangeValue(field, r.changes[field])))}</strong></div>`
  ).join('');
  return `<div class="request-card" id="change-request-card-${r.id}">
    <div class="request-card-top">
      <div>
        <div class="request-card-name">${escapeHtml(r.employeeName)}</div>
        <div class="request-card-meta">Requested profile change</div>
      </div>
      <span class="badge badge-pending">Pending</span>
    </div>
    <div class="request-card-reason">${diffHtml}</div>
    <div class="request-card-actions">
      <button class="btn primary small" onclick="profileChangeDecide(${r.id},'approve',this)">✓ Approve</button>
      <button class="btn danger small" onclick="profileChangeDecide(${r.id},'reject',this)">✕ Reject</button>
    </div>
  </div>`;
}

async function profileChangeDecide(id, decision, btn) {
  btn.closest('.request-card-actions').querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await apiFetch(`/api/employees/profile-change-requests/${id}/${decision}`, { method: 'PATCH', body: JSON.stringify({}) });
    toast(decision === 'approve' ? 'Approved' : 'Rejected', 'info');
    renderTeam();
  } catch (err) {
    toast(err.message, 'danger');
    renderTeam();
  }
}
window.profileChangeDecide = profileChangeDecide;

// Only sick leave that already requires a note (>2 consecutive working
// days, per timeOffService.listPcPending's requiresDoctorNote flag) gets
// this checkbox — shorter sick leave stays uncapped/free with no decision
// to make here. Unchecked (the default) means "no note" — deducted from
// the combined Emergency/Mental Health/Short-Notice pool once approved;
// checked means the request stays uncapped, same as any other sick leave.
function doctorNoteCheckboxHtml(r) {
  if (r.leaveType !== 'sick' || !r.requiresDoctorNote) return '';
  return `<label class="small" style="display:flex;align-items:center;gap:6px;">
    <input type="checkbox" class="pc-doctor-note"> Doctor's note provided
  </label>`;
}

function pcActions(r) {
  if (r.status !== 'manager_approved') return '';
  if (rejectingId === r.id) return rejectNoteForm(r.id, `pcConfirm(${r.id},'rejected')`);
  return `<div class="request-card-actions" style="flex-wrap:wrap; align-items:center;">
    ${doctorNoteCheckboxHtml(r)}
    <select class="form-control pc-deduction" style="width:auto;">
      <option value="none">No deduction</option>
      <option value="half_day">Half-day deduction</option>
      <option value="full_day">Full-day deduction</option>
      <option value="unpaid">Unpaid</option>
    </select>
    <input type="number" class="form-control pc-unpaid-days" placeholder="Unpaid days" style="width:110px;" min="0">
    <button class="btn primary small" onclick="pcConfirm(${r.id},'approved')">✓ Confirm</button>
    <button class="btn danger small" onclick="askReject(${r.id})">✕ Reject</button>
  </div>`;
}

export async function renderTeam() {
  const container = $('#team-content');
  container.innerHTML = `<div class="empty-state">Loading...</div>`;

  const role = state.currentUser && state.currentUser.role;
  const isPeopleCulture = role === 'people_culture';
  const isManagerRole = role === 'manager';
  const canReviewProfileChanges = role === 'admin' || isManagerRole || isPeopleCulture;

  // All independent reads, fired together — previously sequential (each
  // one only started after the last resolved) despite looking parallel,
  // which measurably slowed this tab down for no reason (see item 13:
  // ~2.5x slower sequentially on localhost alone, and the gap only grows
  // with real network latency). Same shape overview.js's fetches already
  // use correctly: a Promise.resolve(null) placeholder for calls that
  // don't apply to this role, so every branch still destructures cleanly.
  const [, myTeamRes, teamRes, pcRes, changeRes] = await Promise.all([
    loadDirectoryIndex(),
    apiFetch('/api/employees/team/mine'),
    apiFetch('/api/employees/leave-requests/team'),
    isPeopleCulture ? apiFetch('/api/employees/leave-requests/pending') : Promise.resolve(null),
    canReviewProfileChanges ? apiFetch('/api/employees/profile-change-requests') : Promise.resolve(null),
    window.Departments.load(apiFetch),
  ]);

  const sections = [myReportingLineSectionHtml(), myTeamSectionHtml(myTeamRes)].filter(Boolean);
  const teamRequests = teamRes.requests || [];

  // A decision (approve/reject) is always scoped to actual direct reports,
  // for every role including the company-wide `manager` role — that role
  // only gets extra *visibility* (teamRequests itself, company-wide, from
  // listTeam's own bypass), not extra decision power. The backend enforces
  // this too (timeOffService.managerDecision); this filter just keeps the
  // UI from offering an action that would 403.
  const myEmployeeId = state.myEmployee && state.myEmployee.id;
  const isMyDirectReport = (r) => {
    const target = directoryById[r.employeeId];
    return !!target && !!myEmployeeId && target.managerEmployeeId === myEmployeeId;
  };
  const myPending = teamRequests.filter((r) => r.status === 'pending' && isMyDirectReport(r));

  if (teamRequests.length || isPeopleCulture || isManagerRole) {
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending My Decision</div>
        ${myPending.length ? myPending.map((r) => requestCard(r, managerActions(r))).join('') : `<div class="empty-state">No pending requests</div>`}
      </div>
      <div class="card section">
        <div class="card-title">${isManagerRole ? 'All Requests (company-wide)' : "All My Direct Reports' Requests"}</div>
        ${teamRequests.length ? teamRequests.map((r) => requestCard(r)).join('') : `<div class="empty-state">No requests yet</div>`}
      </div>`);
  }

  if (isPeopleCulture) {
    const pcPending = (pcRes && pcRes.requests) || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending P&amp;C Confirmation (company-wide)</div>
        ${pcPending.length ? pcPending.map((r) => requestCard(r, pcActions(r), lateWfhWarningHtml(r) + leaveTypeUsageHtml(r))).join('') : `<div class="empty-state">Nothing waiting on P&amp;C</div>`}
      </div>`);
  }

  // Employees' own edits to an already-locked profile (see
  // rosterService.updateMine) — reviewable by admin/manager/P&C, same set
  // as rosterService.canReviewProfileChanges. Deliberately not operations:
  // that role already has direct roster-edit rights and doesn't need this
  // queue at all.
  if (canReviewProfileChanges) {
    const changeRequests = (changeRes && changeRes.requests) || [];
    sections.push(`
      <div class="card section">
        <div class="card-title">Pending Profile Changes</div>
        ${changeRequests.length ? changeRequests.map(changeRequestCard).join('') : `<div class="empty-state">No profile changes waiting on review</div>`}
      </div>`);
  }

  container.innerHTML = sections.length ? sections.join('') : `<div class="empty-state">No team information available for this account.</div>`;
}
