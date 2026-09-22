import { $, esc, setOut, recompute } from './dom.js';
import { state, S } from './state.js';
import { num, fmt, money } from './format.js';
import { company, personCalc, bookings, monthWindow, monthKeyOf, monthLabel, thisMonth, loadColour } from './calc.js';

/* No dedicated render function in the original either — computes AND paints
   in one pass, same shape as Dashboard. */
export function renderCapacity() {
  const tbl = $('#capTable'); if (!tbl) return;
  const months = monthWindow(num($('#capWindow').value) || 6);
  const includeQ = $('#capQuoting').checked;
  const book = bookings(includeQ);
  const co = company();

  if (!state.team.length) {
    tbl.innerHTML = `<tbody><tr><td class="muted">Add your team first and the capacity grid appears here.</td></tr></tbody>`;
    ['c.free', 'c.freeNote', 'c.value', 'c.over', 'c.overNote'].forEach((k) => setOut(k, '—'));
    return;
  }
  const head = `<thead><tr><th style="min-width:150px">Person</th><th class="num">Hrs/mo</th>` +
    months.map((k) => `<th class="num">${monthLabel(k)}</th>`).join('') + `</tr></thead>`;

  let freeTotal = 0;
  const rows = state.team.map((p) => {
    const cap = personCalc(p).billable;
    const cells = months.map((k) => {
      const bkd = (book[p.id] && book[p.id][k]) || 0;
      const u = cap > 0 ? bkd / cap : (bkd > 0 ? 2 : 0);
      freeTotal += Math.max(cap - bkd, 0);
      return `<td class="num">
        <div style="font-variant-numeric:tabular-nums">${fmt(bkd, 0)}<span class="muted"> / ${fmt(cap, 0)}</span></div>
        <div class="meter" style="height:5px; margin:3px 0 0"><div style="width:${Math.min(u * 100, 100)}%; background:${loadColour(u)}"></div></div>
      </td>`;
    }).join('');
    return `<tr><td>${esc(p.name || 'Unnamed')}<div class="muted" style="font-size:11.5px">${esc(p.role || '')}</div></td>
      <td class="num">${fmt(cap, 0)}</td>${cells}</tr>`;
  }).join('');

  let oversold = 0;
  const totals = months.map((k) => {
    const bkd = state.team.reduce((s, p) => s + ((book[p.id] && book[p.id][k]) || 0), 0);
    const u = co.billableHours > 0 ? bkd / co.billableHours : 0;
    if (u > 1.0001) oversold++;
    return `<td class="num"><b>${Math.round(u * 100)}%</b>
      <div class="meter" style="height:5px; margin:3px 0 0"><div style="width:${Math.min(u * 100, 100)}%; background:${loadColour(u)}"></div></div></td>`;
  }).join('');
  tbl.innerHTML = head + `<tbody>${rows}</tbody><tfoot><tr>
    <td>Whole team</td><td class="num">${fmt(co.billableHours, 0)}</td>${totals}</tr></tfoot>`;

  const k = (1 + num(S().contingency) / 100) / (num(S().targetMargin) / 100 < 0.95 ? (1 - num(S().targetMargin) / 100) : 1);
  setOut('c.free', fmt(freeTotal, 0) + ' hrs');
  setOut('c.freeNote', `across ${months.length} months · ${fmt(freeTotal / months.length, 0)} hrs a month on average`);
  setOut('c.value', money(freeTotal * co.blended * k));
  setOut('c.over', String(oversold));
  setOut('c.overNote', oversold ? 'months where the team is booked past 100%' : 'no month is oversold in this window');

  /* fit test */
  const fh = num($('#fitHours').value), fm = Math.max(1, Math.round(num($('#fitMonths').value) || 1));
  const fs = $('#fitStart').value || thisMonth();
  const [fy, fmo] = fs.split('-').map(Number);
  let worst = 0, worstKey = null;
  for (let i = 0; i < fm; i++) {
    const key = monthKeyOf(fy, fmo - 1 + i);
    const bkd = state.team.reduce((s, p) => s + ((book[p.id] && book[p.id][key]) || 0), 0) + fh / fm;
    const u = co.billableHours > 0 ? bkd / co.billableHours : (bkd > 0 ? 99 : 0);
    if (u > worst) { worst = u; worstKey = key; }
  }
  const sig = $('#fitSignal');
  let colour, title, note;
  if (fh <= 0) {
    colour = 'var(--axis)'; title = 'Nothing to test yet';
    note = 'Enter the hours a prospective job would take.';
  } else if (worst > 1.0001) {
    colour = 'var(--critical)'; title = `It does not fit — ${Math.round(worst * 100)}% in ${monthLabel(worstKey)}`;
    note = `You would be short about ${fmt((worst - 1) * co.billableHours, 0)} hrs that month. Push the start, stretch the timeline, or plan for a freelancer.`;
  } else if (worst > 0.85) {
    colour = 'var(--warn)'; title = `Tight — ${Math.round(worst * 100)}% in ${monthLabel(worstKey)}`;
    note = 'It fits on paper, with almost no slack for revisions or anything going late.';
  } else {
    colour = 'var(--good)'; title = `It fits — peaks at ${Math.round(worst * 100)}% in ${monthLabel(worstKey)}`;
    note = 'Comfortable alongside everything already booked.';
  }
  sig.querySelector('.lamp').style.background = colour;
  setOut('c.fitTitle', title); setOut('c.fitNote', ' ' + note);
}

/* Capacity-tab inputs — bound here (by tab ownership) rather than in
   settingsPanel.js's bindSettings(), where the original file grouped them
   despite them having nothing to do with Settings (see Stage 2). */
export function bindCapacityInputs() {
  ['#capQuoting', '#capWindow', '#fitHours', '#fitStart', '#fitMonths'].forEach((sel) =>
    $(sel).addEventListener('input', () => recompute()));
}
