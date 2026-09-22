import { $, $$, esc, uid, findRow, bindCommitOnBlur, queueAutoSave, setOut, recompute } from './dom.js';
import { state, S, applyServerTeam } from './state.js';
import { num, fmt, m0, toBase, curOpts } from './format.js';
import { personCalc } from './calc.js';
import { apiRequest } from './apiClient.js';

function personById(id) { return state.team.find((p) => p.id === id) || null; }

export function renderTeam() {
  const body = $('#teamBody');
  body.innerHTML = state.team.map((p) => `
    <tr data-id="${p.id}">
      <td><input data-f="name" value="${esc(p.name)}" placeholder="Name"></td>
      <td><input data-f="role" value="${esc(p.role)}" placeholder="Role"></td>
      <td><select data-f="cur" style="min-width:62px">${curOpts(p.cur || S().currency)}</select></td>
      <td class="num"><input data-f="salary" type="number" min="0" step="500" value="${p.salary}"></td>
      <td class="num"><input data-f="extras" type="number" min="0" step="100" value="${p.extras}"></td>
      <td class="num"><input data-f="hours" type="number" min="1" step="1" value="${p.hours}"></td>
      <td class="num"><input data-f="util" type="number" min="1" max="100" step="5" value="${p.util}"></td>
      <td class="num"><input data-f="override" type="number" min="0" step="10" value="${p.override === null || p.override === undefined ? '' : p.override}" placeholder="auto"></td>
      <td class="num calc" data-out="t.${p.id}.bh">—</td>
      <td class="num calc" data-out="t.${p.id}.rate">—</td>
      <td><button class="tiny danger" data-del="person">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="11" class="muted">No one yet — add your first team member below.</td></tr>`;
  $('#teamFoot').innerHTML = state.team.length ? `<tr>
      <td colspan="2">Total <span class="muted" data-out="cur.disp"></span></td>
      <td></td>
      <td class="num" data-out="t.sumSalary">—</td>
      <td class="num" data-out="t.sumExtras">—</td>
      <td class="num"></td><td class="num"></td><td class="num"></td>
      <td class="num" data-out="t.sumBH">—</td><td colspan="2"></td>
    </tr>` : '';
}

export function computeTeamOutputs() {
  let sumSalary = 0, sumExtras = 0, sumBH = 0;
  state.team.forEach((p) => {
    const c = personCalc(p);
    setOut(`t.${p.id}.bh`, fmt(c.billable, 0));
    setOut(`t.${p.id}.rate`, m0(c.rate));
    sumSalary += toBase(p.salary, p.cur); sumExtras += toBase(p.extras, p.cur); sumBH += c.billable;
  });
  setOut('t.sumSalary', m0(sumSalary)); setOut('t.sumExtras', m0(sumExtras)); setOut('t.sumBH', fmt(sumBH, 0));
}

export function bindTeamTable() {
  $('#teamBody').addEventListener('input', (e) => {
    const id = findRow(e.target), f = e.target.dataset.f; if (!id || !f) return;
    const p = personById(id); if (!p) return;
    const nextValue = (f === 'name' || f === 'role' || f === 'cur') ? e.target.value
      : (f === 'override' ? (e.target.value === '' ? null : num(e.target.value)) : num(e.target.value));
    p[f] = nextValue;
    recompute();
  });
  bindCommitOnBlur($('#teamBody'), (el) => el.matches('input,select') && !!el.dataset.f, (el) => {
    const id = findRow(el), f = el.dataset.f; if (!id || !f) return;
    const p = personById(id); if (!p) return;
    queueAutoSave(async () => {
      const response = await apiRequest(`/api/team/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ [f]: p[f] }),
      });
      if (Array.isArray(response.team)) applyServerTeam(response.team);
      renderTeam(); recompute();
    });
  });
  $('#teamBody').addEventListener('click', (e) => {
    if (e.target.dataset.del !== 'person') return;
    const id = findRow(e.target);
    state.team = state.team.filter((p) => p.id !== id);
    state.projects.forEach((pr) => { pr.lines = (pr.lines || []).filter((l) => l.personId !== id); });
    renderTeam(); recompute();
    queueAutoSave(async () => {
      const response = await apiRequest(`/api/team/${id}`, { method: 'DELETE' });
      if (Array.isArray(response.team)) applyServerTeam(response.team);
      renderTeam(); recompute();
    });
  });
  $('#addPerson').addEventListener('click', async () => {
    const person = {
      name: '', role: '', salary: 0, extras: 0, cur: S().currency,
      hours: S().defaultHours, util: S().defaultUtil, override: null,
    };
    try {
      const response = await apiRequest('/api/team', {
        method: 'POST',
        body: JSON.stringify(person),
      });
      if (Array.isArray(response.team)) {
        applyServerTeam(response.team);
      } else {
        state.team.push({ ...person, id: uid(), cur: S().currency, hours: S().defaultHours, util: S().defaultUtil, override: null });
      }
      renderTeam(); recompute();
    } catch (err) {
      console.warn('Add team member failed:', err.message);
    }
    const rows = $$('#teamBody tr'); const last = rows[rows.length - 1];
    if (last) { const f = last.querySelector('input'); if (f) f.focus(); }
  });
}
