import { $, esc, setOut } from './dom.js';
import { state } from './state.js';
import { fmt, m0, money, pct } from './format.js';
import { company, projectCalc, marginPill, bookings, thisMonth, monthLabel } from './calc.js';

/* No dedicated render function in the original either — the whole
   Dashboard tab is compute-and-paint-directly, same shape as Capacity. */
export function computeDashboardOutputs() {
  const co = company();

  setOut('d.burn', money(co.burn));
  setOut('d.burnNote', `${money(co.payroll)} people · ${money(co.fixed)} fixed`);
  setOut('d.cap', fmt(co.billableHours, 0) + ' hrs');
  setOut('d.capNote', `of ${fmt(co.workHours, 0)} paid hours · ${co.workHours > 0 ? Math.round(co.billableHours / co.workHours * 100) : 0}% billable`);
  setOut('d.blended', money(co.blended, 0));
  setOut('d.dayrate', money(co.blended * 8, 0));
  setOut('d.payroll', money(co.payroll));
  setOut('d.fixed', money(co.fixed));

  const stack = $('#stackBurn');
  if (stack) {
    const tot = co.burn || 1;
    stack.innerHTML =
      `<div style="background:var(--s1); width:${co.payroll / tot * 100}%" title="Salaries"></div>
       <div style="background:var(--s2); width:${co.fixed / tot * 100}%" title="Fixed expenses"></div>`;
  }

  /* pipeline */
  const active = state.projects.filter((p) => p.status !== 'Lost' && p.status !== 'Archived');
  let pipeRev = 0, pipeCost = 0;
  const rows = state.projects.map((p) => {
    const c = projectCalc(p);
    if (p.status !== 'Lost' && p.status !== 'Archived') { pipeRev += c.price; pipeCost += c.cost; }
    const dim = (p.status === 'Lost' || p.status === 'Archived') ? ' style="opacity:.5"' : '';
    return `<tr${dim}>
      <td>${esc(p.name || 'Untitled')}</td><td>${esc(p.client || '')}</td>
      <td class="num">${fmt(c.hours, 0)}</td><td class="num">${m0(c.cost)}</td>
      <td class="num">${m0(c.price)}</td><td class="num">${m0(c.profit)}</td>
      <td class="num">${pct(c.margin)}</td><td>${marginPill(c.margin)}</td></tr>`;
  }).join('');
  const pb = $('#pipelineBody');
  if (pb) {
    pb.innerHTML = rows || `<tr><td colspan="8" class="muted">No projects yet — build one in the Project estimator.</td></tr>`;
    $('#pipelineFoot').innerHTML = state.projects.length ? `<tr>
      <td colspan="2">Active projects (${active.length})</td>
      <td class="num">${fmt(active.reduce((s, p) => s + projectCalc(p).hours, 0), 0)}</td>
      <td class="num">${m0(pipeCost)}</td><td class="num">${m0(pipeRev)}</td>
      <td class="num">${m0(pipeRev - pipeCost)}</td>
      <td class="num">${pct(pipeRev > 0 ? (pipeRev - pipeCost) / pipeRev : 0)}</td><td></td></tr>` : '';
  }
  setOut('d.pipeRev', money(pipeRev)); setOut('d.pipeCost', money(pipeCost));
  setOut('d.pipeMargin', pct(pipeRev > 0 ? (pipeRev - pipeCost) / pipeRev : 0));

  /* the dashboard meter shows this calendar month, on the same engine as the Capacity tab */
  const bookNow = bookings(true), nowKey = thisMonth();
  const bookedPerMonth = state.team.reduce((s, p) => s + ((bookNow[p.id] && bookNow[p.id][nowKey]) || 0), 0);
  const capUse = co.billableHours > 0 ? bookedPerMonth / co.billableHours : 0;
  const mc = $('#meterCap');
  if (mc) {
    mc.style.width = Math.min(capUse * 100, 100) + '%';
    mc.style.background = capUse > 1 ? 'var(--critical)' : (capUse > 0.85 ? 'var(--s4)' : 'var(--s1)');
  }
  setOut('d.capacityLine',
    `${monthLabel(nowKey)}: ${fmt(bookedPerMonth, 0)} hrs booked of ${fmt(co.billableHours, 0)} available — ${Math.round(capUse * 100)}% used` +
    (capUse > 1 ? ' · over capacity, you will need freelancers or longer timelines'
      : (co.billableHours > 0 ? ` · ${fmt(Math.max(co.billableHours - bookedPerMonth, 0), 0)} hrs still sellable` : '')));
}
