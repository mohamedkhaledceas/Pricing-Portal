import { clientBookPanel } from './clientBook.js';
import { balanceSheet, bmodeBar, decisionItem, execSummary, fnByPl, fnGrid, fnMaster, kpi, panel, pnlTable, salesVsTarget, sortTable, srcBadge, stat } from './components.js';
import { D } from './data.js';
import { allFn, canEditBudgets, ceoQueue, CUR, E, KPI, LF, liveBudget, liveHealth, LK, S, tierOf, ydel, yfmt, YRS } from './model.js';
import { egp, esc, fmt, fmtD, num, pctx, r1, sevtag, tag, TT, tval } from './util.js';

/* ═════ pages ═════ */
export const P={};
P.today=()=>{
  const q=ceoQueue(),open=q.filter(d=>!S.decisions[d.id]);
  const newRisks=D.risks.filter(r=>r.since>='2026-09-21');
  return `
  <div class="strip">
    ${kpi('cash_runway',{hero:true})}${kpi('net_profit')}${kpi('revenue_total',{label:'Net revenue'})}${kpi('revenue_at_risk')}
  </div>
  <div class="cols c21">
    <div style="display:flex;flex-direction:column;gap:16px">
    ${panel('Morning brief','07:31 · from the 06:30 snapshot',`<div class="pb">
      <p style="font-size:15px;font-weight:600;line-height:1.45;letter-spacing:-.012em;margin:0 0 12px;text-wrap:balance">
        Revenue is within 0.7% of plan and the business took EGP ${num(D.cash.drawings-D.pnl.netProfit)} more out than it earned.
        Cash is down to ${egp(D.cash.balance)} — ${r1(D.cash.runway)} months of fixed cost.</p>
      <div class="kv"><span><b>Changed.</b> Runway crossed below six months on 28 September. Zamalek passed 123 days. Adobe renews in 9 days.</span></div>
      <div class="kv"><span><b>Concerning.</b> ${egp(D.atRisk.total)} of revenue is exposed and pipeline coverage is ${D.pipeline.coverage}× against a 2.0× floor.</span></div>
      <div class="kv"><span><b>Good.</b> Sales Team Building turned green for the first time and gross margin held while revenue stayed on plan.</span></div>
      <div class="hdr" style="margin-top:12px"><button class="btn" data-go="money">Open Money</button><button class="btn" data-kpi="cash_runway">Why runway moved</button></div>
    </div>`)}
    ${panel('New in the last two weeks',`${newRisks.length} risks opened`,
      newRisks.length?`<div class="pb tight">${newRisks.map(r=>`<div class="it"><div class="hdr">${sevtag(r.severity)}<span class="lite">${esc(r.category)}</span><span class="lite">${esc(r.since)}</span></div>
        <div class="ti">${esc(r.title)}</div><div class="bd2">${esc(r.detail)}</div></div>`).join('')}</div>`
      :`<div class="empty"><b>Quiet fortnight</b>No new risks opened since 21 September.</div>`)}
    </div>
    ${panel('Needs you',`${open.length} open`,
      q.length?q.slice(0,2).map(d=>decisionItem(d)).join('')+`<div class="pb"><button class="btn" data-go="risks">See the full queue</button></div>`
      :`<div class="empty"><b>Nothing at CEO tier</b>Everything open sits with a department head.</div>`,'')}
  </div>`;
};
P.money=()=>{
  const wc=D.workingCapital,e=E();
  return `
  <div class="strip">
    ${kpi('cash_runway')}${kpi('cash_balance')}${kpi('gross_margin')}${kpi('net_margin')}${kpi('freelancer_ratio')}
  </div>

  ${costBase()}

  ${D.pnlLive?liveExecSummaryPanel():panel('Executive summary','agency-wide sample · year to date',`<div class="pb">${execSummary()}</div>`)}

  ${D.cash.live?liveCashPanel():perCompanyPanel('Cash bridge')||panel('Cash bridge',`How ${egp(D.cash.opening)} became ${egp(D.cash.balance)}`,
    `<div class="pb"><figure><div class="plot" id="w1"></div></figure>
     <div class="alert" style="margin-top:12px"><div><b>Two bars explain the year.</b> Drawings exceeded profit by ${egp(D.cash.drawings-D.pnl.netProfit)},
       and ${egp(D.cash.arSwing)} more is sitting unpaid with clients than in January. The owner account is shown separately and never nets into business cash.</div></div></div>`)}
  ${D.pnlLive?livePnlPanel():panel('Income statement',`Year to date · 1 January to 5 October${S.cmp?' · against '+S.cmp:''}`,`<div class="pb tight">
      ${pnlTable()}</div><div class="pb" style="padding-top:0">
      <div class="alert" style="margin-top:12px"><div><b>${egp(D.pnl.freelancerCost,false)} — ${D.pnl.freelancerRatio}% of revenue — went to freelancers and contractors</b>
        against a 25% ceiling. Gross margin is ${LK('gross_margin').ach}% of target and net margin ${LK('net_margin').ach}%:
        delivery prices to plan, and the money leaves again through people who are not on payroll and through overhead.</div></div>
      <h3 class="sec" style="margin-top:18px">Month by month</h3>
      <div class="tw"><table><thead><tr><th>Month</th><th class="n">Revenue</th><th class="n">Gross</th>
        <th class="n">Operating</th><th class="n">Margin</th></tr></thead>
        <tbody>${D.pnl.monthly.map(m=>`<tr><td>${esc(m.month)}</td>
          <td class="n"><span class="num">${egp(m.revenue,false)}</span></td>
          <td class="n"><span class="num">${egp(m.gross,false)}</span></td>
          <td class="n"><span class="num">${egp(m.operating,false)}</span></td>
          <td class="n"><span class="num" style="color:${m.margin<10?'var(--badtx)':m.margin<14?'var(--ink2)':'var(--goodtx)'}">${m.margin}%</span></td></tr>`).join('')}</tbody></table></div>
      <p class="note">October is five days. Operating margin has fallen in four of the last five months while revenue held.</p></div>`)}
  <div class="cols c2">
    ${D.bsLive?liveBalanceSheetPanel():perCompanyPanel('Balance sheet')||panel('Balance sheet',`${esc(e.name)} · ${e.balances?'balanced':'DOES NOT BALANCE'}`,`<div class="pb tight">${balanceSheet()}</div>`)}
    ${D.sales&&D.sales.live&&D.revenue.live?bookedVsInvoicedPanel():panel('Sales against target',`${esc(e.name)} · month by month`,salesVsTarget())}
  </div>
  <div class="cols c2">
    ${wc.live?receivablesPanel():panel('Working capital',`Net 30-day position ${egp(wc.net30)}`,`<div class="pb">
      <figure><figcaption><b>Receivables</b> ${egp(wc.receivables,false)} · DSO ${wc.dso} days</figcaption><div class="plot" id="ar1"></div></figure>
      <div class="kv" style="margin-top:14px"><span>Owed to freelancers</span><i class="num">${egp(wc.freelancer,false)}</i></div>
      <div class="kv"><span>Owed to suppliers and vendors</span><i class="num">${egp(wc.supplier,false)}</i></div>
      <div class="kv"><span>Of which past 30 days</span><i class="num">${egp(wc.over30,false)} · ${wc.over30Pct}%</i></div>
      <div class="alert w" style="margin-top:12px"><div>You are financing your clients and being financed by your freelancers.
        ${egp(wc.over30,false)} of what you owe is past 30 days; ${egp(wc.overdue60,false)} of what you are owed is past 60.</div></div></div>`)}
    ${wc.live?panel('Payables','sample — vendor bills aren\'t synced from Odoo yet',`<div class="pb">
      <div class="kv"><span>Owed to freelancers</span><i class="num">${egp(wc.freelancer,false)}</i></div>
      <div class="kv"><span>Owed to suppliers and vendors</span><i class="num">${egp(wc.supplier,false)}</i></div>
      <div class="kv"><span>Of which past 30 days</span><i class="num">${egp(wc.over30,false)} · ${wc.over30Pct}%</i></div></div>`)
    :panel('Subscriptions',`${egp(D.subscriptions.runrate,false)} a month · ${egp(D.subscriptions.runrate*12,false)} a year`,
    `<div class="pb"><div class="alert w"><div><b>${egp(D.subscriptions.renew30,false)} a month auto-renews within 30 days.</b>
      Adobe on 14 October at ${egp(62000,false)} with three of twelve seats unused — cutting those three saves about ${egp(186000,false)} a year.
      The full register lives in Odoo; this is the only line that needs a decision.</div></div></div>`)}
  </div>`;
}

/* Live receivables (Odoo, selected entity). */
function receivablesPanel(){
  const wc=D.workingCapital,cur=CUR();
  return panel('Receivables'+srcBadge('finance'),`${cur} ${egp(wc.receivables,false)} open · ${wc.openInvoices} invoices`,`<div class="pb">
    <figure><figcaption><b>Aging by due date</b></figcaption><div class="plot" id="ar1"></div></figure>
    <div class="kv" style="margin-top:14px"><span>Days sales outstanding</span><i class="num">${wc.dso==null?'—':wc.dso+' days'}</i></div>
    <div class="kv"><span>More than 60 days past due</span><i class="num">${cur} ${egp(wc.overdue60,false)}${wc.overdue60Pct==null?'':' · '+wc.overdue60Pct+'%'}</i></div>
    <div class="kv"><span>Collected this month</span><i class="num">${cur} ${egp(wc.collectedMtd,false)} of ${egp(wc.billedMtd,false)} billed</i></div>
    <p class="note" style="margin-top:10px">${wc.withoutTermsPct??0}% of open invoices have no payment term, so they fall due on the invoice date.
      <button class="btn" data-kpi="dso" style="margin-left:6px">Overdue by client</button></p></div>`);
}

/* Live monthly cost base from the Margin Planner (Ceas Comm only — the
   Planner is single-company). Each figure links to where it is edited. */
function costBase(){
  const c=D.costs;
  if(D.sources.costs!=='planner'||!c)return'';
  const cur=CUR(),avg=c.headcount?Math.round(c.payroll/c.headcount):0;
  const tile=(label,value,meta,href)=>`<button class="kpi" data-href="${href}"><span class="k">${esc(label)}</span>
    <span class="val">${value}</span><span class="meta">${meta}</span></button>`;
  return panel('Monthly cost base'+srcBadge('costs'),'from the Margin Planner · click a figure to edit it there',`<div class="pb"><div class="strip">
    ${tile('Monthly burn',cur+' '+egp(c.burn),`${egp(c.payroll)} payroll · ${egp(c.fixed)} fixed`,'/planner')}
    ${tile('Team payroll',cur+' '+egp(c.payroll),`${c.headcount} people · avg ${egp(avg)}/mo fully loaded`,'/planner?open=team')}
    ${tile('Fixed expenses',cur+' '+egp(c.fixed),esc(c.categories.slice(0,3).map(x=>`${x.name} ${egp(x.amount)}`).join(' · ')||'none entered'),'/planner?open=expenses')}
    ${tile('Overhead per hour',cur+' '+egp(c.ohPerHour,false)+'/hr',`${egp(c.fixed)} fixed ÷ ${num(c.billableHours)} billable hrs`,'/planner?open=expenses')}
  </div></div>`);
}
P.budgetFn=()=>{
  const B=D.fnBudget, fs=allFn(), f=LF(S.fn), CM=B.closedMonths;
  const annual=fs.reduce((a,x)=>a+x.annual,0);
  const planYtd=fs.reduce((a,x)=>a+x.planYtd,0);
  const actYtd=fs.reduce((a,x)=>a+x.actualYtd,0);
  const planTracked=fs.reduce((a,x)=>a+x.planTracked,0);
  const untracked=fs.filter(x=>x.tracked<CM);
  return `
  ${bmodeBar()}
  <div class="strip">
    ${stat('Total agency budget','EGP '+egp(annual),`${D.functions.length} functions · 2026`)}
    ${stat('Plan to September','EGP '+egp(planYtd),`${CM} closed months`)}
    ${stat('Actual recorded','EGP '+egp(actYtd),`${r1(actYtd/planTracked*100)}% of plan for the same months`,actYtd>planTracked?'red':'green')}
    ${stat('Not yet tracked',untracked.length+' of '+D.functions.length,'functions with missing actuals',untracked.length?'red':'green')}
    ${stat('Workbook disagreement','EGP '+egp(B.opsGap),'Operations, understated in the master view','red')}
  </div>

  <div class="alert"><div><b>Three things in the workbook do not add up, and this page fixes all three.</b>
    The master view reads Operations from a typed cell (EGP ${egp(504973)}) instead of the sheet's own total (EGP ${egp(516373)}), so the agency budget is understated by EGP ${egp(B.opsGap)} — it is EGP ${egp(annual)}, not EGP ${egp(B.workbook)}.
    The Operations row in the monthly plan grid is <span class="num">#REF!</span>, which makes the whole <i>Annual Budget Plan</i> row <span class="num">#REF!</span> too.
    And the row labelled <i>Variance %</i> is actual ÷ plan — 1.11 means 111% of plan, not 11% over. Every total here is derived, and the build fails if any of them stops adding up.</div></div>

  ${panel('Master view','every function, its owner, and what has actually been spent',`<div class="pb tight">${fnMaster()}</div>`)}

  ${panel(esc(f.name),`${esc(f.owner)} · plan cells are open to this team`,
    fnGrid(),
    `<div class="seg">${D.functions.map(x=>`<button data-fn="${x.id}" aria-pressed="${S.fn===x.id}">${esc(x.name)}</button>`).join('')}</div>`)}

  ${panel('The same money, by P&L line','what the workbook cannot show',fnByPl())}

  <div class="alert w"><div><b>What HR and Ops do here instead of in the spreadsheet.</b>
    Each function's plan cells are editable by the team that owns it — ${D.functions.map(x=>esc(x.owner)).filter((v,i,a)=>a.indexOf(v)===i).join(', ')}.
    A change is logged with the person and the month, and takes effect from that month forward, so a closed month keeps the plan that was in force when it closed.
    Actuals are never typed: Odoo holds the hires and what they are paid, and posts them against the function. That is the half the spreadsheet was never going to solve.</div></div>`;
};
/* ═════ focus ═════
   The whole dashboard says what is true. This page says what to do about it,
   in the order to do it, with how long each takes — and then stops. Everything
   else is one click away and deliberately not on this screen. */
P.focus=()=>{
  const q=ceoQueue(), open=q.filter(d=>!S.decisions[d.id]);
  const one=open[0], rest=open.slice(1,4);
  const done=q.filter(d=>S.decisions[d.id]).length;
  const heads=D.decisions.filter(d=>tierOf(d).tier!=='ceo').length;
  const mins=open.slice(0,4).reduce((a,d)=>a+(d.minutes||3),0);
  const run=LK('cash_runway'), cash=LK('cash_balance'), h=liveHealth();
  const nm=(id,v,st,rag,unit)=>`<button class="fnum-c" data-kpi="${id}">
    <span class="lb">${esc(KPI(id)?KPI(id).name:'Company health')}${unit?` · ${esc(unit)}`:''}</span>
    <span class="fnum">${v}</span>
    <span class="st" style="color:var(--${rag==='red'?'badtx':rag==='amber'?'ink2':'goodtx'})">${esc(st)}</span></button>`;

  return `<div class="fwrap">
    ${one?`<div class="fone">
      <div class="fkick"><span>Start here</span><span>·</span><span>${one.minutes} minute${one.minutes>1?'s':''}</span>
        ${one.esc.breached?'<span>·</span><span style="color:var(--badtx)">past its SLA</span>':''}</div>
      <h2>${esc(one.title)}</h2>
      <div class="why">${esc(one.impact)}</div>
      <div class="fdo">${esc(one.act)}</div>
      <div class="fact">
        <button class="btn pri" data-go="today">Open the options</button>
        <button class="btn" data-fdone="${one.id}">I have decided</button>
        <button class="btn" data-fskip="${one.id}">Not today</button>
      </div>
    </div>`:`<div class="fone" style="border-left-color:var(--good)">
      <div class="fkick"><span>Nothing is waiting on you</span></div>
      <h2>You have cleared the queue.</h2>
      <div class="why">All ${done} decisions that needed you are recorded. ${heads} more are with the heads and are not yours unless an SLA breaks.</div>
      <div class="fact"><button class="btn" data-freset="1">Put them back</button></div>
    </div>`}

    <div class="fnums">
      ${nm('cash_runway',r1(run.actual),run.actual<6?'below the six-month floor':'above the floor',run.rag,'months')}
      ${nm('cash_balance',egp(cash.actual),'down from '+egp(D.cash.opening)+' in January',cash.rag,'EGP')}
      <button class="fnum-c" data-ev="health"><span class="lb">Company health</span>
        <span class="fnum">${h.score}</span>
        <span class="st" style="color:var(--${h.score<60?'badtx':h.score<75?'ink2':'goodtx'})">${h.score<60?'weak':h.score<75?'holding, slipping':'strong'}</span></button>
    </div>

    ${rest.length?`<div class="flist">
      <div class="fli" style="padding-bottom:9px;border-bottom:0">
        <div class="bd3"><div class="t2" style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600">Then these — about ${mins} minutes in all</div></div>
      </div>
      ${rest.map((d,i)=>`<div class="fli ${i===0?'first':''}">
        <button class="fcheck" data-fdone="${d.id}" aria-label="Mark decided">✓</button>
        <span class="n">${i+2}</span>
        <div class="bd3"><div class="t2">${esc(d.title)}</div>
          <div class="s2">${esc(d.act)}</div></div>
        <span class="mins">${d.minutes}m</span>
      </div>`).join('')}
    </div>`:''}

    ${done?`<div class="flist">${q.filter(d=>S.decisions[d.id]).map(d=>`<div class="fli done">
      <button class="fcheck" data-freopen="${d.id}" aria-label="Reopen">✓</button>
      <span class="n"></span><div class="bd3"><div class="t2">${esc(d.title)}</div></div>
      <span class="mins">done</span></div>`).join('')}</div>`:''}

    <div class="fquiet"><b>That is everything that needs you today.</b>
      ${heads} decisions sit with the heads, ${D.risks.length} risks are being watched, and ${D.kpis.length} measures are being tracked.
      None of it needs you unless it breaks a rule you set.
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn" data-go="today">See everything</button>
        <button class="btn" data-go="money">Money</button>
        <button class="btn" data-go="risks">Risks</button>
        <button class="btn" id="single">${S.single?'Show the list':'One at a time'}</button>
      </div></div>
  </div>`;
};
P.clients=()=>{
  // The limited view (operations) has no revenue data — the book only.
  if(S.scope==='limited')return clientBookPanel();
  const live=D.revenue.live;
  return `
  <div class="strip">
    ${live?kpi('revenue_total')+kpi('dso')+kpi('overdue_60_share')+kpi('collection_rate')+kpi('retainer_share')
      :kpi('revenue_total',{label:'Net revenue'})+kpi('retainer_share')+kpi('dso')+kpi('overdue_60_share')+kpi('revenue_at_risk')}
  </div>
  ${clientBookPanel()}
  ${live?`<div class="cols c2 eq">${revenueByMonthPanel()}${largestInvoicesPanel()}</div>`:''}
  <div class="cols${live?'':' c2'}">
    ${live?'':panel('Monthly revenue','against a flat monthly target',`<div class="pb"><figure><div class="plot" id="rev1"></div></figure></div>`)}
    ${panel('Revenue at risk',`${D.atRisk.share}% of trailing 90 days`,`<div class="pb">
      ${D.atRisk.components.map(c=>`<div class="kv"><span>${esc(c.name)}<div class="note">${esc(c.detail)}</div></span><i class="num">${egp(c.value,false)}</i></div>`).join('')}
      <div class="kv t"><span>Total exposed</span><i class="num">${egp(D.atRisk.total,false)}</i></div></div>`)}
  </div>
  ${panel('Renewals',`${egp(D.renewals.next90,false)} of retainer value renews within 90 days · ${egp(D.renewals.uncovered,false)} with no renewal opportunity open`,
    `<div class="tw"><table><thead><tr><th>Client</th><th class="n">Annualised</th><th class="n">Ends</th><th class="n">Days</th><th class="n">Covered</th><th class="n">Owner</th></tr></thead>
    <tbody>${D.renewals.items.map(r=>{const days=Math.round((new Date(r.date)-new Date(D.asOf))/864e5);
      return `<tr class="${r.cover==='None'&&days<=90?'rowflag':''}"><td>${esc(r.client)}</td>
        <td class="n"><span class="num">${egp(r.value,false)}</span></td>
        <td class="n"><span class="num">${esc(r.date)}</span></td>
        <td class="n"><span class="num">${days}</span></td>
        <td class="n">${r.cover==='None'?'<span class="tag g-red">No opportunity</span>':r.cover==='Not yet due'?'<span class="lite">Not yet due</span>':'<span class="tag g-green">Open</span>'}</td>
        <td class="n">${esc(r.owner)}</td></tr>`;}).join('')}</tbody></table></div>
    <div class="pb"><div class="alert"><div><b>${egp(D.renewals.uncovered,false)} of retainer revenue expires with nothing in the pipeline to replace it.</b>
      Horizon Telecom alone is the second-largest account and ends in 87 days.</div></div></div>`)}
`;
};
/* Live finance panels (Odoo, one company): the same numbers as Odoo's
   Dashboards → Finance → Invoicing with Period set to this year. */
function revenueByMonthPanel(){
  const r=D.revenue;
  return panel('Revenue by month'+srcBadge('finance'),`${CUR()} · untaxed, net of credit notes · ${esc(D.months.at(-1))} is ${r.monthDay} days in`,
    `<div class="pb"><figure><div class="plot" id="rev1"></div></figure>
      ${r.pnl?`<div class="kv push"><span>Invoiced, converted at about today's rate<div class="note">Odoo → Dashboards → Finance → Invoicing · this year to date — the figure used here</div></span>
        <i class="num nw">EGP ${egp(r.ytd,false)}</i></div>
      <div class="kv"><span>Odoo Profit and Loss revenue, ${esc(r.pnl.year)}<div class="note">Accounting → Reporting → Profit and Loss · AED at the year-average rate (${Object.entries(r.pnl.rates).map(([c,v])=>`${esc(c)} ${v.toFixed(4)}`).join(', ')}) · includes income posted outside invoices</div></span>
        <i class="num nw">EGP ${egp(r.pnl.revenue,false)}</i></div>`:''}
      <div class="kv t${r.pnl?'':' push'}"><span>Average invoice<div class="note">${num(r.documentCount)} invoices and credit notes this year</div></span>
        <i class="num nw">${r.averageInvoice==null?'—':CUR()+' '+egp(r.averageInvoice,false)}</i></div></div>`);
}
const COMPANY_LABEL={ceas:'Ceas Comm',fze:'Ceas Comm FZE',lwm:'Learn with Marie'};
const PAY_STATE={paid:['Paid','g-green'],in_payment:['In payment','g-green'],partial:['Partly paid','g-amber'],not_paid:['Unpaid','g-red'],reversed:['Reversed','']};
/* Paged 4 at a time so the panel stays the height of "Revenue by month"
   beside it. The page resets when the company changes. */
const INV_PAGE_SIZE=4;
function largestInvoicesPanel(){
  const meta=D.revenue.consolidated?`this year · all companies · EGP untaxed, converted by Odoo · click a row for the client`
    :`this year · ${CUR()} untaxed · ordered by amount incl. VAT, as Odoo's Top Invoices · click a row for the client`;
  return panel('Largest invoices'+srcBadge('finance'),meta,
    `<div id="lg-inv">${largestInvoicesBody()}</div>`);
}
export function largestInvoicesBody(){
  const all=D.revenue.largestInvoices||[];
  if(!all.length)return '<div class="empty"><b>No invoices this year</b>Nothing posted in Odoo for this company yet.</div>';
  if(S.invPageEnt!==S.ent){S.invPage=0;S.invPageEnt=S.ent;}
  const pages=Math.ceil(all.length/INV_PAGE_SIZE),page=Math.min(S.invPage||0,pages-1);
  const rows=all.slice(page*INV_PAGE_SIZE,(page+1)*INV_PAGE_SIZE);
  return `<div class="tw"><table><thead><tr><th>Invoice</th><th>Client</th><th class="n">Date</th><th class="n">Amount</th><th class="n">Status</th></tr></thead>
      <tbody>${rows.map(i=>{const st=PAY_STATE[i.paymentState]||[i.paymentState||'—',''];
        return `<tr class="cb-row" data-client="${esc(i.customerKey)}" tabindex="0"><td><span class="num">${esc(i.name)}</span></td>
          <td>${esc(i.customer)}${i.company||i.salesperson?`<div class="note">${[i.company?COMPANY_LABEL[i.company]:'',i.salesperson||''].filter(Boolean).map(esc).join(' · ')}</div>`:''}</td>
          <td class="n"><span class="num">${esc(i.invoiceDate)}</span></td>
          <td class="n"><span class="num">${egp(i.untaxed,false)}</span></td>
          <td class="n">${st[1]?`<span class="tag ${st[1]}">${esc(st[0])}</span>`:`<span class="lite">${esc(st[0])}</span>`}</td></tr>`;}).join('')}
      ${'<tr aria-hidden="true"><td colspan="5">&nbsp;<div class="note">&nbsp;</div></td></tr>'.repeat(pages>1?INV_PAGE_SIZE-rows.length:0)}</tbody></table></div>
    ${pages>1?`<div class="pb cb-pager push"><span class="note">${page*INV_PAGE_SIZE+1}–${page*INV_PAGE_SIZE+rows.length} of ${all.length}</span><div class="sp"></div>
      <button class="btn" data-inv-page="${page-1}"${page<=0?' disabled':''}>Previous</button>
      <span class="note">Page ${page+1} of ${pages}</span>
      <button class="btn" data-inv-page="${page+1}"${page>=pages-1?' disabled':''}>Next</button></div>`:''}`;
}
/* Cash and balance sheet (Odoo, one company). Under All they say so
   instead of showing sample figures: Odoo's multi-company balance-sheet
   conversion isn't verified, and the portal never picks a rate. */
function perCompanyPanel(title){
  if(!(D.entity&&D.entity.key==='all'&&D.pnlLive))return '';
  return panel(title,'per company',`<div class="empty"><b>Shown per company</b>Pick Ceas Comm, FZE or LWM. Odoo's way of converting a combined ${esc(title.toLowerCase())} hasn't been verified yet, so the portal doesn't add the companies together.</div>`);
}
const sgn=n=>`${n<0?'−':''}${egp(Math.abs(n),false)}`;
function liveCashPanel(){
  const c=D.bsLive.cash,cur=D.bsLive.currency;
  return panel('Cash bridge'+srcBadge('balance'),`${esc(cur)} · how ${sgn(c.opening)} on 1 January became ${sgn(c.closing)} today`,
    `<div class="pb"><figure><div class="plot" id="w1"></div></figure>
      <h3 class="sec" style="margin-top:14px">Bank and cash accounts today</h3>
      ${c.accounts.map(a=>`<div class="kv"><span>${esc(a.name)}${a.code?` <span class="lite">${esc(a.code)}</span>`:''}</span><i class="num nw${a.balance<0?' d-dn':''}">${sgn(a.balance)}</i></div>`).join('')}
      <div class="kv t"><span>Closing bank balance</span><i class="num nw">${esc(cur)} ${sgn(c.closing)}</i></div>
      <p class="note">Odoo → Dashboards → Finance → Accounting → Cash. Received and spent include transfers between the company's own accounts, as Odoo counts them. Every account is included, Alex Bank (Personal) too.</p></div>`);
}
function liveExecSummaryPanel(){
  const p=D.pnlLive.current,x=D.bsLive,cur=D.pnlLive.currency;
  const row=(l,v,{t,neg}={})=>`<div class="kv${t?' t':''}"><span>${esc(l)}</span><i class="num nw${neg&&v<0?' d-dn':''}">${sgn(v)}</i></div>`;
  const cash=x?`${row('Cash received',x.cash.received)}${row('Cash spent',-x.cash.spent)}${row('Cash surplus',x.cash.surplus,{t:1,neg:1})}${row('Closing bank balance',x.cash.closing)}`
    :'<p class="note">Shown per company.</p>';
  const bs=x?`${row('Receivables',x.balanceSheet.receivables)}${row('Payables',-x.balanceSheet.payables)}${row('Short-term position',x.balanceSheet.receivables-x.balanceSheet.payables,{t:1,neg:1})}${row('Net assets',x.balanceSheet.assets-x.balanceSheet.liabilities,{neg:1})}`
    :'<p class="note">Shown per company.</p>';
  return panel('Executive summary'+srcBadge('pnl'),`${D.pnlLive.consolidated?'all companies':esc(D.entity?D.entity.name:'')} · ${esc(cur)} · ${D.pnlLive.year}, as in Odoo's Accounting dashboard`,
    `<div class="pb"><div class="cols c3">
      <div><h3 class="sec">Cash</h3>${cash}</div>
      <div><h3 class="sec">Profitability</h3>${row('Revenue',p.revenue)}${row('Cost of revenue',-p.costOfRevenue)}${row('Gross profit',p.grossProfit,{t:1})}${row('Expenses',-(p.operatingExpenses+p.otherExpenses))}${row('Net profit',p.netProfit,{t:1,neg:1})}</div>
      <div><h3 class="sec">Position today</h3>${bs}</div></div></div>`);
}
function liveBalanceSheetPanel(){
  const b=D.bsLive.balanceSheet,cur=D.bsLive.currency;
  const r=(l,v,{sub,t,grand}={})=>`<tr class="${grand?'grand':t?'tot':sub?'sub':''}">
    <td>${sub?`<span style="padding-left:14px;color:var(--muted)">${esc(l)}</span>`:`<b style="font-weight:600">${esc(l)}</b>`}</td>
    <td class="n"><span class="num${v<0?' d-dn':''}">${sgn(v)}</span></td></tr>`;
  return panel('Balance sheet'+srcBadge('balance'),`${esc(D.entity?D.entity.name:'')} · ${esc(cur)} · ${b.balances?'balances':'DOES NOT BALANCE'}`,
    `<div class="pb tight"><div class="tw"><table class="pnl bs"><thead><tr><th>Line</th><th class="n">As at today</th></tr></thead><tbody>
      ${r('ASSETS',b.assets,{t:1})}
      ${r('Bank and Cash Accounts',b.bank,{sub:1})}${r('Receivables',b.receivables,{sub:1})}${r('Current Assets',b.otherCurrentAssets,{sub:1})}${r('Prepayments',b.prepayments,{sub:1})}
      ${r('Plus Fixed Assets',b.fixedAssets,{sub:1})}${r('Plus Non-current Assets',b.nonCurrentAssets,{sub:1})}
      ${r('LIABILITIES',b.liabilities,{t:1})}
      ${r('Current Liabilities',b.currentLiabilities,{sub:1})}${r('Payables',b.payables,{sub:1})}${r('Plus Non-current Liabilities',b.nonCurrentLiabilities,{sub:1})}
      ${r('EQUITY',b.equity,{t:1})}
      ${r('Current Year Unallocated Earnings',b.currentYearEarnings,{sub:1})}${r('Previous Years Unallocated Earnings',b.previousYearsEarnings,{sub:1})}
      ${r('Current Year Retained Earnings',b.currentRetained,{sub:1})}${r('Previous Years Retained Earnings',b.previousRetained,{sub:1})}
      ${r('LIABILITIES + EQUITY',b.liabilitiesAndEquity,{grand:1})}
    </tbody></table></div>
    <p class="note" style="padding:10px 16px 0">Odoo → Accounting → Reporting → Balance Sheet, line for line, from every posted entry since the books began. ${b.balances?'Liabilities plus equity equals assets.':'<b>Liabilities plus equity do not equal assets — check the Odoo sync.</b>'}</p></div>`);
}
/* Odoo's Profit and Loss, line for line (Accounting → Reporting → Profit
   and Loss): this year beside the same period last year for one company;
   under All, Odoo's year-average conversion and no prior year. */
function livePnlPanel(){
  const p=D.pnlLive,c=p.current,pr=p.prior,cur=p.currency;
  const v=n=>`${n<0?'−':''}${egp(Math.abs(n),false)}`;
  // Difference in money, not %: a % change across a profit/loss flip means
  // nothing. Coloured by its effect on profit (a cost going up is red).
  const chg=(a,b,cost)=>{if(b==null)return '';const d=a-b;if(!d)return '<span class="lite">—</span>';
    const good=cost?d<0:d>0;return `<span class="num ${good?'d-up':'d-dn'}">${d>0?'+':'−'}${egp(Math.abs(d),false)}</span>`;};
  const rows=[['Revenue','revenue',{t:1}],['Less Costs of Revenue','costOfRevenue',{sub:1,cost:1}],['Gross Profit','grossProfit',{t:1}],
    ['Less Operating Expenses','operatingExpenses',{sub:1,cost:1}],['Operating Income (or Loss)','operatingIncome',{t:1}],
    ['Plus Other Income','otherIncome',{sub:1}],['Less Other Expenses','otherExpenses',{sub:1,cost:1}],['Net Profit','netProfit',{grand:1}],
    ['Less Allocations and Plus Withdrawals','allocations',{sub:1,cost:1}],['Net Profit Left After Allocations and Withdrawals','netProfitAfterAllocations',{t:1}]];
  const priorLabel=pr?`${p.year-1} to ${Number(p.priorTo.slice(8))} ${MONTH_NAME[Number(p.priorTo.slice(5,7))-1]}`:'';
  const table=`<div class="tw"><table class="pnl"><thead><tr><th>${esc(cur)}</th><th class="n">${p.year}</th>${pr?`<th class="n">${priorLabel}</th><th class="n">Difference</th>`:''}</tr></thead><tbody>
    ${rows.map(([label,key,o])=>`<tr class="${o.grand?'grand':o.t?'tot':o.sub?'sub':''}">
      <td>${o.sub?`<span style="padding-left:14px;color:var(--muted)">${esc(label)}</span>`:`<b style="font-weight:600">${esc(label)}</b>`}</td>
      <td class="n"><span class="num${c[key]<0?' d-dn':''}">${v(c[key])}</span></td>
      ${pr?`<td class="n"><span class="num">${v(pr[key])}</span></td><td class="n">${chg(c[key],pr[key],o.cost)}</td>`:''}</tr>`).join('')}
    </tbody></table></div>`;
  const months=`<h3 class="sec" style="margin-top:18px">Month by month</h3>
    <div class="tw"><table><thead><tr><th>Month</th><th class="n">Revenue</th><th class="n">Gross profit</th><th class="n">Operating expenses</th><th class="n">Net profit</th><th class="n">Net margin</th></tr></thead>
    <tbody>${p.months.map(m=>{const mg=m.revenue?r1(m.netProfit/m.revenue*100):null;return `<tr><td>${esc(m.month)}</td>
      <td class="n"><span class="num${m.revenue<0?' d-dn':''}">${v(m.revenue)}</span></td>
      <td class="n"><span class="num">${v(m.grossProfit)}</span></td>
      <td class="n"><span class="num">${v(m.operatingExpenses)}</span></td>
      <td class="n"><span class="num${m.netProfit<0?' d-dn':''}">${v(m.netProfit)}</span></td>
      <td class="n"><span class="num">${mg==null?'—':mg+'%'}</span></td></tr>`;}).join('')}</tbody></table></div>`;
  const note=p.consolidated
    ?`All companies, ${esc(cur)}. AED converted at Odoo's year-average rate (${Object.entries(p.rates).map(([k,r])=>`${esc(k)} ${r.toFixed(4)}`).join(', ')}), the way Odoo's own multi-company report does — so it matches Odoo and moves a little whenever Odoo adds a day's rate. No prior-year column: Odoo has no AED rate before February 2026.`
    :`As posted in Odoo, in ${esc(cur)}. ${p.year} covers everything posted for the year so far; ${p.year-1} is the same span last year.${D.entity&&D.entity.key==='lwm'?' Learn with Marie\'s Odoo books start in July 2025.':''}`;
  return panel('Income statement'+srcBadge('pnl'),`${p.consolidated?'all companies':esc(D.entity?D.entity.name:'')} · Odoo Profit and Loss`,
    `<div class="pb tight">${table}</div><div class="pb" style="padding-top:0">${months}<p class="note">${note}</p></div>`);
}
const MONTH_NAME=['January','February','March','April','May','June','July','August','September','October','November','December'];
/* Sales orders (Odoo Sales Analysis, Dashboards → Sales), this year by
   order date. "Booked" = confirmed orders, untaxed — Odoo's Sales
   dashboard calls it Revenue; revenue here is the invoiced figure. */
const salesMeta=()=>D.sales.consolidated?'all companies · EGP, converted by Odoo':CUR()+' untaxed';
const QUOTE_STATE={draft:['Draft',''],sent:['Sent','g-amber']};
function quotationsPanel(){
  const q=D.sales.quotations,rows=q.top.slice(0,5);
  return panel('Quotations this year'+srcBadge('sales'),`${num(q.count)} open (${num(q.drafts)} draft, ${num(q.sent)} sent) · worth ${D.sales.consolidated?'EGP':CUR()} ${egp(q.value,false)} untaxed${D.sales.consolidated?', converted by Odoo':''}`,
    rows.length?`<div class="tw"><table><thead><tr><th>Quotation</th><th>Client</th><th class="n">Date</th><th class="n">Value</th><th class="n">Status</th></tr></thead>
      <tbody>${rows.map(o=>{const st=QUOTE_STATE[o.state]||[o.state,''];
        return `<tr class="cb-row" data-client="${esc(o.customerKey)}" tabindex="0"><td><span class="num">${esc(o.name)}</span></td>
          <td>${esc(o.customer)}<div class="note">${[o.company&&D.sales.consolidated?COMPANY_LABEL[o.company]:'',o.salesperson||''].filter(Boolean).map(esc).join(' · ')}</div></td>
          <td class="n"><span class="num">${esc(o.orderDate||'—')}</span></td>
          <td class="n"><span class="num">${egp(o.value,false)}</span></td>
          <td class="n">${st[1]?`<span class="tag ${st[1]}">${esc(st[0])}</span>`:`<span class="lite">${esc(st[0])}</span>`}</td></tr>`;}).join('')}</tbody></table></div>
      <p class="note push" style="padding:8px 16px 12px">Largest 5 by value. Odoo → Sales → Orders → Quotations; Odoo's Sales dashboard counts the same.</p>`
    :'<div class="empty"><b>No open quotations this year</b>Nothing in draft or sent in Odoo.</div>');
}
function whatsSellingPanel(){
  const p=D.sales.products;
  return panel("What's selling"+srcBadge('sales'),`confirmed orders this year · ${salesMeta()} · by product`,
    p.length?`<div class="pb"><figure><div class="plot" id="ws1"></div></figure>
      <p class="note push">Odoo → Dashboards → Sales → Product ("Best Sellers by Revenue"), Period: this year.</p></div>`
    :'<div class="empty"><b>No confirmed orders this year</b></div>');
}
/* Money: booked (confirmed orders) beside invoiced revenue, month by
   month. Targets aren't set until phase 3, so there is no target column. */
function bookedVsInvoicedPanel(){
  const b=D.sales.booked.byMonth,inv=D.revenue.actual,ms=D.months;
  const tb=b.reduce((a,v)=>a+v,0),ti=inv.reduce((a,v)=>a+v,0);
  return panel('Booked and invoiced'+srcBadge('sales'),`${D.sales.consolidated?'all companies · EGP, converted by Odoo':CUR()+' untaxed'} · month by month · no targets set yet`,
    `<div class="pb"><div class="tw"><table><thead><tr><th>Month</th><th class="n">Booked</th><th class="n">Invoiced</th><th class="n">Difference</th></tr></thead><tbody>
    ${ms.map((m,i)=>{const d=(b[i]||0)-(inv[i]||0);return `<tr><td>${esc(m)}</td>
      <td class="n"><span class="num">${egp(b[i]||0,false)}</span></td>
      <td class="n"><span class="num" style="${(inv[i]||0)<0?'color:var(--badtx)':''}">${egp(inv[i]||0,false)}</span></td>
      <td class="n"><span class="num ${d<0?'d-dn':'d-up'}">${d>0?'+':d<0?'−':''}${egp(Math.abs(d),false)}</span></td></tr>`;}).join('')}
    <tr class="tot"><td><b>Year to date</b></td><td class="n"><span class="num">${egp(tb,false)}</span></td><td class="n"><span class="num">${egp(ti,false)}</span></td>
      <td class="n"><span class="num ${tb-ti<0?'d-dn':'d-up'}">${tb-ti>0?'+':tb-ti<0?'−':''}${egp(Math.abs(tb-ti),false)}</span></td></tr>
    </tbody></table></div>
    <p class="note">Booked: sales orders confirmed in the month (Odoo Sales dashboard, its "Revenue" card). Invoiced: the revenue figure. A positive difference is work sold ahead of billing.</p></div>`);
}
/* Odoo's "Top Salespeople" (Invoicing dashboard): revenue by the invoice's
   salesperson, this year, net of credit notes. */
function revenueByAmPanel(){
  if(!D.revenue.live)return panel('Revenue by account manager','',
    '<div class="empty"><b>Odoo revenue isn\'t available right now</b>The last Odoo sync failed or hasn\'t run yet.</div>');
  const rows=D.revenue.bySalesperson||[],ytd=D.revenue.ytd;
  return panel('Revenue by account manager'+srcBadge('finance'),`this year · ${D.revenue.consolidated?'all companies · EGP, converted by Odoo':CUR()} untaxed, net of credit notes · by the invoice's salesperson in Odoo`,
    rows.length?`<div class="tw"><table><thead><tr><th>Account manager</th><th class="n">Revenue</th><th class="n">Share</th><th class="n">Invoices</th></tr></thead>
      <tbody>${rows.map(a=>`<tr><td>${a.name?esc(a.name):'<span class="lite">No salesperson set</span>'}</td>
        <td class="n"><span class="num">${egp(a.value,false)}</span></td>
        <td class="n"><span class="num">${ytd>0?r1(a.value/ytd*100)+'%':'—'}</span></td>
        <td class="n"><span class="num">${num(a.invoices)}</span></td></tr>`).join('')}</tbody></table></div>`
    :'<div class="empty"><b>No invoices this year</b>Nothing posted in Odoo for this company yet.</div>');
}
P.delivery=()=>{
  const r=D.records.delivery;
  return `
  <div class="strip">
    ${kpi('on_time_delivery')}${kpi('project_margin')}${kpi('overdue_tasks')}${kpi('unbilled_delivered')}
    <button class="kpi" data-kpi="on_time_delivery"><span class="k">Active projects</span>
      <span class="val">${D.delivery.rag.green+D.delivery.rag.amber+D.delivery.rag.red}</span>
      <span class="meta">${D.delivery.rag.red} red · ${D.delivery.rag.amber} at risk</span></button>
  </div>
  <div class="cols c2">
    ${panel('Project health','',`<div class="pb"><figure><div class="plot" id="rag1"></div></figure>
      <div class="lgd"><span><i style="background:var(--good)"></i>On track ${D.delivery.rag.green}</span>
        <span><i style="background:var(--warn)"></i>At risk ${D.delivery.rag.amber}</span>
        <span><i style="background:var(--crit)"></i>Red ${D.delivery.rag.red}</span></div></div>`)}
    ${panel('Delivered but unbilled',`${egp(D.delivery.unbilled,false)} across ${D.delivery.unbilledProjects} projects`,
      sortTable('unb',[{t:'Project'},{t:'Client'},{t:'Completed'},{t:'Days',n:1},{t:'Value',n:1}],
        D.records.unbilled.rows.map(x=>({v:x,c:[esc(x[0]),esc(x[1]),`<span class="num">${esc(x[2])}</span>`,`<span class="num">${x[3]}</span>`,`<span class="num">${egp(x[4],false)}</span>`]}))))}
  </div>
  ${panel('Project economics',`${egp(D.projects.value,false)} contracted · ${egp(D.projects.backlog,false)} not yet invoiced · ${D.projects.margin}% blended margin`,
    sortTable('proj',[{t:'Project'},{t:'Client'},{t:'Service'},{t:'Value',n:1},{t:'Paid',n:1},{t:'Remaining',n:1},{t:'Cost',n:1},{t:'Profit',n:1},{t:'Margin',n:1},{t:'Status',n:1}],
      D.projects.items.map(p=>({v:[p.name,p.client,p.service,p.value,p.paid,p.remaining,p.cost,p.profit,p.margin,p.status],
        lowm:p.margin<35,
        c:[esc(p.name),esc(p.client),`<span class="lite">${esc(p.service)}</span>`,
           `<span class="num">${egp(p.value,false)}</span>`,`<span class="num">${egp(p.paid,false)}</span>`,
           `<span class="num" style="color:${p.remaining>0?'var(--ink2)':'var(--muted)'}">${egp(p.remaining,false)}</span>`,
           `<span class="num">${egp(p.cost,false)}</span>`,`<span class="num">${egp(p.profit,false)}</span>`,
           `<span class="num" style="color:${p.margin<35?'var(--badtx)':p.margin<42?'var(--ink2)':'var(--goodtx)'}">${p.margin}%</span>`,
           `<span class="tag g-${p.status==='Blocked'||p.status==='Dormant'?'red':p.status==='At risk'?'amber':p.status==='Completed'?'green':'amber'}">${esc(p.status)}</span>`]})),
      {flagRow:r=>r.lowm})+
    `<div class="pb"><div class="alert"><div><b>Activations and Media Production run at 30% margin</b> against a 42% target, and together they are
      ${egp(D.projects.byLine.filter(l=>l.margin<=32).reduce((a,l)=>a+l.value,0),false)} of contracted work.
      Performance is the only line comfortably above target. This is where pricing, not overhead, is the problem.</div></div></div>`)}
  ${panel('Margin by service line','contracted work, weighted by value',`<div class="pb"><figure><div class="plot" id="ml1"></div></figure>
    <p class="note" style="margin-top:10px">${egp(D.internal.cost,false)} of capacity went to internal projects that bill nothing, and
      ${egp(D.internal.dormantBacklog,false)} of backlog sits on a dormant account. Both are inside the utilisation and backlog figures, which flatters them slightly.</p></div>`)}
  ${panel('Projects needing intervention','',
    `<div class="tw"><table><thead><tr><th>Project</th><th>Client</th><th>Owner</th><th>Issue</th><th class="n">Status</th></tr></thead>
    <tbody>${r.rows.map(x=>`<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td>${esc(x[2])}</td><td>${esc(x[3])}</td>
      <td class="n"><span class="tag g-${x[4]==='red'?'red':'amber'}">${x[4]==='red'?'Red':'At risk'}</span></td></tr>`).join('')}</tbody></table></div>`)}`;
};
P.people=()=>`
  <div class="strip">
    ${kpi('utilisation')}${kpi('attrition')}${kpi('time_to_fill')}
    ${D.people.live?stat('Headcount',D.people.headcount,`active · ${D.people.freelancers} freelance · ${D.people.joinersYtd} joined this year`,null,'people')
      +stat('Away',D.people.awayNext,`on approved leave in the next ${D.people.awayDays} days`,null,'people')
    :`<button class="kpi" data-kpi="utilisation"><span class="k">Headcount</span><span class="val">${D.people.headcount}</span>
      <span class="meta">${D.people.openRoles} roles open</span></button>`}
  </div>
  ${D.people.live?panel('Headcount by department'+srcBadge('people'),'active employees, all of CEAS — not split by entity',
    `<div class="pb"><figure><div class="plot" id="hc1"></div></figure></div>`):''}
  <div class="cols c2">
    ${panel('Utilisation by team','trailing 30 days',`<div class="pb"><figure><div class="plot" id="ut1"></div></figure>
      <p class="note" style="margin-top:10px">Design and Performance have sat above the comfort ceiling for three months.
        Attrition at ${D.people.attrition}% is the lagging half of the same fact.</p></div>`)}
    ${panel('Capacity detail','',sortTable('people',[{t:'Team'},{t:'Utilisation',n:1},{t:'Target',n:1},{t:'Variance',n:1},{t:'People',n:1}],
      D.records.people.rows.map(x=>({v:[x[0],parseFloat(x[1]),75,parseFloat(x[3]),x[4]],
        c:[esc(x[0]),`<span class="num">${esc(x[1])}</span>`,`<span class="num">${esc(x[2])}</span>`,
           `<span class="num" style="color:${parseFloat(x[3])>10?'var(--badtx)':'var(--ink2)'}">${esc(x[3])}</span>`,`<span class="num">${x[4]}</span>`]}))))}
  </div>`;
P.growth=()=>`
  <div class="strip">
    ${kpi('pipeline_coverage')}${kpi('backlog')}${kpi('win_rate')}${kpi('avg_deal_size')}${kpi('initiatives_on_track')}
  </div>
  ${D.sales&&D.sales.live&&D.sales.backlog.invoicesWithoutOrder>0?`<div class="alert w" style="margin-bottom:16px"><div><b>Contracted backlog is overstated.</b> ${esc(D.sales.backlogNote)}</div></div>`:''}
  <div class="cols c2">
    ${D.pipeline.live?pipelinePanel():panel('Pipeline by stage',`${D.pipeline.stages.reduce((a,s)=>a+s.count,0)} open · ${egp(D.pipeline.weighted)} weighted`,
      `<div class="pb"><figure><div class="plot" id="pp1"></div></figure></div>`)}
    ${panel('Strategic initiatives',`${D.strategic.items.filter(i=>i.rag==='green').length} of ${D.strategic.items.length} on track`,
      `<div class="pb">${D.strategic.items.map(i=>`
        <div class="mrow"><span class="n" style="width:150px">${esc(i.name)}</span>
          <span class="track"><i style="width:${i.pct}%;background:${i.rag==='green'?'var(--good)':i.rag==='amber'?'var(--warn)':'var(--crit)'}"></i></span>
          <span class="v">${i.pct}%</span></div>
        <div class="note" style="margin:-4px 0 7px">${esc(i.owner)} · ${esc(i.next)} · <span style="color:${i.idle>21?'var(--badtx)':'var(--muted)'}">${i.idle}d idle</span></div>`).join('')}
        <div class="kv t"><span>Paused</span><i>${D.strategic.paused.map(p=>esc(p.name)+' ('+p.days+'d)').join(' · ')}</i></div></div>`)}
  </div>
  ${D.sales&&D.sales.live?`<div class="cols c2 eq">${quotationsPanel()}${whatsSellingPanel()}</div>`:''}
  ${revenueByAmPanel()}`;
/* Live pipeline (ClickUp 2026 Projects list): open deals by funnel stage,
   plus the Commercial Lead page's own quarterly cohort figures (ADR-0010).
   Counts only — too few deals carry a value to show money. */
function pipelinePanel(){
  const p=D.pipeline,rate=v=>v==null?'—':r1(v*100)+'%';
  return panel('Open deals by stage'+srcBadge('pipeline'),`${p.openCount} open · all of CEAS, not split by entity`,`<div class="pb">
    <figure><div class="plot" id="pp1"></div></figure>
    ${p.quarters.map(q=>`<div class="kv"><span><b>${esc(q.id)}${q.isCurrent?' so far':''}</b>${q.isEstimated?' <span class="lite">partly estimated</span>':''}
        <div class="note">${q.cohortSize} new · ${q.qualifiedCount} qualified · ${q.inProgressCount} in progress · ${q.wonCount} won · ${q.lostCount} lost</div></span>
      <i class="num" title="Lead → in progress · in progress → won">${rate(q.conversion1Rate)} · ${rate(q.conversion2Rate)}</i></div>`).join('')}
    <p class="note" style="margin-top:10px">Conversion is lead → in progress, then in progress → won, by the quarter a deal was created — the same cohort figures as the
      <button class="btn" data-href="/commercial-lead" style="padding:0 6px">Commercial Lead page</button>. Pipeline value, coverage and win rate stay sample: too few ClickUp deals carry a value.</p></div>`);
}
P.targets=()=>{
  const hh=liveHealth(), base=D.health, edits=Object.keys(S.targets);
  const rows=D.kpis.map(k=>{const m=LK(k.id);return{
    v:[k.name,m.target,m.actual,m.ach,m.rag,k.scored?1:0],
    c:[`<button class="btn" data-kpi="${k.id}" style="border:0;background:none;padding:0;font-weight:500;color:var(--ink)">${esc(k.name)}</button>
        <div class="note">${k.direction==='higher_better'?'higher is better':'lower is better'} · ${TT[k.targetType]} · ${esc(k.source)}</div>`,
       `<input class="tin" data-tset="${k.id}" value="${tval(m.target)}" placeholder="none set" aria-label="Target for ${esc(k.name)}">
        ${m.edited?`<button class="btn" data-treset="${k.id}" title="Restore ${fmt(k,m.orig)}" style="padding:1px 5px;margin-left:4px">↺</button>`:''}`,
       `<span class="num">${fmt(k,m.actual)}</span>`,
       `<span class="num">${fmtD(k,m.variance)}</span>`,
       `<span class="num">${pctx(m.ach)}</span>`,
       tag(m.rag),
       k.scored?'<span class="lite">Scored</span>':'<span class="mon">MONITORING</span>']};});
  return `
  ${panel('Add a KPI','a metric the registry does not carry yet',`<div class="pb">
    <div class="setrow">
      <input class="inp" id="nkname" placeholder="What it is called" aria-label="KPI name" style="min-width:180px">
      <select class="inp" id="nkunit" aria-label="Unit">
        <option value="egp">EGP</option><option value="pct">Percent</option><option value="days">Days</option>
        <option value="count">Count</option><option value="ratio">Ratio</option><option value="months">Months</option></select>
      <select class="inp" id="nkdir" aria-label="Direction">
        <option value="higher_better">Higher is better</option><option value="lower_better">Lower is better</option></select>
      <select class="inp" id="nktype" aria-label="Target type">
        <option value="min">Minimum</option><option value="max">Maximum</option><option value="exact">Exact value</option></select>
      <input class="inp num" id="nktarget" type="number" step="any" placeholder="Target" aria-label="Target" style="width:120px">
      <input class="inp num" id="nkactual" type="number" step="any" placeholder="Actual" aria-label="Actual" style="width:120px">
      <select class="inp" id="nkcomp" aria-label="Area">${D.components.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <button class="btn pri" id="nkadd">Add KPI</button>
    </div>
    <p class="note" style="margin-top:9px">A new KPI enters as <b>monitoring</b>: measured, drillable, and outside the health score until the annual plan.
      That is the rule you set — the scored set changes once a year, between 1 November and 15 December, and adding one means removing one.
      ${S.addedKpis.length?`<b style="color:var(--ink)">${S.addedKpis.length} added this session.</b>`:''}</p>
    ${S.addedKpis.length?`<div class="setrow" style="margin-top:8px">${S.addedKpis.map(id=>{const k=KPI(id);const m=LK(id);
      return `<span class="lite">${esc(k.name)} · ${fmt(k,m.actual)} of ${fmt(k,m.target)} · ${pctx(m.ach)} <button class="btn" data-kdel="${id}" style="padding:0 5px;border:0;background:none">×</button></span>`;}).join('')}</div>`:''}
  </div>`)}
  ${panel('Set a target','type a number, press Enter — every view updates at once',`<div class="pb">
    <div class="setrow">
      <select class="inp" id="tkpi" aria-label="KPI">${D.kpis.map(k=>`<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select>
      <input class="inp num" id="tval" type="number" step="any" placeholder="Target value" aria-label="Target value" style="width:150px">
      <input class="inp" id="tnote" placeholder="Why it changed (logged with the version)" aria-label="Reason">
      <button class="btn pri" id="tapply">Apply target</button>
      ${edits.length?`<button class="btn" id="treset">Reset all ${edits.length}</button>`:''}
    </div>
    <p class="note" style="margin-top:9px">Targets are versioned, never overwritten. A change takes effect from the period you set it in, so closed periods keep resolving against the version that was in force — history is never restated.</p>
    ${edits.length?`<div class="alert w" style="margin-top:12px"><div><b>${edits.length} target${edits.length>1?'s':''} edited this session.</b>
      Company health moved from ${base} to ${hh.score}. ${S.log.filter(l=>l.a==='target').slice(0,4).map(l=>
        `<div class="note" style="margin-top:4px">${esc(l.name)} · ${esc(l.from)} → <b style="color:var(--ink)">${esc(l.to)}</b>${l.note?' — '+esc(l.note):''}</div>`).join('')}</div></div>`:''}
  </div>`)}
  <div class="alert"><div><b>Twelve KPIs are on the dashboard; the rest live here.</b>
    Your own rule is ten at agency tier — ceilings, not targets, and adding one means removing one. The front pages show the ten agency KPIs plus cash runway and project margin.
    Everything else stays in this registry: measured, drillable, not competing for attention.</div></div>
  <div class="alert w"><div><b>The new money KPIs are deliberately unscored.</b>
    The KPI Operating System locks the scored set to the annual plan, so cash, net margin, project margin, payables, subscriptions and revenue-at-risk are
    measured and wired into the risk engine now, and join the health composite at the 2027 lock.</div></div>
  ${panel('Target vs actual',`${D.kpis.filter(k=>k.scored).length} scored · ${D.kpis.filter(k=>!k.scored).length} monitoring · click a column to sort`,
    sortTable('tgt',[{t:'KPI'},{t:'Target',n:1},{t:'Actual',n:1},{t:'Variance',n:1},{t:'Achievement',n:1},{t:'Status',n:1},{t:'In score',n:1}],rows))}
  ${panel('Health composite',`${hh.score} / 100${hh.score!==base?` · was ${base}`:''}`,`<div class="pb">
    ${hh.components.map(c=>`<div class="mrow"><span class="n" style="width:94px">${esc(c.name)}</span>
      <span class="lite">${c.weight}%</span>
      <span class="track"><i style="width:${c.score}%;background:${c.score>=70?'var(--good)':c.score>=55?'var(--warn)':'var(--crit)'}"></i></span>
      <span class="v">${c.score}</span></div>
      <div class="note" style="margin:-4px 0 7px">${c.kpis.map(id=>{const m=LK(id);return esc(m.k.name)+' '+pctx(m.ach);}).join(' · ')}</div>`).join('')}
    <p class="note">Only scored KPIs move this number. Weights are configuration: change a target to move the score, change a weight to move the emphasis.</p></div>`)}`;
};
/* ═════ budget ═════
   One question in three parts: what did we plan, what have we spent, what is
   left. Overhead is a fixed allowance; delivery cost is variable, so its
   budget is rebased on the revenue actually invoiced. */
P.budget=()=>{
  if(S.bmode==='function')return P.budgetFn();
  const B=D.budget, L=liveBudget(), pace=B.yearShare;
  const npPlan=Math.round(B.revPlanYtd*B.gmPlan/100)-L.ytdBudget;
  const over=L.variance<0;
  const rows=L.lines.map(b=>({
    v:[b.name,b.annual,b.spent,b.left,b.usedPct,b.variance,b.projected],
    c:[`<b style="font-weight:500">${esc(b.name)}</b>${b.edited?'<span class="mon" style="color:var(--accent);border-color:var(--accent);margin-left:5px">EDITED</span>':''}`,
       !canEditBudgets()?`<span class="num">${egp(b.annual,false)}</span>`:`<input class="tin" data-bset="${esc(b.name)}" value="${b.annual.toLocaleString('en-US')}" aria-label="Annual budget for ${esc(b.name)}">
        ${b.edited?`<button class="btn" data-breset="${esc(b.name)}" title="Restore EGP ${egp(b.orig)}" style="padding:1px 5px;margin-left:4px">↺</button>`:''}`,
       `<span class="num">${egp(b.ytdBudget)}</span>`,
       `<span class="num">${egp(b.spent)}</span>`,
       `<span class="num ${b.variance<0?'d-dn':'d-up'}">${b.variance<0?'−':'+'}${egp(Math.abs(b.variance))}</span>`,
       `<span class="num">${egp(b.left)}</span>`,
       `<span class="num">${b.usedPct}%</span>`,
       `<span class="num">${egp(b.projected)}</span>`,
       b.projected>b.annual?'<span class="tag g-red">Over</span>':b.projected>b.annual*0.97?'<span class="tag g-amber">Tight</span>':'<span class="tag g-green">Within</span>']}));

  const pb=B.projects.map(p=>({
    v:[p.name,p.value,p.budget,p.spent,p.left,p.usedPct,p.deliveredPct,p.overrun],
    c:[`<b style="font-weight:500">${esc(p.name)}</b><div class="note">${esc(p.client)} · ${esc(p.service)} · target ${p.lineTarget}%</div>`,
       `<span class="num">${egp(p.value)}</span>`,
       `<span class="num">${egp(p.budget)}</span>`,
       `<span class="num">${egp(p.spent)}</span>`,
       `<span class="num ${p.left<0?'d-dn':''}">${p.left<0?'−':''}${egp(Math.abs(p.left))}</span>`,
       `<span class="num">${p.usedPct}%</span>`,
       `<span class="num">${p.deliveredPct}%</span>`,
       `<span class="num ${p.overrun>0?'d-dn':'d-up'}">${p.overrun>0?'+':'−'}${egp(Math.abs(p.overrun))}</span>`,
       p.done?'<span class="lite">Closed</span>':`<span class="lite">${esc(p.status)}</span>`]}));

  return `
  ${bmodeBar()}
  <div class="strip">
    ${stat('Overhead budget · year','EGP '+egp(L.annual),`${L.usedPct}% spent · ${pace}% of the year gone`,L.usedPct>pace+2?'red':L.usedPct>pace?'amber':'green')}
    ${stat('Left for the year','EGP '+egp(L.left),`EGP ${egp(Math.round(L.left/Math.max(12-D.elapsed,.1)))} a month for the ${r1(12-D.elapsed)} months left`,L.left<0?'red':'green')}
    ${stat('Overhead vs plan today',(L.variance<0?'−':'+')+'EGP '+egp(Math.abs(L.variance)),`budget to date EGP ${egp(L.ytdBudget)}`,L.variance<0?'red':'green')}
    ${stat('Delivery cost vs plan',(B.dcVariance<0?'−':'+')+'EGP '+egp(Math.abs(B.dcVariance)),`plan EGP ${egp(B.dcBudgetYtd)} at ${B.gmPlan}% margin`,B.dcVariance<0?'red':'green')}
    ${kpi('net_profit')}
  </div>

  ${panel('Plan to actual','every pound of the profit gap, accounted for',`<div class="pb">
    <figure><figcaption><b>Profit bridge · 1 January to 5 October</b><span>EGP</span></figcaption>
      <div class="plot"><svg id="b1" height="230" role="img" aria-label="Profit bridge from plan to actual"></svg></div></figure>
    <p class="note" style="margin-top:10px">Plan profit for the period is EGP ${egp(B.npPlanYtd)} — the revenue plan at a ${B.gmPlan}% gross margin, less the ${B.opexPlanPct}% overhead allowance.
      Actual is EGP ${egp(D.pnl.netProfit)}. The gap has three causes and no residual: revenue arrived EGP ${egp(Math.abs(D.revenue.ytdTarget-D.revenue.ytd))} light, delivery cost ran EGP ${egp(Math.abs(B.dcVariance))} over, and overhead ran EGP ${egp(Math.abs(B.opexVariance))} over.
      Two thirds of the shortfall is cost, not sales.</p>
  </div>`)}

  ${panel('Overhead budget',`EGP ${egp(L.spent)} of EGP ${egp(L.annual)} · ${L.usedPct}% spent with ${pace}% of the year gone`,`<div class="pb">
    ${L.lines.map(b=>`<div class="mrow"><span class="n" style="width:150px">${esc(b.name)}</span>
      <span class="track"><i style="width:${Math.min(100,b.usedPct)}%;background:${b.projected>b.annual?'var(--crit)':b.projected>b.annual*0.97?'var(--warn)':'var(--good)'}"></i><u style="left:${pace}%"></u></span>
      <span class="v">${b.usedPct}%</span></div>`).join('')}
    <p class="note" style="margin-top:6px">Bar length is the share of the annual budget already spent; the vertical mark is ${pace}%, where a line would sit if it spent evenly. Colour is the outturn — red means this line is on course to finish the year over budget, not merely ahead of the calendar.</p>
  </div>`)}

  ${sortTable('bud',[{t:'Line'},{t:'Annual budget',n:1},{t:'Budget to date',n:1},{t:'Spent',n:1},{t:'Variance',n:1},{t:'Left for the year',n:1},{t:'% used',n:1},{t:'Projected full year',n:1},{t:'Status',n:1}],rows)}

  ${!canEditBudgets()?'':panel('Set a budget','type an annual figure, press Enter — the page recalculates',`<div class="pb">
    <div class="setrow">
      <select class="inp" id="bline" aria-label="Budget line">${L.lines.map(b=>`<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}</select>
      <input class="inp num" id="bval" type="number" step="10000" placeholder="Annual budget" aria-label="Annual budget" style="width:160px">
      <input class="inp" id="bnote" placeholder="Why it changed (logged with the version)" aria-label="Reason">
      <button class="btn pri" id="bapply">Apply budget</button>
      ${Object.keys(S.budgets).length?`<button class="btn" id="bresetall">Reset all ${Object.keys(S.budgets).length}</button>`:''}
    </div>
    <p class="note" style="margin-top:9px">Budgets are annual and pro-rated to the day, so "budget to date" always matches how much of the year has actually passed. Changing one never restates a closed month.</p>
    ${L.annual!==D.budget.opexBudgetYear?`<div class="alert w" style="margin-top:12px"><div><b>Overhead budget now EGP ${egp(L.annual)}.</b>
      That is ${L.ratio}% of the EGP ${egp(B.revPlanYear)} revenue plan against a ${B.opexPlanPct}% ceiling, and implies a net margin plan of ${r1(B.gmPlan-L.ratio)}%.</div></div>`:''}
  </div>`)}

  ${panel('Project budgets',`EGP ${egp(B.pbSpent)} spent of EGP ${egp(B.pbBudget)} allowed · ${B.pbDelivered}% of the work delivered`,`<div class="pb">
    <div class="cols c3">
      <div><div class="kv"><span>Cost allowed</span><i>EGP ${egp(B.pbBudget)}</i></div>
        <div class="kv"><span>Spent to date</span><i>EGP ${egp(B.pbSpent)}</i></div>
        <div class="kv t"><span>Left</span><i class="${B.pbLeft<0?'d-dn':''}">${B.pbLeft<0?'−':''}EGP ${egp(Math.abs(B.pbLeft))}</i></div></div>
      <div><div class="kv"><span>Already over on closed work</span><i>EGP ${egp(B.pbBanked)}</i></div>
        <div class="kv"><span>Forecast over on live work</span><i>EGP ${egp(B.pbForecast)}</i></div>
        <div class="kv t"><span>Projected final cost</span><i>EGP ${egp(B.pbProjected)}</i></div></div>
      <div><div class="kv"><span>Blended margin today</span><i>${D.projects.margin}%</i></div>
        <div class="kv"><span>If current burn holds</span><i>${r1((D.projects.value-B.pbProjected)/D.projects.value*100)}%</i></div>
        <div class="kv t"><span>What the mix allows</span><i>${B.pbMixMargin}%</i></div></div>
    </div></div>`)}

  <div class="alert"><div><b>The ${B.projTargetMargin}% project-margin target is not reachable at this mix.</b>
    Priced at each service line's own target — Performance ${B.lineTargets['Performance']}%, Events ${B.lineTargets['Activations & Events']}%, Production ${B.lineTargets['Media Production']}% — the live portfolio allows a blended ${B.pbMixMargin}%, EGP ${egp(B.pbMixGap)} more cost than a flat ${B.projTargetMargin}% assumes.
    Delivery is missing its own targets by EGP ${egp(Math.abs(B.pbLeft))}; the other ${r1(B.projTargetMargin-B.pbMixMargin)} points are a sales-mix decision, not a delivery failure.</div></div>

  ${sortTable('pbud',[{t:'Project'},{t:'Contract',n:1},{t:'Cost budget',n:1},{t:'Spent',n:1},{t:'Left',n:1},{t:'% used',n:1},{t:'% delivered',n:1},{t:'Projected over',n:1},{t:'Status',n:0}],pb,{flagRow:r=>r.v[7]>r.v[2]*0.10})}
  <p class="note">Cost budget is the contract value at that service line's target margin. Projected over is cost to date divided by the share delivered, against that budget — the only column that answers "will what is left cover what is not done".</p>`;
};
/* ═════ closed year ═════
   A closed year is a settled scorecard, not a live dashboard. The operational
   pages need today's ClickUp and Odoo state, which no longer exists for 2025,
   so selecting a past year shows what was actually recorded and says so. */
P.yearreview=()=>{
  const y=D.years[S.year], cur=D.years['2026'];
  /* Columns stay in year order so the table reads as a trend. The delta always
     compares the year you selected against the one you are comparing it to —
     by default the year immediately before it. */
  const show=S.cmp?[S.year,S.cmp].sort().reverse():YRS();
  const yrs=YRS(),against=S.cmp||yrs[yrs.indexOf(S.year)+1]||null;
  const rows=D.yearRows.map(r=>{
    const vals=show.map(k=>D.years[k][r.grp][r.key]);
    const cur=D.years[S.year][r.grp][r.key];
    const base=against?D.years[against][r.grp][r.key]:null;
    const d=base!=null?ydel(r.unit,cur,base,r.dir):null;
    return {v:[r.name,...vals.map(v=>v==null?0:v)],
      c:[`<b style="font-weight:500">${esc(r.name)}</b>`,
         ...vals.map((v,i)=>`<span class="num"${show[i]===S.year?'':' style="color:var(--muted)"'}>${yfmt(r.unit,v)}</span>`),
         d?`<span class="num ${d.cls}">${d.txt}</span>`:'<span class="note">—</span>']};});
  const hdr=[{t:'Metric'},...show.map(k=>({t:k+(D.years[k].status==='current'?' · to date':'')+(k===S.year?' ●':''),n:1})),
             {t:against?`${S.year} vs ${against}`:'Change',n:1}];
  const f=y.full;
  return `
  <div class="alert ${y.status==='closed'?'closed':''}"><div>
    <b>${y.label} ${y.status==='closed'?'is a closed year.':'is the live year.'}</b>
    ${y.status==='closed'
      ?`Figures are as they were settled and are never recalculated — a target or budget changed today does not reach backwards. The operational pages read today's Odoo and ClickUp state, so they stay on ${cur.label}.`
      :`Everything here is year to date through ${y.through}. Pick a closed year above to compare like for like.`}
  </div></div>

  <div class="strip">
    ${stat('Net revenue · to '+y.through,'EGP '+egp(y.ytd.revenue),y.full?`full year EGP ${egp(y.full.revenue)}`:'year in progress')}
    ${stat('Gross margin',y.ytd.grossMargin+'%',`direct cost EGP ${egp(y.ytd.directCost)}`)}
    ${stat('Net profit','EGP '+egp(y.ytd.netProfit),`${y.ytd.netMargin}% margin · overhead ${y.ytd.opexRatio}%`)}
    ${stat('Cash at '+y.through,'EGP '+egp(y.at.cash),`${y.at.runway} months of fixed cost`)}
    ${stat('Headcount',num(y.at.headcount),`${y.at.clients} active clients`)}
  </div>

  ${panel('Year on year',against?`${S.year} against ${against}, same period both years — 1 January to ${y.through}`:'same period every year — 1 January to '+y.through,
    sortTable('yr'+S.year+(S.cmp||''),hdr,rows))}

  ${f?panel('Full year '+y.label,'as closed',`<div class="pb"><div class="cols c2">
    <div><div class="kv"><span>Net revenue</span><i>EGP ${egp(f.revenue)}</i></div>
      <div class="kv"><span>Gross margin</span><i>${f.grossMargin}%</i></div>
      <div class="kv"><span>Operating expenses</span><i>EGP ${egp(f.opex)}</i></div>
      <div class="kv"><span>Overhead ratio</span><i>${f.opexRatio}%</i></div></div>
    <div><div class="kv"><span>Net profit</span><i>EGP ${egp(f.netProfit)}</i></div>
      <div class="kv"><span>Net margin</span><i>${f.netMargin}%</i></div>
      <div class="kv"><span>Cash at 31 December</span><i>EGP ${egp(f.cash)}</i></div>
      <div class="kv t"><span>Headcount at year end</span><i>${num(f.headcount)}</i></div></div>
  </div></div>`):''}

  <div class="alert w"><div><b>Read the three years as one sentence.</b>
    Revenue has grown ${r1((cur.ytd.revenue/D.years['2024'].ytd.revenue-1)*100)}% in two years and net margin has fallen from
    ${D.years['2024'].ytd.netMargin}% to ${cur.ytd.netMargin}%. Headcount went from ${D.years['2024'].at.headcount} to ${cur.at.headcount}
    and DSO from ${D.years['2024'].at.dso} days to ${cur.at.dso}. The agency got bigger, slower to be paid, and thinner per pound.</div></div>`;
};
P.risks=()=>{
  const open=D.risks.filter((r,i)=>!S.acks['r'+i]);
  return `
  <div class="strip">
    <button class="kpi r-red" data-kpi="cash_runway"><span class="k">Critical</span><span class="val">${D.risks.filter(r=>r.severity==='critical').length}</span><span class="meta">need a decision</span></button>
    <button class="kpi r-amber" data-kpi="on_time_delivery"><span class="k">Serious</span><span class="val">${D.risks.filter(r=>r.severity==='serious').length}</span><span class="meta">owned by a head</span></button>
    <button class="kpi" data-kpi="subscription_runrate"><span class="k">Warning</span><span class="val">${D.risks.filter(r=>r.severity==='warning').length}</span><span class="meta">watch list</span></button>
    <button class="kpi" data-kpi="revenue_at_risk"><span class="k">Open</span><span class="val">${open.length}</span><span class="meta">of ${D.risks.length} total</span></button>
  </div>
  ${panel('Register','deterministic rules · each names what it breached',
    `<div class="pb tight">${D.risks.map((r,i)=>{const st=S.acks['r'+i];return `
      <div class="it ${st?'done':''}">
        <div class="hdr">${sevtag(r.severity)}<span class="lite">${esc(r.category)}</span>
          <span class="lite">since ${esc(r.since)}</span><span class="lite">${esc(r.owner)}</span>
          ${st?`<span class="tag g-green">${esc(st)}</span>`:''}</div>
        <div class="ti">${esc(r.title)}</div><div class="bd2">${esc(r.detail)}</div>
        <div class="hdr" style="margin-top:7px"><span class="lite num">${esc(r.value)}</span>
          <button class="btn" data-kpi="${r.kpi}">Open ${esc(KPI(r.kpi)?KPI(r.kpi).name:'KPI')}</button>
          ${st?`<button class="btn" data-ack="${i}|clear">Reopen</button>`
             :`<button class="btn" data-ack="${i}|acknowledged">Acknowledge</button><button class="btn" data-ack="${i}|snoozed">Snooze 7d</button>`}</div>
      </div>`;}).join('')}</div>`)}
  ${panel('All decisions',`${D.decisions.length} total · tier computed from your preferences`,
    `<div class="pb tight">${D.decisions.map(d=>decisionItem({...d,esc:tierOf(d)},true)).join('')}</div>`)}
  ${panel('Escalation preferences','change one and the queue re-routes',`<div class="pb">
    <div class="cols c2">
      <div>${Object.keys(S.prefs.ceo).map(k=>`<div class="kv"><span>${k[0].toUpperCase()+k.slice(1)}</span>
        <button class="btn ${S.prefs.ceo[k]?'pri':''}" data-pref="${k}">${S.prefs.ceo[k]?'Comes to me':'Head owns it'}</button></div>`).join('')}</div>
      <div><div class="kv"><span>Sign-off threshold</span><input class="inp num" id="mth" type="number" step="25000" value="${S.prefs.money}" style="width:120px;text-align:right"></div>
        <p class="note" style="margin-top:8px">Anything above this comes to you. Adobe at EGP 62,000 sits below it, so it goes to Mohamed Khalid.</p>
        <div class="kv t"><span>Coming to you now</span><i>${D.decisions.filter(d=>tierOf(d).tier==='ceo').length}</i></div>
        <div class="kv"><span>With heads</span><i>${D.decisions.filter(d=>tierOf(d).tier==='head').length}</i></div></div>
    </div></div>`)}`;
};
