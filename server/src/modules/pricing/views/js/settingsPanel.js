import { $, recompute, applyMode, renderAllStructures } from './dom.js';
import { state, S, setState, setDirty, sampleState, emptyState, migrate, hashPin } from './state.js';
import { num, disp, CURS, curOpts } from './format.js';
import { currentProject } from './calc.js';
import { paintLogos } from './theme.js';
import { apiRequest, getStoredAuth } from './apiClient.js';

export function renderCurrencyUI() {
  const base = S().currency;
  $('#dispCur').innerHTML = curOpts(disp());
  $('#s_currency').innerHTML = curOpts(base);
  $('#p_cur').innerHTML = curOpts((currentProject() || {}).cur || base);
  $('#rateRow').innerHTML = CURS.filter((c) => c !== base).map((c) => `
    <div class="field"><label>1 ${c} =</label>
      <input type="number" min="0" step="0.01" data-rate="${c}" value="${num((S().rates || {})[c])}" style="width:120px"></div>`).join('')
    + `<div class="field"><label>&nbsp;</label><span class="muted" style="padding:7px 0">${base} each</span></div>`;
  $('#s_ratesDate').value = S().ratesDate || '';
}

export function loadSettingsInputs() {
  $('#s_company').value = S().company || ''; $('#s_currency').value = S().currency;
  $('#s_hours').value = S().defaultHours; $('#s_util').value = S().defaultUtil;
  $('#s_margin').value = S().targetMargin; $('#s_cont').value = S().contingency;
  $('#s_basis').value = S().basis; $('#s_floor').value = S().floorMargin;
  $('#pinState').textContent = state.security.pinHash
    ? 'A PIN is set — the team view is locked without it.'
    : 'No PIN yet — anyone can switch back to the owner view.';
  document.title = (S().company ? S().company + ' — ' : '') + 'Team Cost & Margin Planner';
}

export function bindSettings() {
  const map = {
    '#s_company': 'company', '#s_hours': 'defaultHours',
    '#s_util': 'defaultUtil', '#s_margin': 'targetMargin', '#s_cont': 'contingency', '#s_basis': 'basis',
  };
  Object.entries(map).forEach(([sel, key]) => {
    $(sel).addEventListener('input', (e) => {
      S()[key] = (key === 'company' || key === 'basis') ? e.target.value : num(e.target.value);
      recompute();
    });
  });
  /* changing the base currency re-expresses every rate against the new base,
     so the ratios between currencies survive the switch untouched */
  $('#s_currency').addEventListener('change', (e) => {
    const nb = e.target.value, old = S().rates || {}, prev = num(old[nb]) || 1;
    const next = {};
    CURS.forEach((c) => { next[c] = c === nb ? 1 : Math.round(((num(old[c]) || 1) / prev) * 1e6) / 1e6; });
    S().rates = next; S().currency = nb;
    if (CURS.indexOf(S().display) < 0) S().display = nb;
    renderAllStructures();
  });
  $('#dispCur').addEventListener('change', (e) => { S().display = e.target.value; renderAllStructures(); });
  $('#s_ratesDate').addEventListener('input', (e) => { S().ratesDate = e.target.value; recompute(); });
  $('#rateRow').addEventListener('input', (e) => {
    const c = e.target.dataset.rate; if (!c) return;
    S().rates[c] = num(e.target.value); recompute();
  });
  $('#s_floor').addEventListener('input', (e) => { S().floorMargin = num(e.target.value); recompute(); });
  // #capQuoting/#capWindow/#fitHours/#fitStart/#fitMonths — Capacity tab
  // inputs the original file bound here too; moved to capacity.js instead,
  // where they belong by tab ownership (see the refactor plan, Stage 5).
  $('#btnSetPin').addEventListener('click', () => {
    const v = $('#s_pin').value.trim();
    if (v.length < 3) { alert('Choose a PIN of at least 3 characters.'); return; }
    state.security.pinHash = hashPin(v);
    $('#s_pin').value = '';
    loadSettingsInputs();
    alert('PIN set. Write it down somewhere safe — without it you cannot get back to the owner view of a saved file.\n\nUse "Switch to team view" at the top before you hand the file over.');
  });
  $('#btnLogo').addEventListener('click', () => $('#logoInput').click());
  $('#btnLogoReset').addEventListener('click', () => { S().logo = null; paintLogos(); recompute(); });
  $('#logoInput').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 1200000) { alert('That image is large — please use one under about 1 MB so the file stays quick to open.'); e.target.value = ''; return; }
    const r = new FileReader();
    r.onload = () => { S().logo = r.result; paintLogos(); recompute(); e.target.value = ''; };
    r.readAsDataURL(f);
  });
  $('#s_logoQuote').addEventListener('change', (e) => { S().logoQuote = e.target.checked; recompute(); });
  $('#btnClearPin').addEventListener('click', () => {
    state.security.pinHash = null; loadSettingsInputs();
  });
  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear all data and start from an empty sheet?')) return;
    setState(emptyState()); loadSettingsInputs(); applyMode(); renderAllStructures();
  });
  $('#btnSample').addEventListener('click', () => {
    if (!confirm('Replace everything with the sample data?')) return;
    setState(sampleState()); loadSettingsInputs(); applyMode(); renderAllStructures();
  });
}

export async function hydrateFromApi() {
  try {
    const apiState = await apiRequest('/api/state');
    if (!apiState || !apiState.settings || !Array.isArray(apiState.team)) {
      throw new Error('Invalid server response.');
    }
    setState(migrate(apiState));
    loadSettingsInputs(); applyMode(); renderAllStructures();
    setDirty(false);
    return true;
  } catch (err) {
    console.warn('API hydration failed:', err.message);
    return false;
  }
}

/* every edit is already persisted individually as it happens, via the granular
   resource endpoints (see queueAutoSave) — PUT /api/state is disabled server-side
   to avoid one tab clobbering another user's concurrent changes. This just re-syncs
   the client with the authoritative server state as a manual "confirm it's saved". */
export async function saveToApi() {
  const ok = await hydrateFromApi();
  if (!ok) throw new Error('Could not reach the server to confirm your changes were saved.');
}

function saveToFile() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = (S().company ? S().company.replace(/[^\w-]+/g, '-').toLowerCase() + '-' : '') + 'margin-planner-' + stamp + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setDirty(false);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function bindFiles() {
  const save = async () => {
    const auth = getStoredAuth();
    if (auth && auth.token) {
      try {
        await saveToApi();
        return;
      } catch (err) {
        alert('Server save failed: ' + err.message);
        return;
      }
    }
    saveToFile();
  };
  $('#btnSave2').addEventListener('click', save);

  const pick = async () => {
    const auth = getStoredAuth();
    if (auth && auth.token) {
      try {
        const ok = await hydrateFromApi();
        if (ok) return;
      } catch (err) {
        console.warn('Server load failed:', err.message);
      }
    }
    $('#fileInput').click();
  };
  $('#btnLoad2').addEventListener('click', pick);
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || !data.settings || !Array.isArray(data.team)) throw new Error('bad file');
        setState(migrate(data));
        loadSettingsInputs(); applyMode(); renderAllStructures();
      } catch (err) { alert('That file could not be read as a planner file.'); }
      e.target.value = '';
    };
    r.readAsText(f);
  });
}
