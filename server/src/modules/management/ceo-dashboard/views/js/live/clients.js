import { COMPANY_LABEL } from './common.js';
import { CUR, S, pages } from '../model.js';
import { D } from '../data.js';
import { egp, esc, num } from '../util.js';
import { panel, srcBadge } from '../components.js';

/* Clients page: revenue by month and the paged largest-invoices panel (Odoo). */
/* Live finance panels (Odoo, one company): the same numbers as Odoo's
   Dashboards → Finance → Invoicing with Period set to this year. */
export function revenueByMonthPanel(){
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

export const PAY_STATE={paid:['Paid','g-green'],in_payment:['In payment','g-green'],partial:['Partly paid','g-amber'],not_paid:['Unpaid','g-red'],reversed:['Reversed','']};

/* Paged 4 at a time so the panel stays the height of "Revenue by month"
   beside it. The page resets when the company changes. */
export const INV_PAGE_SIZE=4;

export function largestInvoicesPanel(){
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
