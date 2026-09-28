import { $, $all, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { ratingOptionsHtml } from './kpiShared.js';

// 'growth' dropped per user decision (2026-09-28) — stop asking it going
// forward, old scores stay untouched (backend already tolerates a missing
// dimension per-key, no schema/validation change needed — see
// kpiPeerReviewService.js's recomputeAggregate, which null-safely averages
// only whatever's present).
const QUESTIONS = [
  { key: 'collaboration', label: "Collaboration – How well does this person collaborate with others and contribute to a positive team environment?" },
  { key: 'communication', label: 'Communication – How effectively does this person communicate with team members and other departments?' },
  { key: 'reliability', label: 'Reliability – How consistent and dependable is this person in delivering their tasks and meeting deadlines?' },
  { key: 'attitude', label: 'Positive Attitude – How often does this person show a positive, proactive, and solution-oriented attitude at work?' },
  { key: 'contribution', label: "Contribution to Team Success – How much does this person add value to the team's overall performance and company goals?" },
];
const DIMS = QUESTIONS.map((q) => q.key);

const INTRO_HTML = `
  <div class="card section">
    <p>This form is designed to collect honest and constructive feedback about every team member across all departments. Your responses are completely anonymous, so please feel free to share your genuine opinions.</p>
    <p>The purpose of this evaluation is to:</p>
    <ul>
      <li>Understand how each team member collaborates, communicates, and contributes to CEAS COMM's culture and success.</li>
      <li>Identify individual strengths and areas for improvement.</li>
      <li>Support the People &amp; Culture team in setting general KPIs for each team member based on collective feedback.</li>
    </ul>
    <p>Your input is highly valuable — it helps ensure fairness, transparency, and growth for everyone at CEAS COMM. Please take your time and respond thoughtfully for each person you've worked with.</p>
  </div>`;

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
      $(`#peer-review-status-${revieweeId}`).textContent = 'Submitted ✓';
    } catch (err) {
      failed += 1;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Submit All Reviews'; }
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

function reviewerRowHtml(person, quarter) {
  const dims = QUESTIONS.map((q) => `
    <div class="form-group full">
      <label class="form-label">${escapeHtml(q.label)} *</label>
      <select class="form-control" id="pr-${q.key}-${person.employeeId}">${ratingOptionsHtml(null)}</select>
    </div>`).join('');

  const name = (person.firstName || person.lastName) ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : `Employee #${person.employeeId}`;

  return `
    <div class="card section kpi-peer-review-row ${person.alreadyReviewed ? 'kpi-peer-review-done' : ''}" id="peer-review-row-${person.employeeId}">
      <div class="kpi-metric-top">
        <div>
          <div class="kpi-metric-name">${escapeHtml(name)}</div>
          ${person.kpiProfile ? `<div class="small muted">${escapeHtml(person.kpiProfile)}</div>` : ''}
        </div>
        <div class="small muted" id="peer-review-status-${person.employeeId}">${person.alreadyReviewed ? 'Submitted ✓' : ''}</div>
      </div>
      <label class="small" style="display:flex; align-items:center; gap:6px; margin-top:8px;">
        <input type="checkbox" id="pr-nowork-${person.employeeId}" data-nowork-checkbox data-employee-id="${person.employeeId}">
        Didn't work with them this quarter
      </label>
      <div class="form-grid kpi-peer-review-fields mt-8">${dims}</div>
      <div class="form-group full kpi-peer-review-fields">
        <label class="form-label">Overall Performance Feedback – Please share any comments or feedback about this person's overall performance during the quarter.</label>
        <textarea class="form-control" id="pr-comment-${person.employeeId}" rows="2"></textarea>
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

function toDateInputValue(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

function windowFormHtml(quarter, window_) {
  return `
    <div class="mt-8" style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
      <div class="form-group">
        <label class="form-label">Opens</label>
        <input type="date" class="form-control small" id="pr-window-opens" value="${toDateInputValue(window_.opensAt)}">
      </div>
      <div class="form-group">
        <label class="form-label">Closes</label>
        <input type="date" class="form-control small" id="pr-window-closes" value="${toDateInputValue(window_.closesAt)}">
      </div>
      <button class="btn small" data-set-window data-quarter="${escapeHtml(quarter)}">Save Window</button>
    </div>`;
}

async function saveWindow(quarter) {
  const opens = $('#pr-window-opens').value;
  const closes = $('#pr-window-closes').value;
  if (!opens || !closes) { toast('Pick both dates', 'danger'); return; }
  try {
    await apiFetch('/api/employees/kpi/peer-review/window', {
      method: 'POST',
      body: JSON.stringify({ quarter, opensAt: new Date(opens + 'T00:00:00.000Z').toISOString(), closesAt: new Date(closes + 'T23:59:59.999Z').toISOString() }),
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
        <td>${fmtAvg(r.collaboration)}</td>
        <td>${fmtAvg(r.communication)}</td>
        <td>${fmtAvg(r.reliability)}</td>
        <td>${fmtAvg(r.attitude)}</td>
        <td>${fmtAvg(r.contribution)}</td>
        <td>${r.responseCount}</td>
        <td>${r.feedback.length ? `<button class="btn small" data-toggle-feedback data-employee-id="${r.employeeId}">View comments (${r.feedback.length})</button>` : ''}</td>
      </tr>${feedbackRow}`;
  }).join('');

  return `
    <div class="card section">
      <div class="card-title">Team Review Results — ${escapeHtml(quarter)}</div>
      <div class="small muted mt-8">All employees have submitted their team reviews.</div>
      <div class="table-scroll mt-8">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th><th>Collaboration</th><th>Communication</th><th>Reliability</th>
              <th>Positive Attitude</th><th>Contribution to Team Success</th><th>Responses</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="btn primary mt-16" data-download-report data-quarter="${escapeHtml(quarter)}">Download Report (CSV)</button>
    </div>`;
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
  return `
    <div class="card section" style="text-align:center; padding:36px 16px;">
      <div style="font-weight:700; font-size:16px; margin-bottom:6px;">You've submitted your team review</div>
      <div class="muted">Thank you for your time — your responses are recorded and can't be changed.</div>
    </div>`;
}

// Groups the roster by department for section headings ("X Team
// Evaluation"), sorted alphabetically by label; each employee still keeps
// their own collapsible card (reviewerRowHtml) within their section.
// Uses window.Departments.labelFor — same global every other roster-facing
// page (roster.js/team.js) already relies on.
function departmentSectionsHtml(roster, quarter) {
  const groups = new Map();
  roster.forEach((p) => {
    const code = p.department || '';
    const label = code ? window.Departments.labelFor(code) : 'Unassigned';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  });
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, members]) => `
      <div class="kpi-section-title">${escapeHtml(label)} Team Evaluation</div>
      ${members.map((p) => reviewerRowHtml(p, quarter)).join('')}`)
    .join('');
}

export async function renderKpiPeerReview(container, quarter) {
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
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

    container.innerHTML = `
      <div class="card section">
        <div class="card-title">Team Reviews — ${escapeHtml(quarter)}</div>
        <div class="small muted">Review window: ${fmtDate(window_.opensAt)} – ${fmtDate(window_.closesAt)} ${window_.configured ? '' : '(suggested — not yet confirmed by P&C)'}</div>
        <div class="small ${isOpen ? '' : 'muted'} mt-8">${!isOpen ? 'Not currently open' : allDone ? `You've already submitted the team review for ${escapeHtml(quarter)}.` : 'Open — you did not submit the team review yet.'}</div>
        ${counter ? `<div class="small mt-8"><strong>${counter.completed}/${counter.total}</strong> employees company-wide have submitted their team reviews</div>` : ''}
        ${teamCounter ? `<div class="small mt-8"><strong>${teamCounter.completed}/${teamCounter.total}</strong> people you manage have submitted their team reviews</div>` : ''}
        ${canSetWindow() ? windowFormHtml(quarter, window_) : ''}
      </div>
      ${results ? reportResultsHtml(quarter, results) : ''}
      <div id="kpi-peer-review-form-area">
        ${allDone ? thankYouHtml() : !isOpen ? '<div class="card empty-state">The review window isn\'t open right now — check back during the review period.</div>' : `
          ${INTRO_HTML}
          ${departmentSectionsHtml(roster, quarter)}
          <div class="card section" style="position:sticky; bottom:12px;">
            <button class="btn primary" id="kpi-peer-review-submit-all" data-submit-all data-quarter="${escapeHtml(quarter)}">
              Submit All Reviews
            </button>
            <div class="small muted mt-8">Every employee needs all ${DIMS.length} ratings, or "didn't work with them" checked, before this will submit. Already-submitted employees don't need to be re-filled.</div>
          </div>`}
      </div>
    `;
    bindPeerReviewUi(container);
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}
