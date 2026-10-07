import { D } from '../data.js';
import { egp, esc } from '../util.js';
import { panel } from '../components.js';

/* Shared helpers for the live (Odoo / ClickUp) panels: labels, money
   formatting, and the "unavailable" / "per company" / failing-check notices. */
/* A failing Odoo self-check (finance dataCheckService, after each full
   copy) — shown wherever Odoo figures lead, so they aren't trusted silently. */
export const LABEL_CHECK={balance_sheet:'Balance sheet doesn\'t balance',revenue_copies:'Revenue copies disagree',report_definitions:'Odoo report definitions changed'};

export function checksAlert(){
  const c=D.dataChecks||[];if(!c.length)return '';
  return `<div class="alert"><div><b>Odoo figures need checking.</b> ${c.map(x=>`${esc(LABEL_CHECK[x.key.split(':')[0]]||x.key)}${x.key.includes(':')?' ('+esc(x.key.split(':')[1])+')':''}${x.detail?': '+esc(x.detail):''}`).join(' · ')}</div></div>`;
}

export const COMPANY_LABEL={ceas:'Ceas Comm',fze:'Ceas Comm FZE',lwm:'Learn with Marie'};

/* Cash and balance sheet (Odoo, one company). Under All they say so
   instead of showing sample figures: Odoo's multi-company balance-sheet
   conversion isn't verified, and the portal never picks a rate. */
/* A live source that failed to load: say so instead of falling back to the
   prototype's invented figures. */
export function unavail(source,title){
  if(!(D.unavailable&&D.unavailable[source]))return '';
  return panel(title,'unavailable',`<div class="empty"><b>Unavailable right now</b>The portal couldn't read this from its copy of Odoo or ClickUp. Reload in a minute; if it stays, the server log names the cause.</div>`);
}

export function perCompanyPanel(title){
  if(!(D.entity&&D.entity.key==='all'&&D.pnlLive))return '';
  return panel(title,'per company',`<div class="empty"><b>Shown per company</b>Pick Ceas Comm, FZE or LWM. How Odoo converts these figures across companies hasn't been verified yet, so the portal doesn't add the companies together.</div>`);
}

export const sgn=n=>`${n<0?'−':''}${egp(Math.abs(n),false)}`;

export const MONTH_NAME=['January','February','March','April','May','June','July','August','September','October','November','December'];
