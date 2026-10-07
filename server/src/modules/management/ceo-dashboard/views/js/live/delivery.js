import { D } from '../data.js';
import { KPI } from '../model.js';
import { esc, num } from '../util.js';
import { kpi, panel, srcBadge, stat } from '../components.js';

/* Delivery page from the ClickUp copy (management/delivery). */
/* Delivery from ClickUp ("Ceas Comm | Kitchen", copied every 15 minutes),
   all of CEAS — ClickUp isn't split by company. What ClickUp can't answer
   is listed as not measured, never shown as sample. */
export const cuLink=(id,text)=>`<a href="https://app.clickup.com/t/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

export function notMeasuredStat(label,why){return `<div class="kpi" style="cursor:default" title="${esc(why)}"><span class="k">${esc(label)}</span><span class="val">—</span><span class="meta">not measured</span></div>`;}

export function liveDeliveryPage(){
  const s=D.deliveryLive,waiting=s.stages.filter(x=>/client submission|client feedback|client approval/i.test(x.stage)).reduce((a,x)=>a+x.open,0);
  const synced=s.sync&&s.sync.lastSuccessAt?new Date(s.sync.lastSuccessAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'not yet';
  const sub=`all of CEAS · ClickUp "Ceas Comm | Kitchen" · copied ${esc(synced)}`;
  const clientRows=s.byClient.slice(0,12).map(c=>`<tr><td>${esc(c.client)}</td><td class="n"><span class="num">${num(c.open)}</span></td>
      <td class="n"><span class="num"${c.overdue?' style="color:var(--badtx)"':''}>${num(c.overdue)}</span></td>
      <td class="n"><span class="num">${num(c.withClient)}</span></td><td class="n"><span class="num">${c.oldestOverdueDays==null?'—':c.oldestOverdueDays+'d'}</span></td></tr>`).join('');
  const personRows=s.byPerson.slice(0,12).map(p=>`<tr><td>${esc(p.name)}</td><td class="n"><span class="num">${num(p.open)}</span></td>
      <td class="n"><span class="num"${p.overdue?' style="color:var(--badtx)"':''}>${num(p.overdue)}</span></td><td class="n"><span class="num">${num(p.dueThisWeek)}</span></td></tr>`).join('');
  const overdueRows=s.overdueTasks.slice(0,12).map(t=>`<tr><td>${cuLink(t.taskId,t.name||'(untitled)')}<div class="note">${esc(t.listName||'')}</div></td>
      <td>${esc(t.client||'—')}</td><td><span class="lite">${esc(t.status||'')}</span></td>
      <td class="n"><span class="num">${esc(t.dueDate)}</span></td><td class="n"><span class="num" style="color:var(--badtx)">${num(t.daysLate)}d</span></td>
      <td>${esc(t.assignees||'—')}</td></tr>`).join('');
  return `
  <div class="strip">
    ${kpi('overdue_tasks')}
    ${stat('Open work',num(s.open),`${num(s.noDueDate)} without a due date · ${num(s.unassigned.open)} unassigned`,null,'delivery')}
    ${stat('Due this week',num(s.dueThisWeek),'next 7 days, still open',null,'delivery')}
    ${stat('Waiting on the client',num(waiting),'in client submission, feedback or approval',null,'delivery')}
    ${notMeasuredStat('On-time delivery',KPI('on_time_delivery').notMeasured||'')}
  </div>
  <div class="cols c2 eq">
    ${panel('Work by stage'+srcBadge('delivery'),sub,`<div class="pb"><figure><div class="plot" id="stg1"></div></figure>
      <p class="note push">Open tasks per stage, overdue in brackets. Each ClickUp list has its own workflow; stages with the same name are counted together. "Rejected" is a working stage in ClickUp, so it counts as open.</p></div>`)}
    ${panel('Overdue by client'+srcBadge('delivery'),'open tasks past their due date, by ClickUp "Client Name"',
      `<div class="tw"><table><thead><tr><th>Client</th><th class="n">Open</th><th class="n">Overdue</th><th class="n">With client</th><th class="n">Oldest</th></tr></thead><tbody>${clientRows}</tbody></table></div>`)}
  </div>
  <div class="cols c2 eq">
    ${panel('Workload by person'+srcBadge('delivery'),'open tasks assigned in the delivery space',
      `<div class="tw"><table><thead><tr><th>Person</th><th class="n">Open</th><th class="n">Overdue</th><th class="n">Due this week</th></tr></thead><tbody>${personRows}</tbody></table></div>`)}
    ${panel('Longest overdue'+srcBadge('delivery'),'open the task in ClickUp',
      `<div class="tw"><table><thead><tr><th>Task</th><th>Client</th><th>Stage</th><th class="n">Due</th><th class="n">Late</th><th>Assigned</th></tr></thead><tbody>${overdueRows}</tbody></table></div>`)}
  </div>
  ${panel('Not measured yet','what ClickUp can\'t answer today — shown instead of invented figures',`<div class="pb">
    <div class="kv"><span>On-time delivery<div class="note">Tasks are closed in batches long after the work is done, so the close date doesn't show delivery. ClickUp records when each task reached each stage — once "delivered" is defined (sent to client, approved, or ready to publish), this becomes live.</div></span><i>decision pending</i></div>
    <div class="kv"><span>Utilisation and capacity<div class="note">Nobody logs time in ClickUp (0 hours across 3,000 recent tasks).</div></span><i>needs time tracking</i></div>
    <div class="kv"><span>Project margin, project economics, delivered but unbilled<div class="note">ClickUp holds no costs or invoices; these would join the Margin Planner and Odoo.</div></span><i>separate piece of work</i></div>
  </div>`)}`;
}
