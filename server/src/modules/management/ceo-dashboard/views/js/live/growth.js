import { COMPANY_LABEL } from './common.js';
import { CUR } from '../model.js';
import { D } from '../data.js';
import { egp, esc, num, r1 } from '../util.js';
import { panel, srcBadge } from '../components.js';

/* Growth page: Odoo quotations, what's selling, revenue by account manager. */
/* Sales orders (Odoo Sales Analysis, Dashboards → Sales), this year by
   order date. "Booked" = confirmed orders, untaxed — Odoo's Sales
   dashboard calls it Revenue; revenue here is the invoiced figure. */
export const salesMeta=()=>D.sales.consolidated?'all companies · EGP, converted by Odoo':CUR()+' untaxed';

export const QUOTE_STATE={draft:['Draft',''],sent:['Sent','g-amber']};

export function quotationsPanel(){
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

export function whatsSellingPanel(){
  const p=D.sales.products;
  return panel("What's selling"+srcBadge('sales'),`confirmed orders this year · ${salesMeta()} · by product`,
    p.length?`<div class="pb"><figure><div class="plot" id="ws1"></div></figure>
      <p class="note push">Odoo → Dashboards → Sales → Product ("Best Sellers by Revenue"), Period: this year.</p></div>`
    :'<div class="empty"><b>No confirmed orders this year</b></div>');
}

/* Odoo's "Top Salespeople" (Invoicing dashboard): revenue by the invoice's
   salesperson, this year, net of credit notes. */
export function revenueByAmPanel(){
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
