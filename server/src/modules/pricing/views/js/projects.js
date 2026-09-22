import {
  $, esc, uid, findRow, bindCommitOnBlur, queueAutoSave, setOut,
  recompute, renderAllStructures, showSaveError,
} from './dom.js';
import { state, S, isBD } from './state.js';
import { num, fmt, m0, money, pct, rateOf, fromBase, disp, curOpts } from './format.js';
import { currentProject, projectCalc, company, marginPill, thisMonth } from './calc.js';
import { apiRequest } from './apiClient.js';

export function renderProjectSelects() {
  const opts = state.projects.map((p) => `<option value="${p.id}">${esc(p.name || 'Untitled')}${p.client ? ' — ' + esc(p.client) : ''}</option>`).join('');
  ['#projSelect', '#scenProjSelect', '#quoteProjSelect'].forEach((sel) => {
    const el = $(sel); if (!el) return;
    el.innerHTML = opts || '<option value="">No projects yet</option>';
    if (state.ui.currentProject) el.value = state.ui.currentProject;
  });
}

export function renderProject() {
  const proj = currentProject();
  $('#projPanel').style.display = proj ? '' : 'none';
  if (!proj) return;
  $('#p_name').value = proj.name || '';
  $('#p_client').value = proj.client || '';
  $('#p_months').value = proj.months || 1;
  $('#p_start').value = proj.start || thisMonth();
  $('#p_status').value = proj.status || 'Quoting';
  $('#p_cur').value = proj.cur || S().currency;
  $('#p_cont').value = proj.cont;
  $('#p_target').value = proj.target;
  $('#p_price').value = (proj.price === null || proj.price === undefined || proj.price === '') ? '' : proj.price;

  const peopleOpts = (p) => state.team.map((t) =>
    `<option value="${t.id}" ${t.id === p ? 'selected' : ''}>${esc(t.name || 'Unnamed')}${t.role ? ' · ' + esc(t.role) : ''}</option>`).join('');
  $('#lineBody').innerHTML = (proj.lines || []).map((l) => `
    <tr data-id="${l.id}">
      <td><select data-f="personId">${peopleOpts(l.personId)}</select></td>
      <td class="num"><input data-f="hours" type="number" min="0" step="1" value="${l.hours}"></td>
      <td class="num calc admin-only" data-out="l.${l.id}.rate">—</td>
      <td class="num calc admin-only" data-out="l.${l.id}.lab">—</td>
      <td class="num calc admin-only" data-out="l.${l.id}.oh">—</td>
      <td class="num calc admin-only" data-out="l.${l.id}.tot">—</td>
      <td class="num calc bd-only" data-out="l.${l.id}.sell">—</td>
      <td class="num calc bd-only" data-out="l.${l.id}.price">—</td>
      <td><button class="tiny danger" data-del="line">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="7" class="muted">${state.team.length ? 'No hours allocated yet.' : (isBD() ? 'No hours allocated yet.' : 'Add your team first, on the Team tab.')}</td></tr>`;
  $('#lineFoot').innerHTML = (proj.lines || []).length ? `<tr>
      <td>Total</td><td class="num" data-out="l.hours">—</td><td class="admin-only"></td>
      <td class="num admin-only" data-out="l.labour">—</td><td class="num admin-only" data-out="l.oh">—</td>
      <td class="num admin-only" data-out="l.tot">—</td>
      <td class="bd-only"></td><td class="num bd-only" data-out="l.sellTot">—</td><td></td></tr>` : '';

  $('#dcBody').innerHTML = (proj.direct || []).map((d) => `
    <tr data-id="${d.id}">
      <td><input data-f="name" value="${esc(d.name)}" placeholder="Item"></td>
      <td><select data-f="cur" style="min-width:62px">${curOpts(d.cur || S().currency)}</select></td>
      <td class="num"><input data-f="amount" type="number" min="0" step="100" value="${d.amount}"></td>
      <td><button class="tiny danger" data-del="dc">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="4" class="muted">None.</td></tr>`;
  $('#dcFoot').innerHTML = (proj.direct || []).length ? `<tr><td colspan="2">Total <span class="muted" data-out="cur.disp"></span></td><td class="num" data-out="dc.total">—</td><td></td></tr>` : '';
}

/* The current-project slice of the original single recompute() function —
   scenario comparison and the quote total are computed in scenarios.js/
   quote.js instead (Stage 4), each called separately by recompute.js;
   dashboard tiles/pipeline table are computed in dashboard.js (Stage 5). */
export function computeCurrentProjectOutputs() {
  const proj = currentProject();
  if (!proj) return;
  const co = company();
  const cur = S().currency;
  const c = projectCalc(proj);
  c.byPerson.forEach((bp) => {
    setOut(`l.${bp.line.id}.rate`, m0(bp.rate));
    setOut(`l.${bp.line.id}.lab`, m0(bp.labour));
    setOut(`l.${bp.line.id}.oh`, m0(bp.overhead));
    setOut(`l.${bp.line.id}.tot`, m0(bp.labour + bp.overhead));
  });
  setOut('l.hours', fmt(c.hours, 0)); setOut('l.labour', m0(c.labour));
  setOut('l.oh', m0(c.overhead)); setOut('l.tot', m0(c.labour + c.overhead));
  setOut('dc.total', m0(c.direct));
  setOut('p.labour', money(c.labour)); setOut('p.overhead', money(c.overhead));
  setOut('p.ohRate', money(co.ohPerHour, 2)); setOut('p.hours', fmt(c.hours, 0) + ' hrs');
  setOut('p.direct', money(c.direct)); setOut('p.contAmt', money(c.contAmt));
  setOut('p.cost', money(c.cost));
  setOut('p.profit', money(c.profit));
  setOut('p.margin', pct(c.margin)); setOut('p.markup', pct(c.markup));
  setOut('p.effRate', money(c.effRate, 0) + ' / hr');
  setOut('p.floor', money(c.cost, 0, c.qc));
  setOut('p.capShare', Math.round(c.capShare * 100) + '% of the team\'s monthly billable hours');
  setOut('cur.quote', '(' + c.qc + ')');
  setOut('p.fxNote', c.qc === cur
    ? `Quoted in ${cur}. Costs and margins below are in ${disp()}.`
    : `Quoted to the client in ${c.qc} at 1 ${c.qc} = ${fmt(rateOf(c.qc), 2)} ${cur}`
      + (S().ratesDate ? ` (rate set ${S().ratesDate})` : '')
      + `. Costs and margins below are in ${disp()}, so the margin is the real one whatever the client pays in.`);
  const sg = $('#p_sugg'); if (sg) sg.value = m0(c.suggested, c.qc) + ' ' + c.qc;
  const pi = $('#p_price');
  if (pi) pi.placeholder = (proj.price === null || proj.price === undefined || proj.price === '')
    ? m0(c.suggested, c.qc) + ' suggested' : '';
  const mp = $('#p_marginPill'); if (mp) mp.innerHTML = marginPill(c.margin);

  /* team (BD) view — every figure here is a selling price, never a cost.
     sell rate = (person cost + overhead) × (1 + contingency) ÷ (1 − target margin),
     so the lines add up to exactly the same recommended price the owner view shows. */
  const tgt = num(proj.target) / 100;
  const k = (1 + num(proj.cont) / 100) / (tgt < 0.95 ? (1 - tgt) : 1);
  let sellTot = 0;
  c.byPerson.forEach((bp) => {
    const sell = (bp.rate + co.ohPerHour) * k;
    setOut(`l.${bp.line.id}.sell`, m0(sell, c.qc));
    setOut(`l.${bp.line.id}.price`, m0(bp.hours * sell, c.qc));
    sellTot += bp.hours * sell;
  });
  setOut('l.sellTot', m0(sellTot, c.qc));
  setOut('b.recommended', money(c.suggested, 0, c.qc));
  setOut('b.hours', fmt(c.hours, 0) + ' hrs');
  setOut('b.direct', money(c.direct * k, 0, c.qc));
  setOut('b.effRate', c.hours > 0 ? money(c.price / c.hours, 0, c.qc) + ' / hr' : '—');
  const bp2 = $('#b_price');
  if (bp2) {
    if (document.activeElement !== bp2) {
      bp2.value = (proj.price === null || proj.price === undefined || proj.price === '') ? '' : proj.price;
    }
    bp2.placeholder = m0(c.suggested, c.qc) + ' (recommended)';
  }
  const floorPrice = c.cost / (1 - Math.min(num(S().floorMargin) / 100, 0.94));
  const sig = $('#b_signal');
  if (sig) {
    let colour, title, note;
    if (c.hours <= 0 && c.direct <= 0) {
      colour = 'var(--axis)'; title = 'Nothing estimated yet';
      note = 'Add the people and hours this job needs.';
    } else if (c.price >= c.suggested - 0.5) {
      colour = 'var(--good)'; title = 'Good to send';
      note = 'This price is at or above standard company pricing.';
    } else if (c.price >= floorPrice) {
      colour = 'var(--warn)'; title = 'Negotiation range — check before committing';
      note = 'Below standard pricing but still acceptable. Confirm with the owner before you put it in writing.';
    } else {
      colour = 'var(--critical)'; title = 'Too low — do not send';
      note = 'This price is below the company minimum. It needs approval before it goes anywhere.';
    }
    sig.querySelector('.lamp').style.background = colour;
    setOut('b.signalTitle', title); setOut('b.signalNote', ' ' + note);
  }

  const segs = [
    ['Labour', c.labour, 'var(--s1)'],
    ['Overhead', c.overhead, 'var(--s2)'],
    ['Direct costs', c.direct, 'var(--s3)'],
    ['Contingency', c.contAmt, 'var(--s4)'],
    [c.profit >= 0 ? 'Profit' : 'Loss', Math.abs(c.profit), c.profit >= 0 ? 'var(--s6)' : 'var(--critical)'],
  ].filter((s) => s[1] > 0);
  const tot = segs.reduce((s, x) => s + x[1], 0) || 1;
  const sp = $('#stackProject');
  if (sp) {
    sp.innerHTML = segs.map((s) => `<div style="background:${s[2]}; width:${s[1] / tot * 100}%" title="${s[0]}"></div>`).join('');
    $('#legendProject').innerHTML = segs.map((s) =>
      `<span><span class="sw" style="background:${s[2]}"></span>${s[0]} <b>${m0(s[1])}</b> <span class="muted">${Math.round(s[1] / tot * 100)}%</span></span>`).join('');
  }
  const adv = $('#p_advice');
  if (adv) {
    let msg;
    if (c.price <= 0) msg = 'Set a price to see the margin.';
    else if (c.profit < 0) msg = `At this price you lose ${money(-c.profit)}. You need at least ${money(c.cost, 0, c.qc)} to break even.`;
    else if (c.margin < 0.15) msg = `Thin. One delay or one extra round of revisions wipes this out — the contingency line is your only buffer. Break-even is ${money(c.cost, 0, c.qc)}.`;
    else if (c.margin < 0.3) msg = `Workable, but there is little room to absorb scope creep. Break-even is ${money(c.cost, 0, c.qc)}.`;
    else msg = `Comfortable. You could discount down to ${money(c.cost / 0.85, 0, c.qc)} and still hold a 15% margin.`;
    adv.textContent = msg;
  }
}

export function bindProjectsTable() {
  /* project header fields */
  const pf = {
    '#p_name': 'name', '#p_client': 'client', '#p_months': 'months', '#p_status': 'status',
    '#p_cont': 'cont', '#p_target': 'target', '#p_price': 'price', '#p_start': 'start', '#p_cur': 'cur',
  };
  Object.entries(pf).forEach(([sel, key]) => {
    const el = $(sel);
    el.addEventListener('input', (e) => {
      const proj = currentProject(); if (!proj) return;
      const nextValue = (key === 'name' || key === 'client' || key === 'status' || key === 'start' || key === 'cur') ? e.target.value
        : (key === 'price' ? (e.target.value === '' ? null : num(e.target.value)) : num(e.target.value));
      if (key === 'name' || key === 'client' || key === 'status' || key === 'start' || key === 'cur') proj[key] = e.target.value;
      else if (key === 'price') proj.price = nextValue;
      else proj[key] = nextValue;
      if (key === 'name' || key === 'client') renderProjectSelects();
      recompute();
    });
    bindCommitOnBlur(el, () => true, () => {
      const proj = currentProject(); if (!proj) return;
      queueAutoSave(() => apiRequest(`/api/projects/${proj.id}`, {
        method: 'PUT',
        body: JSON.stringify({ [key]: proj[key] }),
      }));
    });
  });
  $('#b_price').addEventListener('input', (e) => {
    const proj = currentProject(); if (!proj) return;
    const nextValue = e.target.value === '' ? null : num(e.target.value);
    proj.price = nextValue;
    const pi = $('#p_price'); if (pi) pi.value = e.target.value;
    recompute();
  });
  bindCommitOnBlur($('#b_price'), () => true, () => {
    const proj = currentProject(); if (!proj) return;
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}`, {
      method: 'PUT',
      body: JSON.stringify({ price: proj.price }),
    }));
  });
  $('#useSugg').addEventListener('click', () => {
    const proj = currentProject(); if (!proj) return;
    const pc = projectCalc(proj);
    proj.price = Math.round(fromBase(pc.suggested, pc.qc));
    $('#p_price').value = proj.price; recompute();
  });

  /* project lines */
  $('#lineBody').addEventListener('input', (e) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(e.target), f = e.target.dataset.f; if (!id || !f) return;
    const l = proj.lines.find((v) => v.id === id); if (!l) return;
    const nextValue = f === 'hours' ? num(e.target.value) : e.target.value;
    l[f] = nextValue;
    recompute();
  });
  $('#lineBody').addEventListener('change', (e) => { if (e.target.dataset.f === 'personId') recompute(); });
  bindCommitOnBlur($('#lineBody'), (el) => el.matches('input,select') && !!el.dataset.f, (el) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(el), f = el.dataset.f; if (!id || !f) return;
    const l = proj.lines.find((v) => v.id === id); if (!l) return;
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/lines/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ [f]: l[f] }),
    }));
  });
  $('#lineBody').addEventListener('click', (e) => {
    if (e.target.dataset.del !== 'line') return;
    const proj = currentProject();
    const id = findRow(e.target);
    proj.lines = proj.lines.filter((l) => l.id !== id);
    renderProject(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/lines/${id}`, { method: 'DELETE' }));
  });
  $('#addLine').addEventListener('click', () => {
    const proj = currentProject(); if (!proj) return;
    if (!state.team.length) { alert('Add your team on the "Team & salaries" tab first.'); return; }
    const line = { id: uid(), personId: state.team[0].id, hours: 0 };
    proj.lines = proj.lines || [];
    proj.lines.push(line);
    renderProject(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/lines`, {
      method: 'POST',
      body: JSON.stringify(line),
    }));
  });

  /* direct costs */
  $('#dcBody').addEventListener('input', (e) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(e.target), f = e.target.dataset.f; if (!id || !f) return;
    const d = proj.direct.find((v) => v.id === id); if (!d) return;
    const nextValue = f === 'amount' ? num(e.target.value) : e.target.value;
    d[f] = nextValue;
    recompute();
  });
  bindCommitOnBlur($('#dcBody'), (el) => el.matches('input,select') && !!el.dataset.f, (el) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(el), f = el.dataset.f; if (!id || !f) return;
    const d = proj.direct.find((v) => v.id === id); if (!d) return;
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/direct-costs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ [f]: d[f] }),
    }));
  });
  $('#dcBody').addEventListener('click', (e) => {
    if (e.target.dataset.del !== 'dc') return;
    const proj = currentProject();
    const id = findRow(e.target);
    proj.direct = proj.direct.filter((d) => d.id !== id);
    renderProject(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/direct-costs/${id}`, { method: 'DELETE' }));
  });
  $('#addDC').addEventListener('click', () => {
    const proj = currentProject(); if (!proj) return;
    const direct = { id: uid(), name: '', amount: 0, cur: S().currency };
    proj.direct = proj.direct || [];
    proj.direct.push(direct);
    renderProject(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/direct-costs`, {
      method: 'POST',
      body: JSON.stringify(direct),
    }));
  });

  /* project switching */
  ['#projSelect', '#scenProjSelect', '#quoteProjSelect'].forEach((sel) => {
    $(sel).addEventListener('change', (e) => {
      state.ui.currentProject = e.target.value;
      renderAllStructures();
    });
  });
  $('#addProject').addEventListener('click', async () => {
    const draft = {
      id: uid(), name: 'New project', client: '', months: 1, status: 'Quoting', start: thisMonth(), cur: S().currency,
      lines: [], direct: [], cont: S().contingency, target: S().targetMargin, price: null,
      scenarios: [{ id: uid(), name: 'As planned', hoursFactor: 100, extra: 0, price: null }],
      quote: {
        num: '', date: new Date().toISOString().slice(0, 10), valid: 30, detail: 'lump', disc: 0, vat: 0,
        scope: '', terms: '', lines: [],
      },
    };
    try {
      const response = await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(draft) });
      const created = response && response.project ? response.project : draft;
      state.projects.push(created);
      state.ui.currentProject = created.id;
      renderAllStructures(); $('#p_name').select();
    } catch (err) {
      console.warn('Create project failed:', err.message);
      showSaveError('Could not create the project on the server: ' + (err.message || 'unknown error') + '. Please try again.');
    }
  });
  $('#dupProject').addEventListener('click', async () => {
    const proj = currentProject(); if (!proj) return;
    const copy = JSON.parse(JSON.stringify(proj));
    copy.id = uid(); copy.name = (proj.name || 'Project') + ' (copy)';
    copy.lines.forEach((l) => { l.id = uid(); });
    (copy.direct || []).forEach((d) => { d.id = uid(); });
    (copy.scenarios || []).forEach((s) => { s.id = uid(); });
    (copy.quote.lines || []).forEach((l) => { l.id = uid(); });
    try {
      const response = await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(copy) });
      const created = response && response.project ? response.project : copy;
      state.projects.push(created);
      state.ui.currentProject = created.id;
      renderAllStructures();
    } catch (err) {
      console.warn('Duplicate project failed:', err.message);
      showSaveError('Could not save the duplicated project to the server: ' + (err.message || 'unknown error') + '. Please try again.');
    }
  });
  $('#delProject').addEventListener('click', async () => {
    const proj = currentProject(); if (!proj) return;
    if (!confirm('Delete "' + (proj.name || 'this project') + '"?')) return;
    try {
      const response = await apiRequest(`/api/projects/${proj.id}`, { method: 'DELETE' });
      if (Array.isArray(response.projects)) {
        state.projects = response.projects;
      } else {
        state.projects = state.projects.filter((p) => p.id !== proj.id);
      }
      state.ui.currentProject = state.projects.length ? state.projects[0].id : null;
      renderAllStructures();
    } catch (err) {
      console.warn('Delete project failed:', err.message);
      showSaveError('Could not delete the project on the server: ' + (err.message || 'unknown error') + '. Please try again.');
    }
  });
}
