import { $, $all, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { ratingOptionsHtml } from './kpiShared.js';
import { panel, split, colTitle, plural, loadErrorPanel } from './panels.js';

// 'growth' dropped per user decision (2026-09-28) — stop asking it going
// forward, old scores stay untouched (backend already tolerates a missing
// dimension per-key, no schema/validation change needed — see
// kpiPeerReviewService.js's recomputeAggregate, which null-safely averages
// only whatever's present).
const QUESTIONS = [
  { key: 'collaboration', short: 'Collaboration', label: "Collaboration – How well does this person collaborate with others and contribute to a positive team environment?" },
  { key: 'communication', short: 'Communication', label: 'Communication – How effectively does this person communicate with team members and other departments?' },
  { key: 'reliability', short: 'Reliability', label: 'Reliability – How consistent and dependable is this person in delivering their tasks and meeting deadlines?' },
  { key: 'attitude', short: 'Positive attitude', label: 'Positive Attitude – How often does this person show a positive, proactive, and solution-oriented attitude at work?' },
  { key: 'contribution', short: 'Contribution', label: "Contribution to Team Success – How much does this person add value to the team's overall performance and company goals?" },
];
const DIMS = QUESTIONS.map((q) => q.key);

const INTRO_HTML = `
  <p class="panel-text">This form collects honest, constructive feedback about every team member across all departments. Your responses are completely anonymous. The purpose is to understand how each person collaborates, communicates, and contributes to CEAS COMM’s culture and success; to identify individual strengths and areas for improvement; and to support People &amp; Culture in setting general KPIs for each team member based on collective feedback.</p>
  <p class="panel-text">Rate each person you’ve worked with from 0 to 10 on all five questions, or tick “Didn’t work with them”. The overall comment is optional.</p>`;

function questionsLegendHtml() {
  return `<ol class="pr-legend">${QUESTIONS.map((q) => `<li>${escapeHtml(q.label)}</li>`).join('')}</ol>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Every dimension is required unless "didn't work with them" is checked —
// there's no partial/some-questions-blank state. Rows already submitted
// (this session or a prior one — flagged by the kpi-peer-review-done
// class either way) are exempt from re-validation: their dropdowns are
// blank on a fresh page load (nothing pre-fills a prior answer), so
// forcing them to be re-filled just to submit a few new people would be
// real friction for no reason — they're already complete server-side.
function getRowState(revieweeId, quarter) {
  const row = $(`#peer-review-row-${revieweeId}`);
  if (row.classList.contains('kpi-peer-review-done')) return { status: 'already-done' };

  const workedWith = !$(`#pr-nowork-${revieweeId}`, row).checked;
  if (!workedWith) {
    return { status: 'ready', payload: { quarter, workedWith: false, comment: $(`#pr-comment-${revieweeId}`, row).value || '' } };
  }
  const dims = {};
  for (const d of DIMS) {
    const v = $(`#pr-${d}-${revieweeId}`, row).value;
    if (v === '') return { status: 'incomplete' };
    dims[d] = Number(v);
  }
  return { status: 'ready', payload: { quarter, workedWith: true, comment: $(`#pr-comment-${revieweeId}`, row).value || '', ...dims } };
}

// Single bottom submit — validates every row first (all-or-nothing: any
// row that's neither "didn't work with them" nor fully rated blocks the
// whole submission, per the confirmed requirement), then sends the ready
// ones and reports one aggregate result instead of a toast per person.
async function submitAll(quarter, revieweeIds) {
  const toSubmit = [];
  const incompleteIds = [];
  for (const revieweeId of revieweeIds) {
    const result = getRowState(revieweeId, quarter);
    const row = $(`#peer-review-row-${revieweeId}`);
    if (result.status === 'incomplete') {
      incompleteIds.push(revieweeId);
      row.classList.add('kpi-peer-review-incomplete');
    } else {
      row.classList.remove('kpi-peer-review-incomplete');
      if (result.status === 'ready') toSubmit.push({ revieweeId, payload: result.payload });
    }
  }

  if (incompleteIds.length > 0) {
    const first = $(`#peer-review-row-${incompleteIds[0]}`);
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`${incompleteIds.length} employee(s) still need every rating filled in, or "didn't work with them" checked — nothing was submitted.`, 'danger');
    return;
  }

  if (toSubmit.length === 0) {
    toast('Nothing new to submit — every review is already saved.', 'info');
    return;
  }

  const btn = $('#kpi-peer-review-submit-all');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  let saved = 0;
  let failed = 0;
  for (const { revieweeId, payload } of toSubmit) {
    try {
      await apiFetch(`/api/employees/kpi/peer-review/${revieweeId}`, { method: 'POST', body: JSON.stringify(payload) });
      saved += 1;
      const row = $(`#peer-review-row-${revieweeId}`);
      row.classList.add('kpi-peer-review-done');
      $(`#peer-review-status-${revieweeId}`).innerHTML = '<span class="badge badge-approved">Submitted</span>';
    } catch (err) {
      failed += 1;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Submit all reviews'; }
  updateProgress($('#kpi-view-content'));
  toast(`${saved} review(s) saved${failed ? `, ${failed} failed` : ''}`, failed ? 'danger' : 'info');

  // Every row on the roster is now done — retire the form immediately
  // instead of waiting for the next visit to this tab.
  const allDoneNow = failed === 0 && revieweeIds.every((id) => $(`#peer-review-row-${id}`).classList.contains('kpi-peer-review-done'));
  if (allDoneNow) {
    const formArea = $('#kpi-peer-review-form-area');
    if (formArea) formArea.innerHTML = thankYouHtml();
  }
}
function toggleWorkedWith(revieweeId) {
  const row = $(`#peer-review-row-${revieweeId}`);
  const noWork = $(`#pr-nowork-${revieweeId}`, row).checked;
  $all('.kpi-peer-review-fields', row).forEach((el) => { el.hidden = noWork; });
  // Checking the box immediately satisfies this row's requirement — clear
  // any "incomplete" flag from a previous failed submit attempt.
  if (noWork) row.classList.remove('kpi-peer-review-incomplete');
}

// "Ready" = already submitted, marked didn't-work-with, or every rating
// picked — the same rule getRowState applies at submit time.
function updateProgress(container) {
  const el = container && container.querySelector('#pr-progress');
  if (!el) return;
  const rows = $all('.kpi-peer-review-row', container);
  const ready = rows.filter((row) => {
    if (row.classList.contains('kpi-peer-review-done')) return true;
    const id = row.id.replace('peer-review-row-', '');
    if ($(`#pr-nowork-${id}`, row).checked) return true;
    return DIMS.every((d) => $(`#pr-${d}-${id}`, row).value !== '');
  }).length;
  el.textContent = `${ready} of ${rows.length} ready`;
}

function reviewerRowHtml(person) {
  const id = person.employeeId;
  const name = (person.firstName || person.lastName) ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : `Employee #${id}`;
  const cells = QUESTIONS.map((q) => `
    <label class="pr-cell kpi-peer-review-fields">
      <span class="pr-cell-label">${escapeHtml(q.short)}</span>
      <select class="form-control" id="pr-${q.key}-${id}" aria-label="${escapeHtml(`${q.short} — ${name}`)}">${ratingOptionsHtml(null)}</select>
    </label>`).join('');

  return `
    <div class="pr-row kpi-peer-review-row ${person.alreadyReviewed ? 'kpi-peer-review-done' : ''}" id="peer-review-row-${id}">
      <div class="pr-person">
        <div class="list-title">${escapeHtml(name)}</div>
        <div class="list-meta" id="peer-review-status-${id}">${person.alreadyReviewed ? '<span class="badge badge-approved">Submitted</span>' : escapeHtml(person.kpiProfile || '')}</div>
      </div>
      ${cells}
      <label class="pr-nowork">
        <input type="checkbox" id="pr-nowork-${id}" data-nowork-checkbox data-employee-id="${id}">
        Didn’t work with them
      </label>
      <div class="pr-comment kpi-peer-review-fields">
        <input type="text" class="form-control" id="pr-comment-${id}" placeholder="Overall feedback on ${escapeHtml(name)}’s performance this quarter (optional)" aria-label="Overall feedback — ${escapeHtml(name)}">
      </div>
    </div>`;
}

// Delegated on `container` (a fresh #kpi-view-content instance every time
// renderKpi() runs (see kpi.js) — BUT #kpi-view-content also persists
// across sub-view switches within one KPI-tab visit (Overview <-> History
// <-> Team Reviews reuse the same container, only renderKpi() itself
// recreates it), so renderKpiPeerReview can run several times on the exact
// same container in one visit. The _peerReviewBound guard stops that from
// stacking duplicate listeners (each call creates new arrow-function
// references, so the browser's usual addEventListener de-dupe doesn't
// apply here). Replaces onchange="..."/onclick="..." attributes, which the
// CSP's script-src-attr 'none' silently blocks — confirmed live
// (2026-09-28): this is what made the "didn't work with them" checkbox
// appear to do nothing, and would have done the same to the submit button.
function bindPeerReviewUi(container) {
  if (container._peerReviewBound) return;
  container._peerReviewBound = true;
  container.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-nowork-checkbox]');
    if (!cb) return;
    toggleWorkedWith(Number(cb.dataset.employeeId));
  });
  container.addEventListener('change', (e) => {
    if (e.target.closest('.kpi-peer-review-row')) updateProgress(container);
  });
  container.addEventListener('click', (e) => {
    const submitBtn = e.target.closest('[data-submit-all]');
    if (submitBtn) {
      const quarter = submitBtn.dataset.quarter;
      const revieweeIds = $all('.kpi-peer-review-row', container).map((row) => Number(row.id.replace('peer-review-row-', '')));
      submitAll(quarter, revieweeIds);
      return;
    }
    const windowBtn = e.target.closest('[data-set-window]');
    if (windowBtn) { saveWindow(windowBtn.dataset.quarter); return; }

    const feedbackToggle = e.target.closest('[data-toggle-feedback]');
    if (feedbackToggle) {
      const row = $(`#report-feedback-${feedbackToggle.dataset.employeeId}`);
      if (row) {
        row.hidden = !row.hidden;
        feedbackToggle.textContent = row.hidden ? feedbackToggle.textContent.replace('Hide', 'View') : feedbackToggle.textContent.replace('View', 'Hide');
      }
      return;
    }

    const downloadBtn = e.target.closest('[data-download-report]');
    if (downloadBtn) downloadReviewReport(downloadBtn.dataset.quarter);
  });
}

// Backend (POST /api/employees/kpi/peer-review/window) already existed and
// is already gated server-side to people_culture/admin
// (kpiPeerReviewService.setWindow) — this is purely the missing frontend,
// nothing new on the backend.
function canSetWindow() {
  const role = state.currentUser && state.currentUser.role;
  return role === 'people_culture' || role === 'admin';
}

// A window is [opensAt, closesAt) — both local midnights (the server's own
// suggestion is Cairo midnight to Cairo midnight). The date inputs and the
// header show the *viewer's local* first and last included day; reading the
// UTC date instead (as this used to) showed the day before, and saving
// UTC midnights silently moved the window ~a day early.
function localDateValue(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function toDateInputValue(iso) {
  return iso ? localDateValue(new Date(iso)) : '';
}

function lastIncludedDay(closesAtIso) {
  return new Date(new Date(closesAtIso).getTime() - 1);
}

function windowFormHtml(quarter, window_) {
  return colTitle('Review window', 'People & Culture') + `
    <div class="kpi-toolbar" style="margin-bottom:0;">
      <div class="form-group">
        <label class="form-label" for="pr-window-opens">Opens</label>
        <input type="date" class="form-control small" id="pr-window-opens" value="${toDateInputValue(window_.opensAt)}">
      </div>
      <div class="form-group">
        <label class="form-label" for="pr-window-closes">Closes</label>
        <input type="date" class="form-control small" id="pr-window-closes" value="${window_.closesAt ? localDateValue(lastIncludedDay(window_.closesAt)) : ''}">
      </div>
      <button class="btn small" data-set-window data-quarter="${escapeHtml(quarter)}">Save window</button>
    </div>`;
}

function startOfLocalDay(dateValue, plusDays) {
  const [y, m, d] = dateValue.split('-').map(Number);
  return new Date(y, m - 1, d + (plusDays || 0));
}

async function saveWindow(quarter) {
  const opens = $('#pr-window-opens').value;
  const closes = $('#pr-window-closes').value;
  if (!opens || !closes) { toast('Pick both dates', 'danger'); return; }
  if (closes < opens) { toast('The window must close on or after the day it opens', 'danger'); return; }
  try {
    await apiFetch('/api/employees/kpi/peer-review/window', {
      method: 'POST',
      body: JSON.stringify({ quarter, opensAt: startOfLocalDay(opens).toISOString(), closesAt: startOfLocalDay(closes, 1).toISOString() }),
    });
    toast('Review window saved', 'info');
    renderKpiPeerReview($('#kpi-view-content'), quarter);
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function loadManagerCounter(quarter) {
  if (!state.currentUser || state.currentUser.role !== 'ceo') return null;
  try {
    return await apiFetch(`/api/employees/kpi/peer-review/counter?quarter=${encodeURIComponent(quarter)}`);
  } catch (err) {
    return null; // not fatal — the rest of the page still works without it
  }
}

// Any employee may be a team head (has direct reports) regardless of their
// account role, so this is always requested — the backend returns
// counter: null for anyone with no direct reports.
async function loadTeamCounter(quarter) {
  try {
    const res = await apiFetch(`/api/employees/kpi/peer-review/team-counter?quarter=${encodeURIComponent(quarter)}`);
    return res.counter;
  } catch (err) {
    return null;
  }
}

// Report readiness — CEO+P&C only, boolean-only per the backend's own
// anonymity reasoning (kpiPeerReviewService.getReportReadiness): this is
// deliberately not the same request as loadManagerCounter (CEO-only,
// returns real counts) — P&C gets just enough signal to know when the
// results/CSV below become available, nothing about partial progress.
async function loadReportStatus(quarter) {
  const role = state.currentUser && state.currentUser.role;
  if (role !== 'ceo' && role !== 'people_culture') return null;
  try {
    return await apiFetch(`/api/employees/kpi/peer-review/report-status?quarter=${encodeURIComponent(quarter)}`);
  } catch (err) {
    return null;
  }
}

// Only ever called once loadReportStatus has confirmed ready:true — the
// backend independently enforces the same completeness requirement
// (requireReviewCycleComplete), so this can't leak partial results even if
// called out of order.
async function loadReviewResults(quarter) {
  try {
    const res = await apiFetch(`/api/employees/kpi/peer-review/results?quarter=${encodeURIComponent(quarter)}`);
    return res.results;
  } catch (err) {
    return null;
  }
}

function fmtAvg(value) {
  return value === null || value === undefined ? '—' : value.toFixed(1);
}

function reportResultsHtml(quarter, results) {
  const rows = results.map((r) => {
    const feedbackRow = r.feedback.length ? `
      <tr class="kpi-report-feedback-row" id="report-feedback-${r.employeeId}" hidden>
        <td colspan="8">${r.feedback.map((f) => `<p class="small">${escapeHtml(f)}</p>`).join('')}</td>
      </tr>` : '';
    return `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        ${['collaboration', 'communication', 'reliability', 'attitude', 'contribution'].map((d) => `<td class="num">${fmtAvg(r[d])}</td>`).join('')}
        <td class="num">${r.responseCount}</td>
        <td>${r.feedback.length ? `<button class="btn small" data-toggle-feedback data-employee-id="${r.employeeId}">View comments (${r.feedback.length})</button>` : ''}</td>
      </tr>${feedbackRow}`;
  }).join('');

  return panel({
    title: 'Results',
    meta: 'Everyone has submitted — averages out of 10',
    actions: `<button class="small" data-download-report data-quarter="${escapeHtml(quarter)}">Download CSV</button>`,
    body: `<div class="panel-body"><div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Name</th>${QUESTIONS.map((q) => `<th class="num">${escapeHtml(q.short)}</th>`).join('')}<th class="num">Responses</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div></div>`,
  });
}

// Same reasoning as kpiHistory.js's downloadCsv (same module): apiFetch
// assumes a JSON body, so a CSV export needs its own fetch carrying the
// same Bearer header, then a Blob download — a plain <a href> can't carry
// the Authorization header this app's in-memory-token auth model requires.
async function downloadReviewReport(quarter) {
  const res = await fetch(`/api/employees/kpi/peer-review/report?quarter=${encodeURIComponent(quarter)}`, {
    headers: { Authorization: 'Bearer ' + state.accessToken },
  });
  if (!res.ok) {
    let message = 'Export failed. Please try again.';
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    toast(message, 'danger');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `team-reviews-${quarter}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function thankYouHtml() {
  return panel({
    title: 'Your team review',
    body: `<div class="panel-body"><div style="font-weight:650;margin-bottom:2px;">You’ve submitted your team review</div><div class="muted small">Thank you — your responses are recorded and can’t be changed.</div></div>`,
  });
}

// Groups the roster by department for section headings ("X Team
// Evaluation"), sorted alphabetically by label; each employee still keeps
// their own collapsible card (reviewerRowHtml) within their section.
// Uses window.Departments.labelFor — same global every other roster-facing
// page (roster.js/team.js) already relies on.
function departmentSectionsHtml(roster) {
  const groups = new Map();
  roster.forEach((p) => {
    const code = p.department || '';
    const label = code ? window.Departments.labelFor(code) : 'Unassigned';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  });
  const header = `<div class="pr-row pr-head" aria-hidden="true"><div>Person</div>${QUESTIONS.map((q) => `<div>${escapeHtml(q.short)}</div>`).join('')}<div></div></div>`;
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, members]) => `
      <div class="pr-dept">
        ${colTitle(label, `${members.length} ${plural(members.length, 'person', 'people')}`)}
        ${header}
        ${members.map((p) => reviewerRowHtml(p)).join('')}
      </div>`)
    .join('');
}

export async function renderKpiPeerReview(container, quarter) {
  bindPeerReviewUi(container);
  container.innerHTML = panel({ title: `Team reviews, ${quarter}`, body: '<div class="panel-body"><div class="list-empty">Loading…</div></div>' });
  try {
    const [window_, rosterRes, counter, teamCounter, reportStatus] = await Promise.all([
      apiFetch(`/api/employees/kpi/peer-review/window?quarter=${encodeURIComponent(quarter)}`),
      apiFetch(`/api/employees/kpi/peer-review/roster?quarter=${encodeURIComponent(quarter)}`),
      loadManagerCounter(quarter),
      loadTeamCounter(quarter),
      loadReportStatus(quarter),
      window.Departments.load(apiFetch),
    ]);
    // Sequential, not part of the Promise.all above — only fired once
    // reportStatus confirms ready:true, so this never runs (and can't
    // 403) while the review cycle is still in progress.
    const results = reportStatus && reportStatus.ready ? await loadReviewResults(quarter) : null;
    const roster = rosterRes.roster;
    const isOpen = Date.now() >= new Date(window_.opensAt).getTime() && Date.now() <= new Date(window_.closesAt).getTime();
    const done = roster.filter((r) => r.alreadyReviewed).length;
    // Fully done = reviewed everyone on the roster (rated or "didn't work
    // with them") — at that point the form itself is retired for this
    // quarter, not just individually-done rows within it.
    const allDone = roster.length > 0 && done === roster.length;

    const statusText = !isOpen ? 'Not open right now' : allDone ? 'Open — you’ve submitted yours' : 'Open — yours isn’t submitted yet';
    const metrics = [];
    if (counter) metrics.push(`<div><div class="metric-value">${counter.completed}<span class="metric-of">/${counter.total}</span></div><div class="metric-label">Submitted company-wide</div></div>`);
    if (teamCounter) metrics.push(`<div><div class="metric-value">${teamCounter.completed}<span class="metric-of">/${teamCounter.total}</span></div><div class="metric-label">Submitted by people you manage</div></div>`);
    const statusCol = `<div class="kpi-score-line"><span class="badge ${isOpen ? (allDone ? 'badge-approved' : 'badge-pending') : 'badge-cancelled'}">${escapeHtml(statusText)}</span></div>
      ${window_.configured ? '' : '<div class="muted small mt-8">Dates are suggested — not yet confirmed by People &amp; Culture.</div>'}
      ${metrics.length ? `<div class="metric-grid mt-16">${metrics.join('')}</div>` : ''}`;
    const statusPanel = panel({
      title: `Team reviews, ${quarter}`,
      meta: `${escapeHtml(fmtDate(window_.opensAt))} – ${escapeHtml(fmtDate(lastIncludedDay(window_.closesAt).toISOString()))}`,
      body: canSetWindow() ? split([{ html: statusCol }, { html: windowFormHtml(quarter, window_) }]) : `<div class="panel-body">${statusCol}</div>`,
    });

    const formPanel = panel({
      title: 'Your review',
      meta: `<span id="pr-progress">${done} of ${roster.length} ready</span>`,
      body: `${split([{ html: colTitle('About this review') + INTRO_HTML }, { html: colTitle('The five questions') + questionsLegendHtml() }], '1fr 1fr')}
        <div class="panel-body pr-form">${departmentSectionsHtml(roster)}</div>
        <div class="pr-submit-bar">
          <button class="btn primary" id="kpi-peer-review-submit-all" data-submit-all data-quarter="${escapeHtml(quarter)}">Submit all reviews</button>
          <span class="muted small">Everyone needs all ${DIMS.length} ratings or “Didn’t work with them” ticked. Already-submitted people are skipped.</span>
        </div>`,
    });

    container.innerHTML = `<div class="stack">
      ${statusPanel}
      ${results ? reportResultsHtml(quarter, results) : ''}
      <div id="kpi-peer-review-form-area">
        ${allDone ? thankYouHtml() : !isOpen
          ? panel({ title: 'Your review', body: '<div class="panel-body"><div class="list-empty">The review window isn’t open right now — check back during the review period.</div></div>' })
          : formPanel}
      </div>
    </div>`;
  } catch (err) {
    console.error('Team reviews failed to load', err);
    container.innerHTML = loadErrorPanel('Team reviews couldn’t load', err, 'data-pr-retry');
    container.querySelector('[data-pr-retry]').addEventListener('click', () => renderKpiPeerReview(container, quarter));
  }
}
