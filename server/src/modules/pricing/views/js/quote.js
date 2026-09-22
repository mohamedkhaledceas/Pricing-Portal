import { $, esc, uid, findRow, bindCommitOnBlur, queueAutoSave, setOut, recompute } from './dom.js';
import { S } from './state.js';
import { num, fmt, m0, money, pct, toBase } from './format.js';
import { currentProject, projectCalc } from './calc.js';
import { logoSrc } from './theme.js';
import { apiRequest } from './apiClient.js';

export function renderQuoteInputs() {
  const proj = currentProject(); if (!proj) return;
  const q = proj.quote;
  $('#q_num').value = q.num || ''; $('#q_date').value = q.date || ''; $('#q_valid').value = q.valid || 30;
  $('#q_detail').value = q.detail || 'lump'; $('#q_disc').value = q.disc || 0; $('#q_vat').value = q.vat || 0;
  $('#q_scope').value = q.scope || ''; $('#q_terms').value = q.terms || '';
  $('#q_customWrap').hidden = q.detail !== 'phase';
  $('#qlBody').innerHTML = (q.lines || []).map((l) => `
    <tr data-id="${l.id}">
      <td><input data-f="name" value="${esc(l.name)}"></td>
      <td class="num"><input data-f="amount" type="number" min="0" step="500" value="${l.amount}"></td>
      <td><button class="tiny danger" data-del="ql">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="3" class="muted">No lines yet.</td></tr>`;
  $('#qlFoot').innerHTML = (q.lines || []).length ? `<tr><td>Total of lines</td><td class="num" data-out="ql.total">—</td><td></td></tr>` : '';
}

/* ---------- quotation ---------- */
function quoteRows(proj, c) {
  const q = proj.quote;
  if (q.detail === 'lump') {
    return [[proj.name || 'Professional services', c.price]];
  }
  if (q.detail === 'role') {
    const byRole = {};
    c.byPerson.forEach((bp) => {
      const key = (bp.person && (bp.person.role || bp.person.name)) || 'Team';
      byRole[key] = (byRole[key] || 0) + bp.hours;
    });
    const totalHours = Object.values(byRole).reduce((s, h) => s + h, 0) || 1;
    const rows = Object.entries(byRole).map(([r, h]) => [`${r} — ${fmt(h, 0)} hrs`, c.price * (h / totalHours)]);
    if (!rows.length) return [[proj.name || 'Professional services', c.price]];
    return rows;
  }
  const lines = (q.lines || []).filter((l) => l.name);
  const qc = proj.cur || S().currency;
  const sum = lines.reduce((s, l) => s + toBase(l.amount, qc), 0);
  if (!lines.length) return [[proj.name || 'Professional services', c.price]];
  if (sum === 0) return lines.map((l) => [l.name, c.price / lines.length]);
  return lines.map((l) => [l.name, toBase(l.amount, qc)]);
}
function quoteTotals(proj, c) {
  const q = proj.quote;
  const rows = quoteRows(proj, c);
  const sub = rows.reduce((s, r) => s + r[1], 0);
  const disc = sub * (num(q.disc) / 100);
  const net = sub - disc;
  const vat = net * (num(q.vat) / 100);
  return { rows, sub, disc, net, vat, total: net + vat };
}
function quoteHTML(proj, c, forPrint) {
  const q = proj.quote, cur = proj.cur || S().currency;
  const f = (v) => m0(v, cur);
  const t = quoteTotals(proj, c);
  const validUntil = q.date ? new Date(new Date(q.date).getTime() + num(q.valid) * 86400000).toISOString().slice(0, 10) : '';
  return `
    <div style="display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap">
      <div>
        ${S().logoQuote !== false ? `<img src="${logoSrc(forPrint)}" alt="" style="height:${forPrint ? '16mm' : '46px'}; width:auto; margin-bottom:10px">` : ''}
        <h1 style="margin:0 0 2px; font-size:${forPrint ? '20pt' : '20px'}">${esc(S().company || 'Quotation')}</h1>
        <div class="doc-meta" style="color:${forPrint ? '#444' : 'var(--muted)'}">Quotation${q.num ? ' ' + esc(q.num) : ''}</div>
      </div>
      <div style="text-align:right; font-size:${forPrint ? '10.5pt' : '13px'}; color:${forPrint ? '#444' : 'var(--ink-2)'}">
        <div><b>Client:</b> ${esc(proj.client || '—')}</div>
        <div><b>Date:</b> ${esc(q.date || '—')}</div>
        ${validUntil ? `<div><b>Valid until:</b> ${esc(validUntil)}</div>` : ''}
      </div>
    </div>
    <div style="margin-top:16px"><b>${esc(proj.name || 'Project')}</b></div>
    ${q.scope ? `<div style="margin-top:6px; white-space:pre-wrap; color:${forPrint ? '#333' : 'var(--ink-2)'}">${esc(q.scope)}</div>` : ''}
    <table style="width:100%; border-collapse:collapse; margin-top:16px">
      <thead><tr>
        <th style="text-align:left; border-bottom:1px solid ${forPrint ? '#999' : 'var(--axis)'}; padding:6px 4px">Description</th>
        <th style="text-align:right; border-bottom:1px solid ${forPrint ? '#999' : 'var(--axis)'}; padding:6px 4px">Amount (${esc(cur)})</th>
      </tr></thead>
      <tbody>
        ${t.rows.map((r) => `<tr>
          <td style="padding:7px 4px; border-bottom:1px solid ${forPrint ? '#eee' : 'var(--grid)'}">${esc(r[0])}</td>
          <td style="padding:7px 4px; border-bottom:1px solid ${forPrint ? '#eee' : 'var(--grid)'}; text-align:right; font-variant-numeric:tabular-nums">${f(r[1])}</td></tr>`).join('')}
      </tbody>
      <tfoot>
        ${t.disc > 0 ? `<tr><td style="padding:6px 4px; text-align:right">Subtotal</td><td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums">${f(t.sub)}</td></tr>
        <tr><td style="padding:6px 4px; text-align:right">Discount ${fmt(num(q.disc), 0)}%</td><td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums">−${f(t.disc)}</td></tr>` : ''}
        ${num(q.vat) > 0 ? `<tr><td style="padding:6px 4px; text-align:right">Net</td><td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums">${f(t.net)}</td></tr>
        <tr><td style="padding:6px 4px; text-align:right">VAT ${fmt(num(q.vat), num(q.vat) % 1 ? 1 : 0)}%</td><td style="padding:6px 4px; text-align:right; font-variant-numeric:tabular-nums">${f(t.vat)}</td></tr>` : ''}
        <tr><td style="padding:9px 4px; text-align:right; border-top:1px solid ${forPrint ? '#999' : 'var(--axis)'}; font-weight:700">Total</td>
            <td style="padding:9px 4px; text-align:right; border-top:1px solid ${forPrint ? '#999' : 'var(--axis)'}; font-weight:700; font-variant-numeric:tabular-nums">${f(t.total)} ${esc(cur)}</td></tr>
      </tfoot>
    </table>
    ${q.terms ? `<div style="margin-top:18px; white-space:pre-wrap; font-size:${forPrint ? '10pt' : '12.5px'}; color:${forPrint ? '#333' : 'var(--ink-2)'}">${esc(q.terms)}</div>` : ''}
  `;
}
function renderQuotePreview(proj, c) {
  const el = $('#quotePreview'); if (!el) return;
  el.innerHTML = quoteHTML(proj, c, false);
  const t = quoteTotals(proj, c);
  const realMargin = t.net > 0 ? (t.net - c.cost) / t.net : 0;
  setOut('q.check', `After discount the client pays ${money(t.net, 0, proj.cur || S().currency)} before VAT — margin ${pct(realMargin)}${realMargin < 0.1 ? ' ⚠︎ very thin' : ''}`);
}

export function computeQuoteOutputs() {
  const proj = currentProject();
  if (!proj) return;
  const c = projectCalc(proj);
  const q = proj.quote;
  setOut('ql.total', fmt((q.lines || []).reduce((s, l) => s + num(l.amount), 0)));
  renderQuotePreview(proj, c);
}

export function bindQuoteTable() {
  const qf = {
    '#q_num': 'num', '#q_date': 'date', '#q_valid': 'valid', '#q_detail': 'detail',
    '#q_disc': 'disc', '#q_vat': 'vat', '#q_scope': 'scope', '#q_terms': 'terms',
  };
  Object.entries(qf).forEach(([sel, key]) => {
    const el = $(sel);
    el.addEventListener('input', (e) => {
      const proj = currentProject(); if (!proj) return;
      const nextValue = (key === 'valid' || key === 'disc' || key === 'vat') ? num(e.target.value) : e.target.value;
      proj.quote[key] = nextValue;
      if (key === 'detail') $('#q_customWrap').hidden = e.target.value !== 'phase';
      recompute();
    });
    bindCommitOnBlur(el, () => true, () => {
      const proj = currentProject(); if (!proj) return;
      queueAutoSave(() => apiRequest(`/api/projects/${proj.id}`, {
        method: 'PUT',
        body: JSON.stringify({ quote: { ...proj.quote, [key]: proj.quote[key] } }),
      }));
    });
  });
  $('#qlBody').addEventListener('input', (e) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(e.target), f = e.target.dataset.f; if (!id || !f) return;
    const l = proj.quote.lines.find((v) => v.id === id); if (!l) return;
    const nextValue = f === 'amount' ? num(e.target.value) : e.target.value;
    l[f] = nextValue;
    recompute();
  });
  bindCommitOnBlur($('#qlBody'), (el) => el.matches('input,select') && !!el.dataset.f, (el) => {
    const proj = currentProject(); if (!proj) return;
    const id = findRow(el), f = el.dataset.f; if (!id || !f) return;
    const l = proj.quote.lines.find((v) => v.id === id); if (!l) return;
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/quote-lines/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ [f]: l[f] }),
    }));
  });
  $('#qlBody').addEventListener('click', (e) => {
    if (e.target.dataset.del !== 'ql') return;
    const proj = currentProject();
    const id = findRow(e.target);
    proj.quote.lines = proj.quote.lines.filter((l) => l.id !== id);
    renderQuoteInputs(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/quote-lines/${id}`, { method: 'DELETE' }));
  });
  $('#addQL').addEventListener('click', () => {
    const proj = currentProject(); if (!proj) return;
    const line = { id: uid(), name: '', amount: 0 };
    proj.quote.lines = proj.quote.lines || [];
    proj.quote.lines.push(line);
    renderQuoteInputs(); recompute();
    queueAutoSave(() => apiRequest(`/api/projects/${proj.id}/quote-lines`, {
      method: 'POST',
      body: JSON.stringify(line),
    }));
  });
  $('#btnPrint').addEventListener('click', () => {
    const proj = currentProject(); if (!proj) return;
    $('#printArea').innerHTML = quoteHTML(proj, projectCalc(proj), true);
    window.print();
  });
}
