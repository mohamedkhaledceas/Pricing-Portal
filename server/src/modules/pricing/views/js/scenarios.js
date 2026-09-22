import { $, esc, uid, findRow, bindCommitOnBlur, queueAutoSave, setOut, recompute } from './dom.js';
import { num, m0, pct } from './format.js';
import { currentProject, projectCalc } from './calc.js';
import { apiRequest } from './apiClient.js';

export function renderScenarios() {
  const proj = currentProject();
  const body = $('#scenBody');
  if (!proj) { body.innerHTML = `<tr><td colspan="9" class="muted">No project selected.</td></tr>`; return; }
  body.innerHTML = (proj.scenarios || []).map((s) => `
    <tr data-id="${s.id}">
      <td><input data-f="name" value="${esc(s.name)}"> <span class="scenBadge" data-scen-badge="${s.id}"></span></td>
      <td class="num"><input data-f="hoursFactor" type="number" min="1" step="5" value="${s.hoursFactor}"></td>
      <td class="num"><input data-f="extra" type="number" min="0" step="500" value="${s.extra}"></td>
      <td class="num"><input data-f="price" type="number" min="0" step="500" value="${s.price === null || s.price === undefined ? '' : s.price}" placeholder="project price"></td>
      <td class="num calc" data-out="s.${s.id}.cost">—</td>
      <td class="num calc" data-out="s.${s.id}.profit">—</td>
      <td class="num calc">
        <span data-out="s.${s.id}.margin">—</span>
        <div class="scenDelta" data-scen-delta="${s.id}"></div>
      </td>
      <td class="num calc" data-out="s.${s.id}.rate">—</td>
      <td><button class="tiny danger" data-del="scen">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="9" class="muted">No scenarios yet.</td></tr>`;
}

/* c.margin (no scenario overrides) is the baseline every scenario's delta
   is measured against. Best/worst only means anything with 2+ scenarios
   and an actual spread between them. */
export function computeScenarioOutputs() {
  const proj = currentProject();
  if (!proj) return;
  const c = projectCalc(proj);
  const scenResults = (proj.scenarios || []).map((s) => ({
    id: s.id,
    sc: projectCalc(proj, {
      hoursFactor: num(s.hoursFactor) / 100 || 1,
      extraDirect: num(s.extra),
      /* an empty Price cell means "same price as the project" — not a re-quote,
         so a scenario that runs over shows the margin actually being lost */
      price: (s.price === null || s.price === undefined || s.price === '') ? c.price : s.price,
      priceIsBase: (s.price === null || s.price === undefined || s.price === ''),
    }),
  }));
  let bestScenId = null, worstScenId = null;
  if (scenResults.length > 1) {
    const best = scenResults.reduce((a, b) => (b.sc.margin > a.sc.margin ? b : a));
    const worst = scenResults.reduce((a, b) => (b.sc.margin < a.sc.margin ? b : a));
    if (best.sc.margin > worst.sc.margin) { bestScenId = best.id; worstScenId = worst.id; }
  }
  scenResults.forEach(({ id, sc }) => {
    setOut(`s.${id}.cost`, m0(sc.cost));
    setOut(`s.${id}.profit`, m0(sc.profit));
    setOut(`s.${id}.margin`, pct(sc.margin));
    setOut(`s.${id}.rate`, m0(sc.effRate, c.qc));
    const badge = $(`[data-scen-badge="${id}"]`);
    if (badge) badge.innerHTML = id === bestScenId ? '<span class="pill good">Best margin</span>'
      : id === worstScenId ? '<span class="pill bad">Lowest margin</span>' : '';
    const deltaEl = $(`[data-scen-delta="${id}"]`);
    if (deltaEl) {
      const deltaPts = Math.round((sc.margin - c.margin) * 1000) / 10;
      deltaEl.textContent = Math.abs(deltaPts) < 0.05 ? '' : (deltaPts > 0 ? '+' : '') + deltaPts.toFixed(1) + 'pp vs base';
    }
  });
}

export function bindScenariosTable() {
  $('#scenBody').addEventListener('input', (e) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(e.target), f = e.target.dataset.f; if (!id || !f) return;
    const s = proj.scenarios.find((v) => v.id === id); if (!s) return;
    const nextValue = f === 'name' ? e.target.value : (f === 'price' ? (e.target.value === '' ? null : num(e.target.value)) : num(e.target.value));
    s[f] = nextValue;
    recompute();
  });
  bindCommitOnBlur($('#scenBody'), (el) => el.matches('input,select') && !!el.dataset.f, (el) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(el), f = el.dataset.f; if (!id || !f) return;
    const s = proj.scenarios.find((v) => v.id === id); if (!s) return;
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/scenarios/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ [f]: s[f] }),
    }));
  });
  $('#scenBody').addEventListener('click', (e) => {
    if (e.target.dataset.del !== 'scen') return;
    const proj = currentProject();
    const id = findRow(e.target);
    proj.scenarios = proj.scenarios.filter((s) => s.id !== id);
    renderScenarios(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/scenarios/${id}`, { method: 'DELETE' }));
  });
  $('#addScen').addEventListener('click', () => {
    const proj = currentProject(); if (!proj) return;
    const scenario = { id: uid(), name: 'New scenario', hoursFactor: 100, extra: 0, price: null };
    proj.scenarios = proj.scenarios || [];
    proj.scenarios.push(scenario);
    renderScenarios(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/scenarios`, {
      method: 'POST',
      body: JSON.stringify(scenario),
    }));
  });
}
