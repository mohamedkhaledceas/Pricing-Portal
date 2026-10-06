import { CUR } from '../model.js';
import { D } from '../data.js';
import { MONTH_NAME, sgn } from './common.js';
import { egp, esc, num, r1 } from '../util.js';
import { panel, srcBadge } from '../components.js';

/* Money page: Odoo's statements (P&L, balance sheet, cash), payables,
   executive summary, and booked vs invoiced. */
/* What one company owes (Odoo): open vendor bills, staff expenses in the
   Expenses dashboard's buckets, this year's biggest suppliers. Bills whose
   vendor is the company itself are marked — Odoo records many internal
   costs that way, so they aren't really suppliers. */
export function livePayablesPanel(){
  const p=D.payablesLive,b=p.bills,x=p.expenses,cur=p.currency,bsPay=D.bsLive?D.bsLive.balanceSheet.payables:null;
  const own=n=>String(n||'').trim().toLowerCase()===String(p.companyName||'').trim().toLowerCase();
  const kv=(l,v,note,{t,red}={})=>`<div class="kv${t?' t':''}"><span>${l}${note?`<div class="note">${note}</div>`:''}</span><i class="num nw"${red&&v?' style="color:var(--badtx)"':''}>${sgn(v)}</i></div>`;
  const plural=(n,w)=>`${num(n)} ${w}${n===1?'':'s'}`;
  const openRows=b.open.slice(0,6).map(o=>`<tr><td>${esc(o.partnerName||'—')}${own(o.partnerName)?' <span class="lite">own company</span>':''}<div class="note">${esc(o.name||'')}${o.ref?' · '+esc(o.ref):''}</div></td>
      <td class="n"><span class="num"${o.dueDate&&o.dueDate<p.asOf?' style="color:var(--badtx)"':''}>${esc(o.dueDate||'—')}</span></td>
      <td class="n"><span class="num">${sgn(o.residual)}</span></td></tr>`).join('');
  const supRows=b.topSuppliers.map(t=>`<div class="kv"><span>${esc(t.name||'—')}${own(t.name)?' <span class="lite">own company as vendor</span>':''}<div class="note">${plural(t.bills,'bill')}</div></span><i class="num nw">${sgn(t.value)}</i></div>`).join('');
  return panel('Payables'+srcBadge('payables'),`${esc(cur)} · what ${esc(p.companyName)} owes · Odoo vendor bills and expenses`,
    `<div class="pb"><div class="cols c2"><div>
      ${kv(`Open vendor bills`,b.openTotal,plural(b.open.length,'bill')+' with something left to pay',{t:1})}
      ${kv('Of which overdue',b.overdueTotal,plural(b.overdueCount,'bill')+' past the due date',{red:1})}
      ${bsPay!=null?kv('Payables in the balance sheet',bsPay,bsPay!==b.openTotal?'Differs from the open bills: payments or entries in Odoo not matched to a bill':'Matches the open bills'):''}
      ${kv('Staff expenses to reimburse',x.toReimburse.total,plural(x.toReimburse.count,'approved expense')+' — Odoo Expenses "To reimburse"',{t:1})}
      ${kv('Awaiting approval',x.toValidate.total,plural(x.toValidate.count,'expense')+' — "To validate"')}
      ${kv('Not submitted yet',x.toReport.total,plural(x.toReport.count,'draft expense')+' — "To report"')}
      <p class="note" style="margin-top:10px">Bills marked "own company" have ${esc(p.companyName)} itself as the vendor — Odoo holds internal costs such as salaries and rent that way, so they aren't outside suppliers.</p>
      </div><div>
      ${openRows?`<h3 class="sec">Open bills</h3><div class="tw"><table><thead><tr><th>Vendor</th><th class="n">Due</th><th class="n">Left to pay</th></tr></thead><tbody>${openRows}</tbody></table></div>`:''}
      <h3 class="sec" style="margin-top:14px">Billed this year</h3>
      ${kv('All vendor bills, net of refunds',b.billedThisYear,'untaxed',{t:1})}
      ${supRows||'<p class="note">No vendor bills this year.</p>'}
    </div></div></div>`);
}

export function liveCashPanel(){
  const c=D.bsLive.cash,cur=D.bsLive.currency;
  return panel('Cash bridge'+srcBadge('balance'),`${esc(cur)} · how ${sgn(c.opening)} on 1 January became ${sgn(c.closing)} today`,
    `<div class="pb"><figure><div class="plot" id="w1"></div></figure>
      <h3 class="sec" style="margin-top:14px">Bank and cash accounts today</h3>
      ${c.accounts.map(a=>`<div class="kv"><span>${esc(a.name)}${a.code?` <span class="lite">${esc(a.code)}</span>`:''}</span><i class="num nw${a.balance<0?' d-dn':''}">${sgn(a.balance)}</i></div>`).join('')}
      <div class="kv t"><span>Closing bank balance</span><i class="num nw">${esc(cur)} ${sgn(c.closing)}</i></div>
      <p class="note">Odoo → Dashboards → Finance → Accounting → Cash. Received and spent include transfers between the company's own accounts, as Odoo counts them. Every account is included, Alex Bank (Personal) too.</p></div>`);
}

export function liveExecSummaryPanel(){
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

export function liveBalanceSheetPanel(){
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
export function livePnlPanel(){
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

/* Money: booked (confirmed orders) beside invoiced revenue, month by
   month. Targets aren't set until phase 3, so there is no target column. */
export function bookedVsInvoicedPanel(){
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
