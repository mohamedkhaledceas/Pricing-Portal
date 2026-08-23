/* Section renderers ported from the CEO dashboard prototype. Business
   rules preserved as-is (composite health score display, RAG mapping,
   funnel leak math, concentration/coverage/DSO framing, etc.) — the only
   real change from the prototype is the data source: `e`/`b` here come
   from state.snapshotCache/briefCache (populated by main.js's fetch to
   /api/ceo-dashboard/*) instead of inline DATA/BRIEFS constants, and the
   per-entity "done" action set lives on state.doneActions instead of a
   bare module-level Set. */
import { $, $$, escapeHtml as esc } from './dom.js';
import { state } from './state.js';
import {
  money, egp, num, deltaHTML, sevOf, sevColor, RAGMAP, badge, buildTable,
  chartBarsH, chartColumns, chartLine, chartStackH, sparkSVG, tile, meter,
} from './charts.js';

const CHARTS = {}; // data-chart key -> (mount) => ({headers, rows}) | null

function currentEntity() {
  return state.snapshotCache[state.entity];
}
function currentBrief() {
  return state.briefCache[state.entity];
}

function renderShell() {
  const shell = state.shell;
  if (!shell) return;
  $('#asof').textContent = shell.asOfLabel;
  $('#sync').innerHTML = shell.syncStatus.map((s) =>
    `<span><i class="dot"></i><b style="font-weight:600">${esc(s.source)}</b> synced ${esc(s.lastSync)} · ${esc(s.note)}</span>`).join('');
}

function renderBrief() {
  const b = currentBrief();
  if (!b) return;
  $('#briefdate').textContent = b.date;
  $('#briefheadline').textContent = b.headline;
  $('#briefbody').innerHTML = b.sections.map((s) =>
    `<div class="bsec"><h4>${esc(s.title)}</h4><ul>${s.items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`).join('');
}

function renderHealth() {
  const e = currentEntity(), h = e.health;
  $('#hscore').textContent = h.score;
  $('#healthsub').textContent = state.entity === 'all'
    ? 'Revenue-weighted composite across both entities.'
    : 'A weighted composite of six components. Weights are configuration, not doctrine — change them and the score changes.';
  $('#hdeltas').innerHTML =
    `<span>vs 7 days ${deltaHTML(h.score - h.prior7, true, ' pts')}</span>
     <span>vs 30 days ${deltaHTML(h.score - h.prior30, true, ' pts')}</span>`;
  if (h.components) {
    $('#hcomponents').innerHTML = h.components.map(meter).join('');
  } else {
    $('#hcomponents').innerHTML = `<div class="empty">Component breakdown is per entity. Switch to Ceas Comm or Learn with Marie to see it.</div>`;
  }
  CHARTS.healthTrend = h.series
    ? (m) => chartLine(m, { labels: h.labels, values: h.series, valueFmt: (v) => String(v), reference: 70, refLabel: 'healthy floor', unit: 'Score' })
    : null;
}

function renderActions() {
  const e = currentEntity(), acts = e.actions;
  if (!acts) {
    $('#actsub').textContent = '';
    $('#actions').innerHTML = `<div class="empty">The consolidated view rolls up numbers only. Switch to an entity to see its decision queue.</div>`;
    return;
  }
  const open = acts.filter((_, i) => !state.doneActions.has(state.entity + i)).length;
  $('#actsub').textContent = `${open} open item${open === 1 ? '' : 's'} — each states why it matters and what the system suggests. Every decision is logged.`;
  const kindLabel = { approve: 'Approve', decide: 'Decide', review: 'Review' };
  $('#actions').innerHTML = acts.map((a, i) => {
    const done = state.doneActions.has(state.entity + i);
    return `<div class="item ${done ? 'done' : ''}">
      <div class="body">
        <div class="meta">${badge(a.urgency, kindLabel[a.kind])}<span class="pill">${esc(a.block)}</span>
          <span class="pill">due ${esc(a.due)}</span></div>
        <div class="ti">${esc(a.title)}</div>
        <div class="why">${esc(a.why)}</div>
        <div class="sg"><b>Suggested:</b> ${esc(a.suggested)}</div>
      </div>
      <div class="acts"><button class="mini" data-done="${i}">${done ? 'Reopen' : 'Mark handled'}</button></div>
    </div>`;
  }).join('');
  $$('#actions [data-done]').forEach((b) => b.addEventListener('click', () => {
    const k = state.entity + b.dataset.done;
    state.doneActions.has(k) ? state.doneActions.delete(k) : state.doneActions.add(k);
    renderActions();
  }));
}

function renderRevenue() {
  const e = currentEntity(), r = e.revenue;
  $('#revsub').textContent = state.entity === 'lwm'
    ? 'Education line — cohort programmes, consulting and digital products.'
    : state.entity === 'all' ? 'Both entities combined. Drill into an entity for client and service-line detail.'
    : 'Net of media pass-through. Odoo is the source of every figure in this block.';
  $('#revchartsub').textContent = 'August is month-to-date (9 of 31 days)';

  const tiles = [
    tile({
      lab: 'Revenue year to date', val: egp(r.ytd),
      sec: `${r.ytdPct}% of the EGP ${money(r.ytdTarget)} YTD target`,
      delta: deltaHTML(+(r.ytdPct - 100).toFixed(1), true, '%'),
    }),
    tile({ lab: 'August month to date', val: egp(r.mtd), sec: `target ${egp(r.mtdTarget)} for the same 9 days` }),
  ];
  if (state.entity === 'ceas') {
    tiles.push(tile({
      lab: 'Gross margin (July)', val: r.margin + '%',
      sec: `target ${r.marginTarget}% · falling ${r.marginDeclineRun} months straight`,
      delta: deltaHTML(+(r.margin - r.marginPrior).toFixed(1), true, ' pts'),
      spark: sparkSVG(r.marginSeries),
    }));
    tiles.push(tile({ lab: 'Booked forward · 3 months', val: egp(r.bookedForward), sec: 'from signed contracts in Odoo' }));
    tiles.push(tile({ lab: 'Revenue per head', val: egp(r.revPerHead), sec: `YTD, ${r.agencyHeadcount} agency staff` }));
    tiles.push(tile({
      lab: 'Largest client share', val: r.concentration + '%',
      sec: 'Nile Bank · threshold 25%', delta: `<span class="delta down">▲ above threshold</span>`,
    }));
  }
  if (state.entity === 'lwm') {
    tiles.push(tile({ lab: 'Leads captured', val: num(r.leads_total), sec: `${r.qualRate}% qualified` }));
    tiles.push(tile({ lab: 'Consultations held', val: num(r.consults_held), sec: `${r.consults_booked} booked` }));
    tiles.push(tile({ lab: 'Lead → paid conversion', val: r.conversion + '%', sec: `${r.converted} customers year to date` }));
    tiles.push(tile({ lab: 'Launch #1 · October', val: r.launch_pct + '%', sec: `${r.launch_days} days out` }));
  }
  $('#revtiles').innerHTML = tiles.join('');

  CHARTS.revMonths = (m) => chartColumns(m, {
    labels: r.months, values: r.actual, target: r.targetFull, valueFmt: (v) => egp(v), partialLast: true, unit: 'Revenue (EGP)',
  });

  CHARTS.revLines = r.serviceLines
    ? (m) => chartBarsH(m, { items: r.serviceLines.map((s) => ({ name: s.name, value: s.value })), color: null, valueFmt: (v) => money(v), unit: 'Revenue (EGP)' })
    : null;

  CHARTS.revMix = r.mix
    ? (m) => chartStackH(m, {
        segments: [
          { name: 'Retainer', value: r.mix[0].value, color: getComputedStyle(document.documentElement).getPropertyValue('--s1').trim() },
          { name: 'Project', value: r.mix[1].value, color: getComputedStyle(document.documentElement).getPropertyValue('--s2').trim() },
        ],
        valueFmt: (v) => egp(v), unit: 'Revenue (EGP)',
      })
    : (r.funnel ? (m) => chartBarsH(m, { items: r.funnel.map((f) => ({ name: f.name, value: f.value })), valueFmt: (v) => num(v), unit: 'People' }) : null);

  CHARTS.revClients = r.clients
    ? (m) => chartBarsH(m, {
        items: r.clients.map((c, i) => ({
          name: c.name, value: c.value,
          color: i === 0 ? getComputedStyle(document.documentElement).getPropertyValue('--s1').trim() : getComputedStyle(document.documentElement).getPropertyValue('--demph').trim(),
          label: (c.value / r.trailing90 * 100).toFixed(1) + '%',
          extra: `${c.type} · ${c.am}${c.overdue ? ` · EGP ${money(c.overdue)} overdue` : ''}`,
        })),
        valueFmt: (v) => egp(v), unit: 'Trailing 90d (EGP)',
      })
    : null;

  const mixFig = $('[data-chart="revMix"]')?.closest('figure');
  if (mixFig) {
    mixFig.querySelectorAll('.legend,.revq').forEach((n) => n.remove());
    const s1 = getComputedStyle(document.documentElement).getPropertyValue('--s1').trim();
    const s2 = getComputedStyle(document.documentElement).getPropertyValue('--s2').trim();
    if (r.mix) {
      const l = document.createElement('div'); l.className = 'legend';
      l.innerHTML = `<span><i style="background:${s1}"></i>Retainer — ${egp(r.mix[0].value)}</span>
                   <span><i style="background:${s2}"></i>Project — ${egp(r.mix[1].value)}</span>`;
      mixFig.appendChild(l);
      const q = document.createElement('div'); q.className = 'revq'; q.style.marginTop = '16px';
      q.innerHTML = `<h3>Revenue quality</h3>
        <div class="kv"><span>Recurring monthly base</span><span>${egp(Math.round(r.mix[0].value / 7))}</span></div>
        <div class="kv"><span>Retainer share of revenue</span><span>62.0%</span></div>
        <div class="kv"><span>Booked forward · 3 months</span><span>${egp(r.bookedForward)}</span></div>
        <div class="kv"><span>Contracts ending within 90 days</span><span>1 · ${egp(1410000)}</span></div>
        <div class="kv"><span>Media pass-through excluded</span><span>${egp(r.passthrough)}</span></div>`;
      mixFig.appendChild(q);
    }
    mixFig.querySelector('.ct').textContent = r.mix ? 'Revenue mix · year to date' : 'Lead funnel · year to date';
  }
  const cliFig = $('[data-chart="revClients"]')?.closest('figure');
  if (cliFig) cliFig.style.display = r.clients ? '' : 'none';
  const linFig = $('[data-chart="revLines"]')?.closest('figure');
  if (linFig) linFig.style.display = r.serviceLines ? '' : 'none';

  $('#revnote').innerHTML = state.entity === 'ceas'
    ? `<div class="callout"><div><b>Nile Bank is 27.4% of trailing-90-day revenue</b> — above the 25% concentration threshold, and the same account whose Q4 campaign is currently 9 days behind. Concentration risk and delivery risk are pointing at the same client.</div></div>
       <p class="note">EGP ${money(r.passthrough)} of media spend billed gross to clients is excluded from revenue here. Whether that treatment is right is the open Finance question in the architecture doc — if it should be included, every margin figure on this page moves.</p>`
    : state.entity === 'lwm' ? `<p class="note">Learn with Marie invoices through the same Odoo database under a separate analytic account.</p>` : '';
}

function renderPipeline() {
  const e = currentEntity(), p = e.pipeline, r = e.revenue;
  if (state.entity === 'all') {
    $('#pipesub').textContent = '';
    $('#pipetiles').innerHTML = '';
    $('#pipechartt').textContent = '';
    $('#pipeside').innerHTML = `<div class="empty">Pipeline is tracked per entity. Switch to Ceas Comm or Learn with Marie.</div>`;
    CHARTS.pipeStages = null; return;
  }
  if (state.entity === 'lwm') {
    $('#pipesub').textContent = 'Lead funnel from the ClickUp 2026 Leads list — a different sales motion from the agency.';
    $('#pipetiles').innerHTML = [
      tile({ lab: 'Leads captured', val: num(r.leads_total), sec: 'year to date' }),
      tile({ lab: 'Qualified', val: num(r.leads_qualified), sec: `${r.qualRate}% of leads` }),
      tile({ lab: 'Consultations booked', val: num(r.consults_booked), sec: `${r.consults_held} held` }),
      tile({ lab: 'Converted', val: num(r.converted), sec: `${r.conversion}% of all leads` }),
    ].join('');
    $('#pipechartt').textContent = 'Funnel · year to date';
    const ramp = ['--o1', '--o2', '--o3', '--o4', '--o5'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
    CHARTS.pipeStages = (m) => chartBarsH(m, { items: r.funnel.map((f, i) => ({ name: f.name, value: f.value, color: ramp[i] })), valueFmt: (v) => num(v), unit: 'People' });
    $('#pipeside').innerHTML = `<h3>Where it leaks</h3>
      <div class="kv"><span>Lead → qualified</span><span>${r.qualRate}%</span></div>
      <div class="kv"><span>Qualified → consultation booked</span><span>${(r.consults_booked / r.leads_qualified * 100).toFixed(1)}%</span></div>
      <div class="kv"><span>Booked → held</span><span>${(r.consults_held / r.consults_booked * 100).toFixed(1)}%</span></div>
      <div class="kv"><span>Held → paid</span><span>${(r.converted / r.consults_held * 100).toFixed(1)}%</span></div>
      <p class="note">The drop from 214 qualified to 62 booked is the widest leak in the funnel.</p>`;
    return;
  }
  $('#pipesub').textContent = 'Open opportunities in Odoo CRM, weighted by stage probability.';
  $('#pipetiles').innerHTML = [
    tile({ lab: 'Open pipeline', val: egp(p.total), sec: `${p.count} opportunities` }),
    tile({ lab: 'Weighted value', val: egp(p.weighted), sec: 'by stage probability' }),
    tile({
      lab: 'Q4 coverage', val: p.coverage.toFixed(2) + '×',
      sec: `vs a ${p.coverageFloor.toFixed(2)}× floor on the EGP ${money(p.q4Target)} new-business target`,
      delta: `<span class="delta down">▼ below floor</span>`,
    }),
    tile({ lab: 'Win rate · 90 days', val: p.winRate + '%', delta: deltaHTML(p.winRate - p.winRatePrior, true, ' pts') }),
    tile({ lab: 'Sales cycle', val: p.cycleDays + ' days', delta: deltaHTML(p.cycleDays - p.cycleDaysPrior, false, ' days') }),
    tile({ lab: 'Stalled > 30 days', val: num(p.stalledCount), sec: `${egp(p.stalledValue)} not moving` }),
  ].join('');
  $('#pipechartt').textContent = 'Pipeline by stage';
  const ramp = ['--o1', '--o2', '--o3', '--o4', '--o5'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
  CHARTS.pipeStages = (m) => chartBarsH(m, {
    items: p.stages.map((s, i) => ({
      name: s.name, value: s.value, color: ramp[i],
      label: money(s.value) + ' · ' + s.count, extra: `${s.prob}% probability · weighted ${egp(Math.round(s.value * s.prob / 100))}`,
    })),
    valueFmt: (v) => egp(v), unit: 'Value (EGP)',
  });
  $('#pipeside').innerHTML = `<h3>Expected to close in the next 60 days</h3>
    ${buildTable(['Opportunity', 'Value', 'Prob.', 'Close'],
      p.deals.map((d) => [`${esc(d.name)}<div class="sec" style="color:var(--muted);font-size:11.5px">${esc(d.stage)} · ${esc(d.owner)}</div>`,
        egp(d.value), d.prob + '%', esc(d.close)]))}
    <h3 style="margin-top:16px">Why we lost · rolling 90 days</h3>
    ${p.lostReasons.map((l) => `<div class="kv"><span>${esc(l.name)}</span><span>${l.pct}%</span></div>`).join('')}`;
}

function renderCollections() {
  const e = currentEntity(), c = e.collections, r = e.revenue;
  if (state.entity === 'all') {
    $('#colsub').textContent = ''; $('#coltiles').innerHTML = '';
    $('#colbottom').innerHTML = `<div class="empty">Collections detail is per entity.</div>`;
    CHARTS.aging = null; CHARTS.dso = null;
    $('[data-chart="aging"]').closest('figure').style.display = 'none';
    $('[data-chart="dso"]').closest('figure').style.display = 'none';
    return;
  }
  $('[data-chart="aging"]').closest('figure').style.display = '';
  $('[data-chart="dso"]').closest('figure').style.display = c ? '' : 'none';
  if (state.entity === 'lwm') {
    $('#colsub').textContent = 'Small book — cohort fees are collected up front.';
    $('#coltiles').innerHTML = tile({ lab: 'Total receivables', val: egp(r.receivables, false), sec: 'none past 30 days' });
    const o2 = getComputedStyle(document.documentElement).getPropertyValue('--o2').trim();
    CHARTS.aging = (m) => chartStackH(m, { segments: [{ name: '0–30 days', value: r.receivables, color: o2 }], valueFmt: (v) => egp(v, false), unit: 'Receivables (EGP)' });
    CHARTS.dso = null;
    $('#colbottom').innerHTML = '';
    return;
  }
  $('#colsub').textContent = 'Receivables and payment behaviour from Odoo, cross-checked against live delivery in ClickUp.';
  $('#coltiles').innerHTML = [
    tile({ lab: 'Total receivables', val: egp(c.receivables), sec: `${c.detail.length} accounts carrying an overdue balance` }),
    tile({
      lab: 'Days sales outstanding', val: c.dso + ' days', sec: `target ${c.dsoTarget} days · worst in 12 months`,
      delta: deltaHTML(c.dso - c.dsoPrior, false, ' days'), spark: sparkSVG(c.dsoSeries),
    }),
    tile({ lab: 'Past 60 days', val: egp(c.overdue60plus), sec: `${c.overdue60pct}% of the book` }),
    tile({
      lab: 'Collection rate · MTD', val: c.collectionRate + '%', sec: `target ${c.collectionRateTarget}%`,
      delta: `<span class="delta down">▼ ${c.collectionRateTarget - c.collectionRate} pts below target</span>`,
    }),
  ].join('');
  const ramp = ['--o1', '--o2', '--o3', '--o4'].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
  CHARTS.aging = (m) => chartStackH(m, { segments: c.aging.map((a, i) => ({ name: a.name, value: a.value, color: ramp[i] })), valueFmt: (v) => egp(v), unit: 'Receivables (EGP)' });
  const agFig = $('[data-chart="aging"]').closest('figure');
  agFig.querySelectorAll('.revq').forEach((n) => n.remove());
  const ag = document.createElement('div'); ag.className = 'revq'; ag.style.marginTop = '14px';
  ag.innerHTML = c.aging.map((a, i) => `<div class="kv"><span><i style="display:inline-block;width:10px;height:10px;
      border-radius:3px;background:${ramp[i]};margin-right:7px"></i>${esc(a.name)}</span>
      <span>${egp(a.value, false)}</span></div>`).join('') +
    `<div class="kv" style="border-top:1px solid var(--axis);margin-top:4px"><span><b>Past 60 days</b></span>
      <span>${egp(c.overdue60plus, false)} · ${c.overdue60pct}%</span></div>`;
  agFig.appendChild(ag);
  CHARTS.dso = (m) => chartLine(m, { labels: c.dsoLabels, values: c.dsoSeries, valueFmt: (v) => v + ' days', reference: c.dsoTarget, refLabel: 'target', unit: 'DSO (days)' });
  $('#colbottom').innerHTML = `
    <h3 style="margin-top:18px">Largest overdue balances</h3>
    ${buildTable(['Client', 'Account manager', 'Overdue', 'Days', 'Live projects'],
      c.detail.map((d) => [
        (d.days > 60 && d.activeProjects > 0) ? `<b>${esc(d.name)}</b>` : esc(d.name),
        esc(d.am), egp(d.value, false), String(d.days), String(d.activeProjects)]))}
    <div class="callout"><div><b>Four clients are past 60 days and still receiving active delivery work.</b>
    Cairo Grand Developments alone is EGP 1,840,000 at 74 days with three live projects. Neither Odoo nor ClickUp
    can surface this on its own — it only exists once the two are joined, which is the whole argument for the warehouse.</div></div>`;
  const rows = $$('#colbottom tbody tr');
  if (rows[0]) rows[0].classList.add('rowflag');
}

function renderDelivery() {
  const e = currentEntity(), d = e.delivery, r = e.revenue;
  if (state.entity === 'all') {
    $('#delsub').textContent = '';
    $('#delbody').innerHTML = `<div class="empty">Delivery is tracked per entity.</div>`; CHARTS.onTime = null; return;
  }
  if (state.entity === 'lwm') {
    $('#delsub').textContent = 'Content engine and launch readiness from the ClickUp Learn with Marie folder.';
    const pctPub = Math.round(r.content_published / r.content_planned * 100);
    $('#delbody').innerHTML = `<div class="tiles">
      ${tile({ lab: 'Content published · MTD', val: `${r.content_published} / ${r.content_planned}`, sec: `${pctPub}% of plan` })}
      ${tile({ lab: 'Launch #1 readiness', val: r.launch_pct + '%', sec: `${r.launch_days} days to launch` })}
      </div>
      <div class="meterrow"><span class="mname">Content plan</span><span class="mw"></span>
        <span class="meterbar"><i style="width:${pctPub}%;background:${sevColor('serious')}"></i></span>
        <span class="mval">${pctPub}</span></div>
      <div class="meterrow"><span class="mname">Launch #1</span><span class="mw"></span>
        <span class="meterbar"><i style="width:${r.launch_pct}%;background:${sevColor('warning')}"></i></span>
        <span class="mval">${r.launch_pct}</span></div>
      <div class="callout"><div><b>Launch #1 is 41% complete with 62 days to go</b>, and the content engine is running
      6 pieces behind plan this month. The launch depends on content the agency side is also drawing on.</div></div>`;
    CHARTS.onTime = null; return;
  }
  $('#delsub').textContent = 'Execution truth from ClickUp, joined to the client and contract records in Odoo.';
  const dbt = (e.collections?.detail || []).filter((x) => x.days > 60 && x.activeProjects > 0);
  const ragSeg = [
    { name: 'On track', value: d.rag.green, color: getComputedStyle(document.documentElement).getPropertyValue('--good').trim() },
    { name: 'At risk', value: d.rag.amber, color: getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() },
    { name: 'Red', value: d.rag.red, color: getComputedStyle(document.documentElement).getPropertyValue('--critical').trim() },
  ];
  $('#delbody').innerHTML = `
    <div class="tiles">
      ${tile({
        lab: 'On-time delivery · 30 days', val: d.onTime + '%', sec: `floor ${d.onTimeFloor}%`,
        delta: deltaHTML(+(d.onTime - d.onTimePrior).toFixed(1), true, ' pts'), spark: sparkSVG(d.onTimeSeries),
      })}
      ${tile({ lab: 'Active projects', val: num(d.activeProjects), sec: `${d.rag.red} red · ${d.rag.amber} at risk` })}
      ${tile({
        lab: 'Overdue tasks', val: num(d.overdue_tasks), sec: 'across all clients',
        delta: deltaHTML(d.overdue_tasks - d.overdue_tasks_prior_week, false, ' vs last week'),
      })}
      ${tile({ lab: 'Stuck in review > 5 days', val: num(d.stuck_in_review), sec: 'awaiting internal or client sign-off' })}
      ${tile({ lab: 'Delivered but unbilled', val: egp(d.unbilled_value), sec: `${d.unbilled_projects} projects complete, no invoice` })}
      ${tile({ lab: 'Scope creep', val: num(d.scope_creep_projects), sec: 'projects past 80% of estimated hours' })}
    </div>
    <div class="grid g2">
      <figure class="chart">
        <figcaption><span class="ct">On-time delivery · 12 months</span><button class="lnk" data-tbl>Table</button></figcaption>
        <div class="plot" data-chart="onTime"></div><div class="tbl" hidden></div>
      </figure>
      <div>
        <h3>Project health</h3>
        <figure class="chart"><div class="plot" data-chart="rag"></div></figure>
        <div class="legend">
          <span><i style="background:${ragSeg[0].color}"></i>On track ${d.rag.green}</span>
          <span><i style="background:${ragSeg[1].color}"></i>At risk ${d.rag.amber}</span>
          <span><i style="background:${ragSeg[2].color}"></i>Red ${d.rag.red}</span>
        </div>
        <div style="margin-top:18px">
          <h3>Where delivery meets money</h3>
          <div class="kv"><span>Delivered but unbilled</span><span>${egp(d.unbilled_value, false)}</span></div>
          <div class="kv"><span>Clients past 60 days still in active delivery</span><span>${dbt.length}</span></div>
          <div class="kv"><span>Live projects for those clients</span><span>${dbt.reduce((a, x) => a + x.activeProjects, 0)}</span></div>
          <div class="kv"><span>Overdue balance behind that work</span><span>${egp(dbt.reduce((a, x) => a + x.value, 0), false)}</span></div>
        </div>
        <div class="callout" style="border-left-color:var(--warning)"><div>Three projects were marked complete in
          ClickUp more than 15 days ago and still have no Odoo invoice — <b>${egp(d.unbilled_value, false)}</b> of
          delivered work that has not been billed.</div></div>
      </div>
    </div>
    <h3 style="margin-top:18px">Projects needing intervention</h3>
    ${buildTable(['Project', 'Service line', 'Owner', 'Issue', 'Status'],
      d.projects.map((p) => [esc(p.name), esc(p.line), esc(p.owner), esc(p.issue),
        badge(RAGMAP[p.rag], p.rag === 'red' ? 'Red' : 'At risk')]))}`;
  CHARTS.onTime = (m) => chartLine(m, { labels: d.onTimeLabels, values: d.onTimeSeries, valueFmt: (v) => v + '%', reference: d.onTimeFloor, refLabel: 'floor', unit: 'On-time %' });
  CHARTS.rag = (m) => chartStackH(m, { segments: ragSeg, valueFmt: (v) => num(v) + ' projects', unit: 'Projects', height: 44 });
}

function renderPeople() {
  const e = currentEntity(), p = e.people, r = e.revenue;
  if (state.entity === 'all') {
    $('#peosub').textContent = '';
    $('#peobody').innerHTML = `<div class="empty">People data is per entity.</div>`; CHARTS.util = null; return;
  }
  if (state.entity === 'lwm') {
    $('#peosub').textContent = '';
    $('#peobody').innerHTML = `<div class="tiles">${tile({ lab: 'Headcount', val: num(r.headcount), sec: 'shared with the agency on content' })}</div>
      <div class="callout"><div><b>Three people are carrying a launch 62 days out.</b> The content lead is shared with
      the agency side, where utilisation is already 84.6%.</div></div>`;
    CHARTS.util = null; return;
  }
  $('#peosub').textContent = 'Headcount, capacity and attrition from ClickUp People & Culture, with Odoo employee records.';
  $('#peobody').innerHTML = `
    <div class="tiles">
      ${tile({
        lab: 'Headcount', val: num(p.headcount), sec: 'across both entities',
        delta: deltaHTML(p.headcount - p.headcount_jan, true, ' since January'), spark: sparkSVG(p.headcountSeries),
      })}
      ${tile({
        lab: 'Utilisation', val: p.utilisation + '%', sec: `target ${p.utilisation_target}%`,
        delta: deltaHTML(+(p.utilisation - p.utilisation_target).toFixed(1), true, ' pts'),
      })}
      ${tile({ lab: 'Attrition · 12 months', val: p.attrition_12m + '%', sec: `${p.leavers_12m} leavers · ${p.active_offboardings} offboarding now` })}
      ${tile({ lab: 'Open roles', val: num(p.openRoles.length), sec: `longest open ${p.openRoles[0].days} days` })}
      ${tile({ lab: 'Away next 14 days', val: num(p.timeoff_next14), sec: 'coverage gap flagged for Performance' })}
    </div>
    <div class="grid g2">
      <figure class="chart">
        <figcaption><span class="ct">Utilisation by team</span><button class="lnk" data-tbl>Table</button></figcaption>
        <div class="plot" data-chart="util"></div><div class="tbl" hidden></div>
        <p class="note">Design at 91.2% and Performance at 88.3% are both well past the 75% target — sustained
        over-utilisation is the leading indicator of the attrition already showing up below. Web at 58.2% and
        PR at 64.8% are the slack, but the skills do not transfer.</p>
      </figure>
      <div>
        <h3>Open roles</h3>
        ${buildTable(['Role', 'Stage', 'Days open', 'Impact'], p.openRoles.map((o) => [esc(o.role), esc(o.stage), String(o.days), esc(o.note)]))}
        <h3 style="margin-top:16px">Onboarding · 30-60-90</h3>
        ${p.onboarding.map((o) => `<div class="kv"><span>${esc(o.name)} · ${esc(o.milestone)}</span>
          <span style="color:${o.days < 0 ? 'var(--bad-txt)' : 'var(--ink)'}">${o.days < 0 ? `${Math.abs(o.days)} days overdue` : `in ${o.days} days`}</span></div>`).join('')}
      </div>
    </div>
    <div class="callout"><div><b>${esc(p.overload.name)} is carrying ${p.overload.tasks} overdue tasks across
    ${p.overload.clients} client accounts</b> — including Cairo Grand, the account that is 74 days overdue on payment.
    Concentration of work and concentration of risk are sitting on the same person.</div></div>`;
  CHARTS.util = (m) => chartBarsH(m, { items: p.utilTeams.map((t) => ({ name: t.name, value: t.value })), valueFmt: (v) => v + '%', reference: p.utilTarget, refLabel: 'target 75%', unit: 'Utilisation %' });
}

function renderStrategic() {
  const e = currentEntity();
  if (state.entity === 'all') {
    $('#strsub').textContent = '';
    $('#strbody').innerHTML = `<div class="empty">Strategic initiatives are tracked per entity.</div>`; return;
  }
  if (state.entity === 'lwm') {
    const r = e.revenue;
    $('#strsub').textContent = 'From the ClickUp Learn with Marie folder.';
    $('#strbody').innerHTML = `
      <div class="meterrow"><span class="mname">Launch #1 — Oct 2026</span><span class="mw">—</span>
        <span class="meterbar"><i style="width:${r.launch_pct}%;background:${sevColor('warning')}"></i></span>
        <span class="mval">${r.launch_pct}</span></div>
      <div class="meternote">Owner Marie Haddad · ${r.launch_days} days remaining · sales page and email sequence not started</div>`;
    return;
  }
  const s = e.strategic;
  $('#strsub').textContent = 'The Internal Kitchen initiatives, straight from ClickUp — owner, progress, next milestone and how long since anything moved.';
  $('#strbody').innerHTML = `
    ${s.items.map((i) => `
      <div class="strow">
        <span class="sname">${esc(i.name)}</span>
        <span>${badge(RAGMAP[i.rag], i.rag === 'green' ? 'On track' : i.rag === 'amber' ? 'At risk' : 'Red')}</span>
        <span class="meterbar"><i style="width:${i.pct}%;background:${sevColor(RAGMAP[i.rag])}"></i></span>
        <span class="spct">${i.pct}%</span>
      </div>
      <div class="strnote">${esc(i.owner)} · next: ${esc(i.next)} ·
        <span style="color:${i.idle > 21 ? 'var(--bad-txt)' : 'var(--muted)'}">${i.idle} day${i.idle === 1 ? '' : 's'} since last activity</span></div>`).join('')}
    <h3 style="margin-top:18px">Paused</h3>
    ${s.paused.map((p) => `<div class="kv"><span>${esc(p.name)}</span><span>${p.days} days paused</span></div>`).join('')}
    <div class="callout"><div><b>Sales Team Building has been idle for 24 days</b> and is the only red initiative.
    Its blocker is the Sales Lead requisition sitting in your approval queue — a strategic initiative stalled on a
    decision, not on capacity.</div></div>`;
}

function renderRisks() {
  const e = currentEntity(), risks = e.risks;
  if (!risks) {
    $('#risksub').textContent = '';
    $('#riskitems').innerHTML = `<div class="empty">The risk register runs per entity.</div>`; return;
  }
  const counts = risks.reduce((a, r) => (a[r.severity] = (a[r.severity] || 0) + 1, a), {});
  $('#risksub').innerHTML = `${risks.length} open — ` +
    ['critical', 'serious', 'warning'].filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(' · ');
  const label = { critical: 'Critical', serious: 'Serious', warning: 'Warning' };
  $('#riskitems').innerHTML = risks.map((r) => `
    <div class="item">
      <div class="body">
        <div class="meta">${badge(r.severity, label[r.severity])}<span class="pill">${esc(r.category)}</span>
          <span class="pill">open since ${esc(r.since)}</span><span class="pill">owner ${esc(r.owner)}</span></div>
        <div class="ti">${esc(r.title)}</div>
        <div class="why">${esc(r.detail)}</div>
        <div class="sg"><b>Measured:</b> ${esc(r.value)}</div>
      </div>
      <div class="acts"><button class="mini">Acknowledge</button><button class="mini">Snooze</button></div>
    </div>`).join('');
  $$('#riskitems .mini').forEach((b) => b.addEventListener('click', () => {
    b.textContent = b.textContent === 'Acknowledge' ? 'Acknowledged' : b.textContent === 'Snooze' ? 'Snoozed 7d' : b.textContent;
    b.closest('.item').style.opacity = .5;
  }));
}

function drawCharts() {
  $$('[data-chart]').forEach((mount) => {
    const key = mount.dataset.chart, fn = CHARTS[key], fig = mount.closest('figure');
    if (!fn) { mount.innerHTML = ''; if (fig && fig.dataset.optional === '1') fig.style.display = 'none'; return; }
    const res = fn(mount);
    const tbl = fig && fig.querySelector('.tbl');
    if (tbl && res) tbl.innerHTML = buildTable(res.headers, res.rows);
  });
  $$('.lnk[data-tbl]').forEach((b) => {
    if (b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('click', () => {
      const t = b.closest('figure').querySelector('.tbl');
      t.hidden = !t.hidden; b.textContent = t.hidden ? 'Table' : 'Hide table';
    });
  });
}

export function renderAll() {
  renderShell(); renderBrief(); renderHealth(); renderActions();
  renderRevenue(); renderPipeline(); renderCollections();
  renderDelivery(); renderPeople(); renderStrategic(); renderRisks();
  drawCharts();
}

let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawCharts, 140); });
