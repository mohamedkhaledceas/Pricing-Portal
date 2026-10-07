import { spark } from './charts.js';
import { D } from './data.js';
import { allFn, canEditFn, E, entShare, FN, LF, liveBudget, LK, planEdited, prior, S, tierOf, ydel } from './model.js';
import { egp, esc, fmt, fmtc, num, pctx, r1, TT } from './util.js';

/* ═════ components ═════ */
export function kpi(id,{hero,label}={}){
  const m=LK(id);if(!m)return'';
  const k=m.k,s=D.series[id];
  return `<button class="kpi r-${m.rag} ${hero?'hero':''}" data-kpi="${id}">
    <span class="k">${esc(k.live?k.name:(label||k.name))}${k.live?'<span class="mon live">LIVE</span>':''}${k.scored?'':'<span class="mon">MON</span>'}${m.edited?'<span class="mon" style="color:var(--accent);border-color:var(--accent)">EDITED</span>':''}</span>
    <span class="val">${k.unavailable?'—':fmtc(k,m.actual)}</span>
    <span class="meta">${k.unavailable?'unavailable right now':k.perCompany?'per company only':k.notMeasured?'not measured':m.target==null?'no target set':`${TT[k.targetType]} ${fmt(k,m.target)} · ${pctx(m.ach)}`}</span>
    ${k.alt?`<span class="meta" title="${esc(k.alt.hint||'')}">${esc(k.alt.label)} ${fmtc(k,k.alt.value)}</span>`:''}
    ${yoyLine(id,k)}
    ${s?spark(s):''}
  </button>`;
}
export function yoyLine(id,k){
  const pv=prior(id);if(pv==null)return'';
  const u=k.unit==='egp'?'egp':k.unit==='pct'?'pct':k.unit==='months'?'mo':k.unit==='days'?'d':k.unit==='ratio'?'x':'n';
  const d=ydel(u,k.actual,pv,k.direction==='higher_better'?'higher':'lower');
  if(!d)return'';
  return `<span class="yoy ${d.cls}">vs ${S.cmp} ${d.txt}${d.pct!=null&&u==='egp'?` (${d.pct>0?'+':''}${d.pct}%)`:''}</span>`;}
/* A figure that is not in the KPI registry — budget lines, derived totals.
   Deliberately a different element so nothing here can be mistaken for a KPI. */
export function stat(label,value,meta,rag,src){
  return `<div class="kpi ${rag?'r-'+rag:''}" style="cursor:default">
    <span class="k">${esc(label)}${src?srcBadge(src):''}</span><span class="val">${value}</span>
    ${meta?`<span class="meta">${meta}</span>`:''}</div>`;}
/* "Live · <source>" mark for a block whose figures are real. Blocks
   without it are the prototype's sample data (see the page banner). */
const SOURCE_LABEL={odoo:'Odoo',clickup:'ClickUp',portal:'Portal',planner:'Margin Planner'};
export const srcBadge=key=>{const s=D.sources&&D.sources[key];
  return SOURCE_LABEL[s]?` <span class="srcb">Live · ${SOURCE_LABEL[s]}</span>`:'';};
export const panel=(title,meta,body,act)=>`<section class="panel"><div class="ph"><h2>${title}</h2>${meta?`<span class="m">${meta}</span>`:''}${act?`<div class="sp"></div>${act}`:''}</div>${body}</section>`;
export function sortTable(key,cols,rows,{flagRow,cls=''}={}){
  const st=S.sort[key];
  let r=[...rows];
  if(st){const i=st.i,dir=st.d;r.sort((a,b)=>{const x=a.v[i],y=b.v[i];
    const c=(typeof x==='number'&&typeof y==='number')?x-y:String(x).localeCompare(String(y));return dir==='asc'?c:-c;});}
  return `<div class="tw"><table class="${cls}"><thead><tr>${cols.map((c,i)=>
    `<th class="${c.n?'n ':''}s" data-sort="${key}|${i}" ${st&&st.i===i?`aria-sort="${st.d==='asc'?'ascending':'descending'}"`:''}>${esc(c.t)}<span class="ar">${st&&st.i===i?(st.d==='asc'?'↑':'↓'):'↕'}</span></th>`).join('')}</tr></thead>
    <tbody>${r.map(row=>`<tr class="${flagRow&&flagRow(row)?'rowflag':''}">${row.c.map((c,i)=>`<td class="${cols[i].n?'n':''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function decisionItem(d,full){
  const e=d.esc||tierOf(d),st=S.decisions[d.id],done=!!st;
  return `<div class="it ${done?'done':''}">
    <div class="hdr"><span class="tier t-${e.tier}">${e.tier.toUpperCase()}</span>
      <span class="lite">${esc(d.category)}</span>${d.value?`<span class="lite num">EGP ${num(d.value)}</span>`:''}
      <span class="lite">due ${esc(d.due)}</span>
      ${e.breached?`<span class="tag g-red">${e.hrs>72?Math.round(e.hrs/24)+' days open':e.hrs+'h of '+d.sla+'h'}</span>`:''}
      ${done?'<span class="tag g-green">Decided</span>':''}</div>
    <div class="ti">${esc(d.title)}</div>
    <div class="bd2">${esc(d.context)}</div>
    ${full?`<div class="bd2"><b>Impact.</b> ${esc(d.impact)}</div>`:''}
    <div class="rt">Routed to ${e.tier==='ceo'?'you':'the head'} — ${e.reasons.map(esc).join('; ')}</div>
    ${done?`<div class="bd2" style="margin-top:7px"><b>Chosen:</b> ${esc((d.options.find(o=>o.id===st.option)||{}).label||'')}
        <button class="btn" data-reopen="${d.id}" style="margin-left:8px">Reopen</button></div>`
      :`<div class="opts">${d.options.map(o=>`<label class="opt${o.id===d.rec?' rec':''}">
          <input type="radio" name="o-${d.id}" value="${o.id}"${o.id===d.rec?' checked':''}>
          <span><b>${esc(o.label)}</b>${o.id===d.rec?' <em>recommended</em>':''}<span class="oc">${esc(o.consequence)}</span></span></label>`).join('')}</div>
        <div class="hdr" style="margin-top:9px"><button class="btn pri" data-decide="${d.id}">Record decision</button>
          <button class="btn" data-ev="${d.drill}">Evidence</button></div>`}
  </div>`;
}
/* ═════ income statement ═════
   Actual, plan and — when a comparison year is on — the same period last year.
   The plan column foots at PLAN revenue, which is why it uses dcPlanYtd rather
   than the revenue-rebased delivery-cost budget on the Budget page; that one
   answers a different question (is the margin RATE holding) and is labelled so.
   Variance is signed by whether it helps profit, not by whether it is bigger. */
export function pnlTable(){
  const e=E(), B=D.budget, L=liveBudget();
  const y=S.cmp&&D.years[S.cmp]?D.years[S.cmp].ytd:null;
  const sr=entShare('rev'), so=entShare('opex');
  const P2={revenue:e.revenue,directCost:e.directCost,grossProfit:e.grossProfit,
            cogs:e.cogs,opex:e.opex,opexTotal:e.opexTotal,
            operatingIncome:e.operatingIncome,tax:e.tax,netProfit:e.netProfit};
  const rows=[];
  const add=(label,actual,plan,prior,{sub,total,grand,costLine}={})=>{
    const sign=costLine?-1:1;
    const vr=plan==null?null:(actual-plan)*sign;
    const yv=prior==null?null:(actual-prior)*sign;
    rows.push({label,actual,plan,prior,vr,yv,sub,total,grand,costLine});};

  /* The pack's own order: Sales · COGS · Gross Margin · expense lines ·
     Operating Expenses · Operating Income · Income Taxes · Net Profit. */
  add('Sales',P2.revenue,Math.round(B.revPlanYtd*sr),y?y.revenue:null,{total:true});
  Object.entries(P2.cogs).forEach(([k,v])=>add(k,v,null,null,{sub:true,costLine:true}));
  add('Cost of revenue',P2.directCost,Math.round(B.dcPlanYtd*sr),y?y.directCost:null,{costLine:true});
  add('Gross margin',P2.grossProfit,Math.round(B.gpPlanYtd*sr),y?y.revenue-y.directCost:null,{total:true});
  Object.entries(P2.opex).forEach(([k,v])=>{const b=L.lines.find(x=>x.name===k);
    add(k,v,b?Math.round(b.ytdBudget*so):null,null,{sub:true,costLine:true});});
  add('Operating expenses',P2.opexTotal,Math.round(L.ytdBudget*so),y?y.opex:null,{costLine:true});
  add('Operating income',P2.operatingIncome,Math.round(B.gpPlanYtd*sr)-Math.round(L.ytdBudget*so),
      y?y.netProfit:null,{total:true});
  add('Income taxes',P2.tax,0,null,{costLine:true});
  add('Net profit',P2.netProfit,Math.round(B.gpPlanYtd*sr)-Math.round(L.ytdBudget*so),
      y?y.netProfit:null,{grand:true});

  const pct=v=>P2.revenue?r1(v/P2.revenue*100)+'%':'—';
  const cell=(v,cls)=>`<td class="n"><span class="num"${cls?` style="color:var(--${cls})"`:''}>${v}</span></td>`;
  const vcell=v=>v==null?'<td class="n"><span class="note">—</span></td>'
    :`<td class="n"><span class="num ${v<0?'d-dn':v>0?'d-up':''}">${v>0?'+':v<0?'−':''}${egp(Math.abs(v),false)}</span></td>`;

  return `<div class="tw"><table class="pnl"><thead><tr>
    <th>Line</th><th class="n">${esc(e.name)}</th><th class="n">% of revenue</th>
    <th class="n">Plan</th><th class="n">Variance</th>
    ${y?`<th class="n">${S.cmp}</th><th class="n">vs ${S.cmp}</th>`:''}
    </tr></thead><tbody>
    ${rows.map(r=>`<tr class="${r.grand?'grand':r.total?'tot':r.sub?'sub':''}">
      <td>${r.sub?'<span style="padding-left:14px;color:var(--muted)">':'<b style="font-weight:600">'}${esc(r.label)}${r.sub?'</span>':'</b>'}</td>
      ${cell((r.costLine?'(':'')+egp(r.actual,false)+(r.costLine?')':''))}
      ${cell(pct(r.actual))}
      ${r.plan==null?'<td class="n"><span class="note">—</span></td>':cell((r.costLine?'(':'')+egp(r.plan,false)+(r.costLine?')':''))}
      ${vcell(r.vr)}
      ${y?(r.prior==null?'<td class="n"><span class="note">—</span></td>':cell((r.costLine?'(':'')+egp(r.prior,false)+(r.costLine?')':'')))+vcell(r.yv):''}
    </tr>`).join('')}
    </tbody></table></div>
  <p class="note" style="padding:10px 16px 0">Figures in brackets are costs. Variance is signed by its effect on profit, so a cost under plan reads positive.
    The plan column foots at plan revenue (EGP ${egp(Math.round(B.revPlanYtd*sr))}); the Budget page restates delivery cost on <i>actual</i> revenue instead, which is the right test for the margin rate and the wrong one for a statement.</p>`;
}
/* ═════ the monthly pack, on screen ═════
   Executive summary and balance sheet in the workbook's own blocks and order,
   so a line in Odoo, a line in the pack and a line here are the same line. */
export function execSummary(){
  const e=E();
  const row=(l,v,{t,neg,pct,days}={})=>`<div class="kv${t?' t':''}"><span>${esc(l)}</span>
    <i class="num${neg&&v<0?' d-dn':''}">${pct?r1(v)+'%':days?r1(v)+' days':(v<0?'−':'')+'EGP '+egp(Math.abs(v))}</i></div>`;
  return `<div class="cols c3">
    <div>
      <h3 class="sec">Cash</h3>
      ${row('Cash received',e.cashIn)}
      ${row('Cash spent',-e.cashOut)}
      ${row('Cash surplus',e.cashSurplus,{t:1,neg:1})}
      ${row('Closing bank balance',e.cash)}
      ${row('Pending collection',e.pending)}
    </div>
    <div>
      <h3 class="sec">Profitability</h3>
      ${row('Revenue',e.revenue)}
      ${row('Cost of revenue',-e.directCost)}
      ${row('Gross profit',e.grossProfit,{t:1})}
      ${row('Expenses',-e.opexTotal)}
      ${row('Net profit',e.netProfit,{t:1,neg:1})}
    </div>
    <div>
      <h3 class="sec">Balance sheet</h3>
      ${row('Receivables',e.receivables)}
      ${row('Payables',-e.payables)}
      ${row('Net assets',e.assets-e.liabilities,{t:1,neg:1})}
      <h3 class="sec" style="margin-top:12px">Position</h3>
      ${row('Average debtor days',e.debtorDays,{days:1})}
      ${row('Average creditor days',e.creditorDays,{days:1})}
    </div>
  </div>
  <div class="cols c3" style="margin-top:14px">
    ${[['Gross profit margin',e.gpMargin,'gross profit ÷ revenue'],
       ['Net profit margin',e.npMargin,'net profit ÷ revenue'],
       ['Return on investment',e.roi,'net profit ÷ assets']].map(([l,v,f])=>
      `<div><div class="mrow"><span class="n" style="width:150px">${l}</span>
        <span class="track"><i style="width:${Math.max(0,Math.min(100,v))}%;background:${v<0?'var(--crit)':v>=15?'var(--good)':'var(--warn)'}"></i></span>
        <span class="v ${v<0?'d-dn':''}">${r1(v)}%</span></div>
        <div class="note" style="margin-top:-4px">${f}</div></div>`).join('')}
  </div>
  <p class="note" style="margin-top:12px">${esc(e.note)}</p>`;
}
export function balanceSheet(){
  const e=E();
  const r=(l,v,{sub,t,grand}={})=>`<tr class="${grand?'grand':t?'tot':sub?'sub':''}">
    <td>${sub?'<span style="padding-left:14px;color:var(--muted)">':'<b style="font-weight:600">'}${esc(l)}${sub?'</span>':'</b>'}</td>
    <td class="n"><span class="num${v<0?' d-dn':''}">${(v<0?'−':'')}${egp(Math.abs(v),false)}</span></td></tr>`;
  return `<div class="tw"><table class="pnl bs"><thead><tr><th>Line</th><th class="n">Sample figures</th></tr></thead><tbody>
    ${r('ASSETS',e.assets,{t:1})}
    ${r('Bank and cash accounts',e.cash,{sub:1})}
    ${r('Receivables',e.receivables,{sub:1})}
    ${r('Other current assets',e.otherCA,{sub:1})}
    ${r('Prepayments',e.prepay,{sub:1})}
    ${r('Fixed assets',e.fixed,{sub:1})}
    ${r('LIABILITIES',e.liabilities,{t:1})}
    ${r('Current liabilities',e.otherCL,{sub:1})}
    ${r('Payables',e.payables,{sub:1})}
    ${r('Non-current liabilities',e.nonCurrentL,{sub:1})}
    ${r('EQUITY',e.equity,{t:1})}
    ${r('Current year unallocated earnings',e.currentEquity,{sub:1})}
    ${r('Previous years unallocated earnings',e.priorEquity,{sub:1})}
    ${r('LIABILITIES + EQUITY',e.liabilities+e.equity,{grand:1})}
  </tbody></table></div>
  <p class="note" style="padding:10px 16px 0">${e.balances
    ?'Liabilities plus equity equals assets. The check is run on every build; it is the only thing that proves the sheet is a balance sheet.'
    :'<b style="color:var(--badtx)">This sheet does not balance.</b> Do not use it.'}
    Current-year unallocated earnings is the net profit above, so the statement and the sheet cannot drift apart.</p>`;
}
export function salesVsTarget(){
  const e=E(), m=e.monthly, done=m.slice(0,9);
  const ach=done.reduce((a,x)=>a+x.revenue,0), tgt=done.reduce((a,x)=>a+x.target,0);
  return `<div class="pb">
    <div class="tw"><table><thead><tr><th>Month</th><th class="n">Target</th><th class="n">Achieved</th><th class="n">%</th><th class="n">Gap</th></tr></thead><tbody>
    ${m.map((x,i)=>{const pc=x.target?r1(x.revenue/x.target*100):null,part=i===9;
      return `<tr><td>${esc(x.month)}${part?' <span class="lite">5 days</span>':''}</td>
      <td class="n"><span class="num">${egp(x.target,false)}</span></td>
      <td class="n"><span class="num">${egp(x.revenue,false)}</span></td>
      <td class="n"><span class="num" style="color:${part?'var(--muted)':pc>=100?'var(--goodtx)':pc>=90?'var(--ink2)':'var(--badtx)'}">${pc}%</span></td>
      <td class="n"><span class="num ${part?'':(x.revenue-x.target<0?'d-dn':'d-up')}">${part?'—':(x.revenue-x.target>0?'+':'−')+egp(Math.abs(x.revenue-x.target),false)}</span></td></tr>`;}).join('')}
    <tr class="tot"><td><b>January to September</b></td>
      <td class="n"><span class="num">${egp(tgt,false)}</span></td>
      <td class="n"><span class="num">${egp(ach,false)}</span></td>
      <td class="n"><span class="num" style="color:${ach>=tgt?'var(--goodtx)':'var(--badtx)'}">${r1(ach/tgt*100)}%</span></td>
      <td class="n"><span class="num ${ach-tgt<0?'d-dn':'d-up'}">${ach-tgt>0?'+':'−'}${egp(Math.abs(ach-tgt),false)}</span></td></tr>
    </tbody></table></div>
    <p class="note" style="margin-top:10px">Sample figures from the prototype.</p></div>`;
}
/* The departmental budget, as the workbook lays it out — master view, then one
   function at a time, month by month, with the plan cells open to the team
   that owns them. */
export function fnMaster(){
  const fs=allFn(), B=D.fnBudget, CM=B.closedMonths;
  const tot={annual:fs.reduce((a,f)=>a+f.annual,0),planYtd:fs.reduce((a,f)=>a+f.planYtd,0),
             actualYtd:fs.reduce((a,f)=>a+f.actualYtd,0),planTracked:fs.reduce((a,f)=>a+f.planTracked,0)};
  tot.variance=tot.planTracked-tot.actualYtd;
  return `<div class="tw"><table><thead><tr>
    <th>Function</th><th>Owner</th><th class="n">Annual plan</th><th class="n">Plan to Sep</th>
    <th class="n">Actual</th><th class="n">Plan, same months</th><th class="n">Variance</th><th class="n">Spent vs plan</th><th class="n">Months tracked</th></tr></thead><tbody>
    ${fs.map(f=>`<tr class="${f.tracked===0?'rowflag':''}">
      <td><button class="btn" data-fn="${f.id}" style="border:0;background:none;padding:0;font-weight:500;color:var(--ink)">${esc(f.name)}</button>
        <div class="note">${esc(f.note)}</div></td>
      <td>${esc(f.owner)}<div class="note">${esc(f.role)}</div></td>
      <td class="n"><span class="num">${egp(f.annual,false)}</span></td>
      <td class="n"><span class="num">${egp(f.planYtd,false)}</span></td>
      <td class="n"><span class="num">${f.tracked?egp(f.actualYtd,false):'<span class="note">not tracked</span>'}</span></td>
      <td class="n"><span class="num">${f.tracked?egp(f.planTracked,false):'<span class="note">—</span>'}</span></td>
      <td class="n"><span class="num ${f.tracked?(f.variance<0?'d-dn':'d-up'):''}">${f.tracked?(f.variance>0?'+':f.variance<0?'−':'')+egp(Math.abs(f.variance),false):'—'}</span></td>
      <td class="n"><span class="num">${f.tracked?pctx(f.pct):'—'}</span></td>
      <td class="n">${f.tracked===CM?`<span class="tag g-green">${f.tracked} of ${CM}</span>`
        :f.tracked?`<span class="tag g-amber">${f.tracked} of ${CM}</span>`:`<span class="tag g-red">0 of ${CM}</span>`}</td></tr>`).join('')}
    <tr class="tot"><td><b>Total agency budget</b></td><td></td>
      <td class="n"><span class="num">${egp(tot.annual,false)}</span></td>
      <td class="n"><span class="num">${egp(tot.planYtd,false)}</span></td>
      <td class="n"><span class="num">${egp(tot.actualYtd,false)}</span></td>
      <td class="n"><span class="num">${egp(tot.planTracked,false)}</span></td>
      <td class="n"><span class="num ${tot.variance<0?'d-dn':'d-up'}">${tot.variance>0?'+':tot.variance<0?'−':''}${egp(Math.abs(tot.variance),false)}</span></td>
      <td class="n"><span class="num">${tot.planTracked?r1(tot.actualYtd/tot.planTracked*100)+'%':'—'}</span></td><td class="n"></td></tr>
  </tbody></table></div>
  <p class="note" style="padding:10px 16px 0">Variance compares actual against the plan <b>for the same months</b> — not against nine months of plan when only three have been recorded, which reads as a saving when it is a gap in the reporting.</p>`;
}
export function fnGrid(){
  const f=LF(S.fn), CM=D.fnBudget.closedMonths, ed=planEdited(S.fn);
  const groups=[...new Set(f.categories.map(c=>c.group||''))];
  const editable=canEditFn(S.fn);
  const cell=(c,i)=>editable?`<td class="n"><input class="tin pin ${c.plan[i]!==FN(S.fn).categories.find(x=>x.name===c.name).plan[i]?'ed':''}"
     data-plan="${S.fn}|${esc(c.name)}|${i}" value="${c.plan[i].toLocaleString('en-US')}"
     aria-label="${esc(c.name)} ${D.months2[i]}"></td>`
    :`<td class="n"><span class="num">${egp(c.plan[i],false)}</span></td>`;
  const rows=c=>`<tr>
      <td><span style="font-weight:500">${esc(c.name)}</span>
        <div class="note">${esc(c.pl)}${c.start?' · from '+esc(c.start):''}${c.edited?' · <b style="color:var(--accent)">edited</b>':''}</div></td>
      ${c.plan.map((_,i)=>cell(c,i)).join('')}
      <td class="n"><span class="num" style="font-weight:600">${egp(c.annual,false)}</span></td></tr>`;
  return `<div class="pb tight"><div class="tw"><table class="grid"><thead><tr>
    <th>Category</th>${D.months2.map((m,i)=>`<th class="n${i<CM?' past':''}">${m}</th>`).join('')}<th class="n">Annual</th></tr></thead>
    <tbody>
    ${groups.map(g=>`${g?`<tr class="sub"><td colspan="14"><b style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">${esc(g)}</b></td></tr>`:''}
      ${f.categories.filter(c=>(c.group||'')===g).map(rows).join('')}`).join('')}
    <tr class="tot"><td><b>Plan</b></td>
      ${f.monthly.map(v=>`<td class="n"><span class="num">${egp(v,false)}</span></td>`).join('')}
      <td class="n"><span class="num">${egp(f.annual,false)}</span></td></tr>
    <tr class="grand"><td><b>Actual</b><div class="note">from Odoo</div></td>
      ${f.actualMonthly.map((v,i)=>`<td class="n"><span class="num${v!=null&&v>f.monthly[i]?' d-dn':''}">${v==null?'<span class="note">—</span>':egp(v,false)}</span></td>`).join('')}
      <td class="n"><span class="num">${f.actualYtd?egp(f.actualYtd,false):'—'}</span></td></tr>
    </tbody></table></div>
    <div class="pb">
      <div class="cols c2">
        <div><div class="kv"><span>Quarter plan</span><i>${f.quarters.map(q=>egp(q,false)).join(' · ')}</i></div>
          <div class="kv"><span>Owner</span><i>${esc(f.owner)} · ${esc(f.role)}</i></div>
          <div class="kv t"><span>Annual</span><i>EGP ${egp(f.annual)}</i></div></div>
        <div><div class="kv"><span>Plan to September</span><i>EGP ${egp(f.planYtd)}</i></div>
          <div class="kv"><span>Actual to September</span><i>${f.tracked?'EGP '+egp(f.actualYtd):'not tracked'}</i></div>
          <div class="kv t"><span>Variance</span><i class="${f.tracked?(f.variance<0?'d-dn':'d-up'):''}">${f.tracked?(f.variance>0?'+':'−')+'EGP '+egp(Math.abs(f.variance)):'—'}</i></div></div>
      </div>
      ${ed?`<div class="alert w" style="margin-top:12px"><div><b>${ed} cell${ed>1?'s':''} changed.</b>
        ${esc(f.name)} annual is now EGP ${egp(f.annual)}. Changes are logged against ${esc(f.owner)} and take effect from the month you edit — a closed month keeps the plan that was in force.</div></div>`:''}
      ${f.tracked<CM?`<div class="alert"><div><b>${CM-f.tracked} of ${CM} closed months have no actual.</b>
        ${S.fn==='hiring'?`The plan assumed hiring from April and EGP ${egp(f.planYtd)} of incremental payroll by September. Nothing has been recorded. Either the roles were not filled, or they were filled and the cost is not tagged to this budget — Odoo knows which, and this page should not have to ask.`
        :`Odoo holds the spend; it is not yet mapped to this function. Until it is, the variance column is blank rather than wrong.`}</div></div>`:''}
    </div></div>`;
}
export function fnByPl(){
  const B=D.fnBudget, L=liveBudget();
  const rows=Object.entries(B.byPl).sort((a,b)=>b[1]-a[1]);
  return `<div class="pb">
    <div class="tw"><table><thead><tr><th>P&amp;L line</th><th class="n">From the function plan</th><th class="n">Share</th></tr></thead><tbody>
    ${rows.map(([k,v])=>`<tr><td>${esc(k)}</td>
      <td class="n"><span class="num">${egp(v,false)}</span></td>
      <td class="n"><span class="num">${r1(v/B.annual*100)}%</span></td></tr>`).join('')}
    <tr class="tot"><td><b>Total</b></td><td class="n"><span class="num">${egp(B.annual,false)}</span></td><td class="n"><span class="num">100%</span></td></tr>
    </tbody></table></div>
    <div class="alert" style="margin-top:12px"><div><b>EGP ${egp(B.inCogs)} of the Operations budget is cost of revenue, not overhead.</b>
      Camera and lights rental are bought to deliver client work. Sitting them in overhead is the same misclassification that makes the monthly pack report a 92% gross margin.
      Mapping every budget line to a P&amp;L line — the column above — is what lets the departmental view and the income statement be the same money.</div></div>
  </div>`;
}
export function bmodeBar(){
  return `<div class="ph" style="border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:10px 14px">
    <div class="seg"><button data-bmode="function" aria-pressed="${S.bmode==='function'}">By function</button>
      <button data-bmode="account" aria-pressed="${S.bmode==='account'}">By P&amp;L line</button></div>
    <span class="m">${S.bmode==='function'
      ?'Who owns the spend, and who enters the plan — the departmental budget'
      :'Where the spend lands in the income statement — the finance budget'}</span></div>`;
}
