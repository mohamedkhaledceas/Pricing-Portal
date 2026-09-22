import { getStoredAuth } from './apiClient.js';

export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const uid = () => Math.random().toString(36).slice(2, 9);
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function findRow(el) {
  const tr = el.closest('tr');
  return tr ? tr.dataset.id : null;
}

/* recompute() is a single global recalculation (team/expenses totals feed
   dashboard tiles, which feed the pipeline table, current-project cost,
   scenarios, quote...) that virtually every tab's edit handlers need to
   trigger — but recompute.js itself needs to import each tab's own compute
   slice, so tab files calling recompute.js directly would be circular.
   Hosted here instead (every tab file already depends on dom.js): tab files
   import and call recompute() same as before; recompute.js registers its
   real implementation once, at module load. */
let recomputeHandler = () => {};
export function setRecomputeHandler(fn) { recomputeHandler = fn; }
export function recompute() { recomputeHandler(); }

/* Same reasoning as recompute() above — applyMode() and renderAllStructures()
   (both real implementations live in main.js) are triggered from several
   tab files after a bulk state replacement (clear/reload sample/load file/
   switch mode/switch currency/create-or-delete a project), not just from
   main.js's own boot sequence. main.js registers its real implementations
   here once, at boot; every file (including main.js itself) calls these. */
let applyModeHandler = () => {};
export function setApplyModeHandler(fn) { applyModeHandler = fn; }
export function applyMode() { applyModeHandler(); }

let renderAllHandler = () => {};
export function setRenderAllHandler(fn) { renderAllHandler = fn; }
export function renderAllStructures() { renderAllHandler(); }

/* "Compute now, paint once" — renderers call setOut(k, v) as many times as
   they like during recompute(), then a single flushOut() at the end writes
   every [data-out] element's textContent in one pass, instead of touching
   the DOM on every individual calculation. */
export const OUT = {};
export function setOut(k, v) { OUT[k] = v; }
export function flushOut() {
  $$('[data-out]').forEach((el) => {
    const k = el.getAttribute('data-out');
    if (k in OUT) el.textContent = OUT[k];
  });
}

/* Editable fields commit to the server on blur (click-away or Tab) or Enter —
   like a spreadsheet cell — instead of on every keystroke. Local `state`
   still updates live on every `input` event so computed totals stay
   reactive; only the network write (and the audit-log row it produces
   server-side) is deferred until the edit is actually finished. Escape
   reverts the field to the value it had when it gained focus, by resetting
   .value and re-dispatching `input` so the existing per-field coercion
   logic (already registered on the same container/element) puts `state`
   back in sync too — without duplicating that coercion logic here.
   `el` (not `container`) is the target: pass either a single field or a
   delegated container; focusin/focusout/keydown all fire on the actual
   target regardless of which one is listening. */
export function bindCommitOnBlur(el, isEditable, commit) {
  el.addEventListener('focusin', (e) => {
    if (!isEditable(e.target)) return;
    e.target.dataset.commitBaseline = e.target.value;
  });
  el.addEventListener('focusout', (e) => {
    if (!isEditable(e.target) || e.target.dataset.commitBaseline === undefined) return;
    const baseline = e.target.dataset.commitBaseline;
    delete e.target.dataset.commitBaseline;
    if (e.target.value !== baseline) commit(e.target);
  });
  el.addEventListener('keydown', (e) => {
    if (!isEditable(e.target)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (e.target.dataset.commitBaseline !== undefined) {
        e.target.value = e.target.dataset.commitBaseline;
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      e.target.blur();
    }
  });
}

let saveErrorTimer = null;
export function showSaveError(message) {
  const el = $('#saveErrorToast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(saveErrorTimer);
  saveErrorTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

let saveOkTimer = null;
export function showSaveOk() {
  const el = $('#saveOkToast');
  if (!el) return;
  el.textContent = 'All changes saved.';
  el.hidden = false;
  clearTimeout(saveOkTimer);
  saveOkTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

/* Debounces bursts of edits, but must never let a LATER edit silently discard
   an EARLIER one just because they landed within the same 700ms window (e.g.
   "add direct cost" immediately followed by typing its amount) — a single
   shared timer that replaced the previous task on every call used to do
   exactly that, including dropping the POST that creates a row before the
   PUT that edits it, which made the edit 404 against a row that was never
   created. Every queued task now runs, in the order it was queued, once
   things go quiet for 700ms. */
let autoSaveTimer = null;
let pendingSaveTasks = [];
export function queueAutoSave(task) {
  const auth = getStoredAuth();
  if (!auth || !auth.token || typeof task !== 'function') return;
  pendingSaveTasks.push(task);
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    const tasks = pendingSaveTasks;
    pendingSaveTasks = [];
    let allOk = true;
    for (const queuedTask of tasks) {
      try {
        await queuedTask();
      } catch (err) {
        allOk = false;
        console.warn('Auto-save failed:', err.message);
        showSaveError('Save failed: ' + (err.message || 'unknown error') + '. Reload the page to get back in sync.');
      }
    }
    if (allOk && tasks.length) showSaveOk();
  }, 700);
}
