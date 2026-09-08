import { $, $all, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { apiFetch } from './apiClient.js';
import { ratingOptionsHtml } from './kpiShared.js';

const DIMS = ['communication', 'collaboration', 'reliability', 'attitude', 'contribution', 'growth'];

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
window.kpiSubmitAllPeerReviews = submitAll;

function toggleWorkedWith(revieweeId) {
  const row = $(`#peer-review-row-${revieweeId}`);
  const noWork = $(`#pr-nowork-${revieweeId}`, row).checked;
  $all('.kpi-peer-review-fields', row).forEach((el) => { el.hidden = noWork; });
  // Checking the box immediately satisfies this row's requirement — clear
  // any "incomplete" flag from a previous failed submit attempt.
  if (noWork) row.classList.remove('kpi-peer-review-incomplete');
}
window.kpiTogglePeerReviewWorkedWith = toggleWorkedWith;

function reviewerRowHtml(person, quarter) {
  const dims = DIMS.map((d) => `
    <div class="form-group">
      <label class="form-label">${d[0].toUpperCase() + d.slice(1)}</label>
      <select class="form-control" id="pr-${d}-${person.employeeId}">${ratingOptionsHtml(null)}</select>
    </div>`).join('');

  const name = (person.firstName || person.lastName) ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : `Employee #${person.employeeId}`;
  const meta = [person.department, person.kpiProfile].filter(Boolean).join(' · ');

  return `
    <div class="card section kpi-peer-review-row ${person.alreadyReviewed ? 'kpi-peer-review-done' : ''}" id="peer-review-row-${person.employeeId}">
      <div class="kpi-metric-top">
        <div>
          <div class="kpi-metric-name">${escapeHtml(name)}</div>
          ${meta ? `<div class="small muted">${escapeHtml(meta)}</div>` : ''}
        </div>
        <div class="small muted" id="peer-review-status-${person.employeeId}">${person.alreadyReviewed ? 'Submitted ✓' : ''}</div>
      </div>
      <label class="small" style="display:flex; align-items:center; gap:6px; margin-top:8px;">
        <input type="checkbox" id="pr-nowork-${person.employeeId}" onchange="kpiTogglePeerReviewWorkedWith(${person.employeeId})">
        Didn't work with them this quarter
      </label>
      <div class="form-grid kpi-peer-review-fields mt-8">${dims}</div>
      <div class="form-group full kpi-peer-review-fields">
        <label class="form-label">Comment (optional)</label>
        <textarea class="form-control" id="pr-comment-${person.employeeId}" rows="2"></textarea>
      </div>
    </div>`;
}

async function loadManagerCounter(quarter) {
  if (!state.currentUser || (state.currentUser.role !== 'manager' && state.currentUser.role !== 'people_culture')) return null;
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

// P&C-only: per-employee submitted/received counts — never content, same
// anonymity boundary the backend already enforces. Deliberately more
// detailed than the manager's single company-wide number.
async function loadPcCompletion(quarter) {
  if (!state.currentUser || state.currentUser.role !== 'people_culture') return null;
  try {
    return await apiFetch(`/api/employees/kpi/peer-review/completion?quarter=${encodeURIComponent(quarter)}`);
  } catch (err) {
    return null;
  }
}

function thankYouHtml() {
  return `
    <div class="card section" style="text-align:center; padding:36px 16px;">
      <div style="font-weight:700; font-size:16px; margin-bottom:6px;">You've submitted your team review</div>
      <div class="muted">Thank you for your time — your responses are recorded and can't be changed.</div>
    </div>`;
}

function completionTableHtml(completion) {
  const sorted = [...completion].sort((a, b) => a.reviewsSubmitted - b.reviewsSubmitted);
  return `
    <div class="card section">
      <div class="card-title">Review Completion (P&amp;C)</div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr><th>Employee</th><th>Submitted</th><th>Received</th></tr></thead>
          <tbody>
            ${sorted.map((r) => `
              <tr>
                <td>${escapeHtml((r.firstName || r.lastName) ? `${r.firstName || ''} ${r.lastName || ''}`.trim() : `Employee #${r.employeeId}`)}</td>
                <td>${r.reviewsSubmitted} / ${r.reviewsExpected}</td>
                <td>${r.reviewsReceived}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

export async function renderKpiPeerReview(container, quarter) {
  container.innerHTML = `<div class="empty-state"><div class="loading-spinner"></div>Loading...</div>`;
  try {
    const [window_, rosterRes, counter, teamCounter, completionRes] = await Promise.all([
      apiFetch(`/api/employees/kpi/peer-review/window?quarter=${encodeURIComponent(quarter)}`),
      apiFetch(`/api/employees/kpi/peer-review/roster?quarter=${encodeURIComponent(quarter)}`),
      loadManagerCounter(quarter),
      loadTeamCounter(quarter),
      loadPcCompletion(quarter),
    ]);
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
        <div class="small ${isOpen ? '' : 'muted'} mt-8">${isOpen ? `Open — you've reviewed ${done} of ${roster.length}` : 'Not currently open'}</div>
        ${counter ? `<div class="small mt-8"><strong>${counter.completed}/${counter.total}</strong> employees company-wide have submitted their team reviews</div>` : ''}
        ${teamCounter ? `<div class="small mt-8"><strong>${teamCounter.completed}/${teamCounter.total}</strong> people you manage have submitted their team reviews</div>` : ''}
      </div>
      ${completionRes ? completionTableHtml(completionRes.completion) : ''}
      <div id="kpi-peer-review-form-area">
        ${allDone ? thankYouHtml() : !isOpen ? '<div class="card empty-state">The review window isn\'t open right now — check back during the review period.</div>' : `
          ${roster.map((p) => reviewerRowHtml(p, quarter)).join('')}
          <div class="card section" style="position:sticky; bottom:12px;">
            <button class="btn primary" id="kpi-peer-review-submit-all"
              onclick="kpiSubmitAllPeerReviews('${quarter}', [${roster.map((p) => p.employeeId).join(',')}])">
              Submit All Reviews
            </button>
            <div class="small muted mt-8">Every employee needs all 6 ratings, or "didn't work with them" checked, before this will submit. Already-submitted employees don't need to be re-filled.</div>
          </div>`}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-danger"><div>${escapeHtml(err.message)}</div></div>`;
  }
}
