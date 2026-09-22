import { $, esc, uid, findRow, bindCommitOnBlur, queueAutoSave, setOut, recompute } from './dom.js';
import { state, S } from './state.js';
import { num, fmt, m0, money, curOpts } from './format.js';
import { expMonthly, company } from './calc.js';
import { apiRequest } from './apiClient.js';

export function renderExpenses() {
  const body = $('#expBody');
  body.innerHTML = state.expenses.map((e) => `
    <tr data-id="${e.id}">
      <td><input data-f="name" value="${esc(e.name)}" placeholder="Expense"></td>
      <td><input data-f="cat" value="${esc(e.cat)}" placeholder="Category"></td>
      <td><select data-f="cur" style="min-width:62px">${curOpts(e.cur || S().currency)}</select></td>
      <td class="num"><input data-f="amount" type="number" min="0" step="100" value="${e.amount}"></td>
      <td><select data-f="freq">
        ${['month', 'quarter', 'year', 'week'].map((f) => `<option value="${f}" ${e.freq === f ? 'selected' : ''}>per ${f}</option>`).join('')}
      </select></td>
      <td class="num calc" data-out="x.${e.id}.m">—</td>
      <td><button class="tiny danger" data-del="expense">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="7" class="muted">No fixed expenses yet.</td></tr>`;
  $('#expFoot').innerHTML = state.expenses.length ? `<tr>
      <td colspan="5">Total per month</td><td class="num" data-out="x.total">—</td><td></td></tr>` : '';
}

export function computeExpenseOutputs() {
  const co = company();
  state.expenses.forEach((e) => setOut(`x.${e.id}.m`, m0(expMonthly(e))));
  setOut('x.total', m0(co.fixed));
  setOut('e.total', money(co.fixed));
  setOut('e.hours', fmt(co.billableHours, 0) + ' hrs');
  setOut('e.perHour', money(co.ohPerHour, 2) + ' per hour');
}

export function bindExpensesTable() {
  $('#expBody').addEventListener('input', (e) => {
    const id = findRow(e.target), f = e.target.dataset.f; if (!id || !f) return;
    const x = state.expenses.find((v) => v.id === id); if (!x) return;
    const nextValue = (f === 'amount') ? num(e.target.value) : e.target.value;
    x[f] = nextValue;
    recompute();
  });
  $('#expBody').addEventListener('change', (e) => {
    if (e.target.dataset.f === 'freq') recompute();
  });
  bindCommitOnBlur($('#expBody'), (el) => el.matches('input,select') && !!el.dataset.f, (el) => {
    const id = findRow(el), f = el.dataset.f; if (!id || !f) return;
    const x = state.expenses.find((v) => v.id === id); if (!x) return;
    queueAutoSave(() => apiRequest(`/api/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ [f]: x[f] }),
    }));
  });
  $('#expBody').addEventListener('click', (e) => {
    if (e.target.dataset.del !== 'expense') return;
    const id = findRow(e.target);
    state.expenses = state.expenses.filter((v) => v.id !== id);
    renderExpenses(); recompute();
    queueAutoSave(() => apiRequest(`/api/expenses/${id}`, { method: 'DELETE' }));
  });
  $('#addExpense').addEventListener('click', () => {
    const expense = { id: uid(), name: '', cat: '', amount: 0, freq: 'month', cur: S().currency };
    state.expenses.push(expense);
    renderExpenses(); recompute();
    queueAutoSave(() => apiRequest('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    }));
  });
}
