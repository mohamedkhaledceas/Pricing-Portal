import { apiFetch } from './apiClient.js';
import { D } from './data.js';
import { render } from './shell.js';
import { $, egp, fmt, num, pctx, r1, toast } from './util.js';

export const KPI=id=>D.kpis.find(k=>k.id===id);
/* Live view model. Targets are editable, so achievement, RAG, score and the
   health composite are all computed at render time, never read off the data. */
export function LK(id){
  const k=KPI(id); if(!k) return null;
  const t=(S.targets[id]!==undefined)?S.targets[id]:k.target, a=k.actual;
  let ach=null;
  /* A live figure can be missing (no billing yet this month); no actual
     means no achievement, not a perfect score. */
  if(t&&a!=null){
    if(k.targetType==='max') ach=a?r1(t/a*100):200;
    else if(k.targetType==='exact'){const tol=k.tolerance||Math.max(t*.05,1);ach=r1(100-(Math.abs(a-t)/tol)*10);}
    else ach=r1(a/t*100);
  }
  const rag=ach==null?'none':ach>=100?'green':ach>=90?'amber':'red';
  const score=ach==null?null:Math.max(0,Math.min(100,Math.round(100-(100-Math.min(ach,110))*D.penalty)));
  return {k,id,target:t,actual:a,ach,rag,score,variance:(a==null||t==null)?null:r1(a-t),edited:S.targets[id]!==undefined,orig:k.target};
}
export function liveHealth(){
  let tot=0,w=0;
  const comps=D.components.map(c=>{
    const sc=c.kpis.map(id=>LK(id).score).filter(x=>x!=null);
    const s=sc.length?Math.round(sc.reduce((a,b)=>a+b,0)/sc.length):0;
    tot+=s*c.weight;w+=c.weight;return{...c,score:s};});
  return{score:w?Math.round(tot/w):0,components:comps};
}
/* ═════ years ═════
   Closed years are settled figures. Nothing here recomputes them, and a target
   edited today never reaches backwards — same rule as the target registry. */
export const YRS=()=>Object.keys(D.years).sort().reverse();
export function yfmt(u,v){if(v==null)return'—';
  return u==='egp'?'EGP '+egp(v):u==='pct'?r1(v)+'%':u==='mo'?r1(v)+' mo':
         u==='d'?Math.round(v)+'d':u==='x'?v.toFixed(2)+'×':num(v);}
export function ydel(u,a,b,dir){
  if(a==null||b==null)return null;
  const d=r1(a-b), better=dir==='higher'?d>0:d<0, sgn=d>0?'+':d<0?'−':'';
  const mag=u==='pct'?r1(Math.abs(d))+'pts':u==='egp'?egp(Math.abs(d)):
            u==='mo'?r1(Math.abs(d))+'mo':u==='d'?Math.round(Math.abs(d))+'d':
            u==='x'?Math.abs(d).toFixed(2)+'×':num(Math.abs(d));
  return {d,txt:sgn+mag,pct:b?r1(d/Math.abs(b)*100):null,cls:d===0?'':better?'d-up':'d-dn'};}
/* Prior-year value for a KPI, when the comparison frame is on and the metric
   actually existed in that year. Anything unmapped simply shows nothing. */
export function prior(id){
  if(!S.cmp)return null;
  const m=D.yearMap[id],y=D.years[S.cmp];
  if(!m||!y)return null;
  const v=y[m[0]][m[1]];return v===undefined?null:v;}
/* ═════ budget: planned vs spent vs left ═════
   Annual budgets and function plans are saved on the server (phase 3,
   budgetService): an edit is sent first and only written into D once the
   server accepts it. "Edited" means changed from the workbook seed. */
const putJson=(path,body)=>apiFetch(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export function LB(name){
  const b=D.budget.lines.find(x=>x.name===name);if(!b)return null;
  const annual=(S.budgets[name]!==undefined)?S.budgets[name]:b.annual;
  const share=D.budget.yearShareExact;   /* the exact elapsed share — the
     displayed 76.3% is rounded for reading and must never be used to compute */
  const ytdBudget=Math.round(annual*share), spent=b.spent;
  const seed=b.seedAnnual!==undefined?b.seedAnnual:b.annual;
  return {...b,annual,ytdBudget,spent,left:annual-spent,variance:ytdBudget-spent,
    usedPct:annual?r1(spent/annual*100):0,pacePct:r1(share*100),
    projected:b.projected,edited:annual!==seed,orig:seed,
    overrun:b.projected-annual};}
export function liveBudget(){
  const lines=D.budget.lines.map(l=>LB(l.name));
  const annual=lines.reduce((a,b)=>a+b.annual,0);
  const ytdBudget=lines.reduce((a,b)=>a+b.ytdBudget,0);
  const spent=lines.reduce((a,b)=>a+b.spent,0);
  const projected=lines.reduce((a,b)=>a+b.projected,0);
  return {lines,annual,ytdBudget,spent,left:annual-spent,variance:ytdBudget-spent,
    projected,overrun:projected-annual,
    usedPct:annual?r1(spent/annual*100):0,
    ratio:r1(annual/D.budget.revPlanYear*100)};}
export async function setBudget(name,v,note){
  const b=D.budget.lines.find(x=>x.name===name);if(!b)return;
  const was=LB(name);
  try{await putJson('/api/ceo-dashboard/budget/lines/'+encodeURIComponent(name),{annual:Math.round(v),note:note||null});}
  catch(err){toast('Not saved — '+(err.message||'the server refused the change'));render();return;}
  b.annual=Math.round(v);delete S.budgets[name];
  const now=LB(name);
  S.log.unshift({a:'budget',name,from:'EGP '+egp(was.annual),to:'EGP '+egp(now.annual),note});
  toast(`${name} budget EGP ${egp(now.annual)} · ${now.usedPct}% spent · EGP ${egp(now.left)} left`);
  render();}
/* ═════ entities ═════
   Egypt, UAE, Combined — the three parts of the monthly pack. Combined is
   always the sum of the two, never a separately maintained set of figures.
   Only the money statements are entity-aware; the operational pages read
   ClickUp, which is not split by entity, and say so.

   Portal: the switcher is the real Odoo companies (D.entityList, from the
   server) and drives the live finance blocks. The money statements below
   (P&L, balance sheet, cash) have no live source yet, so they always show
   the prototype's agency-wide sample, whatever entity is selected. */
export const E=()=>D.entities.con;
/* Currency of the selected entity — live finance figures are in it. */
export const CUR=()=>D.currency||'EGP';
/* An entity's share of the agency plan. The prototype allocated the plan
   to Egypt/UAE by revenue or overhead share; the statements are agency-wide
   sample now (see above), so the share is always the whole. */
export const entShare=()=>1;
/* ═════ function budgets ═════
   The departmental plan: who owns what, month by month. Plan cells are
   editable by the team that owns the function — that is the whole point of
   moving it off a spreadsheet. Actuals come from Odoo and are never typed. */
export const FN=id=>D.functions.find(f=>f.id===id);
export function planAt(fid,cat,i){
  const o=S.plan[fid]&&S.plan[fid][cat];
  if(o&&o[i]!==undefined)return o[i];
  return FN(fid).categories.find(c=>c.name===cat).plan[i];}
export async function setPlan(fid,cat,i,v){
  const c=FN(fid).categories.find(x=>x.name===cat),base=c.plan[i];
  try{await putJson('/api/ceo-dashboard/budget/plan',{functionId:fid,category:cat,month:i,amount:Math.round(v)});}
  catch(err){toast('Not saved — '+(err.message||'the server refused the change'));render();return;}
  c.plan[i]=Math.round(v);if(S.plan[fid]&&S.plan[fid][cat])delete S.plan[fid][cat][i];
  const f=LF(fid);
  S.log.unshift({a:'plan',name:`${FN(fid).name} · ${cat} · ${D.months2[i]}`,
    from:'EGP '+egp(base),to:'EGP '+egp(v),note:''});
  toast(`${cat} ${D.months2[i]} EGP ${egp(v)} · ${FN(fid).name} annual now EGP ${egp(f.annual)}`);
  render();}
// Plan cells changed from the workbook seed.
export function planEdited(fid){
  return FN(fid).categories.reduce((a,c)=>a+(c.seedPlan?c.plan.filter((v,i)=>v!==c.seedPlan[i]).length:0),0);}
/* Live view of a function: every total recomputed, none stored. */
export function LF(fid){
  const f=FN(fid), CM=D.fnBudget.closedMonths;
  const cats=f.categories.map(c=>{
    const plan=c.plan.map((_,i)=>planAt(fid,c.name,i));
    const planYtd=plan.slice(0,CM).reduce((a,b)=>a+b,0);
    const actualYtd=c.actual.slice(0,CM).reduce((a,x)=>a+(x||0),0);
    /* Variance is only meaningful over the months that have an actual. Nine
       months of plan against three months of spend is not a variance, it is a
       gap in the reporting — and reads as a saving, which is worse. */
    const planTracked=plan.slice(0,CM).reduce((a,b,i)=>a+(c.actual[i]!=null?b:0),0);
    return {...c,plan,annual:plan.reduce((a,b)=>a+b,0),
      quarters:[0,3,6,9].map(i=>plan.slice(i,i+3).reduce((a,b)=>a+b,0)),
      planYtd,actualYtd,planTracked,variance:planTracked-actualYtd,
      edited:!!(c.seedPlan&&plan.some((v,i)=>v!==c.seedPlan[i]))};});
  const monthly=D.months2.map((_,i)=>cats.reduce((a,c)=>a+c.plan[i],0));
  const planYtd=monthly.slice(0,CM).reduce((a,b)=>a+b,0);
  const actualYtd=cats.reduce((a,c)=>a+c.actualYtd,0);
  const planTracked=cats.reduce((a,c)=>a+c.planTracked,0);
  return {...f,categories:cats,monthly,annual:monthly.reduce((a,b)=>a+b,0),
    quarters:[0,3,6,9].map(i=>monthly.slice(i,i+3).reduce((a,b)=>a+b,0)),
    planYtd,actualYtd,planTracked,variance:planTracked-actualYtd,
    pct:planTracked?r1(actualYtd/planTracked*100):null};}
export const allFn=()=>D.functions.map(f=>LF(f.id));
/* ═════ state ═════ */
export const PAGES=[
 {id:'focus',name:'Focus',icon:'focus',crumb:'The one thing, then the short list'},
 {id:'today',name:'Today',icon:'today',crumb:'Monday, 5 October 2026 · 08:00 Africa/Cairo'},
 {id:'money',name:'Money',icon:'money',crumb:'Cash, profit and working capital'},
 {id:'budget',name:'Budget',icon:'budget',crumb:'Planned against spent, and what is left'},
 {id:'clients',name:'Clients',icon:'clients',crumb:'Revenue, collections and exposure'},
 {id:'delivery',name:'Delivery',icon:'delivery',crumb:'Projects, deadlines and billing'},
 {id:'people',name:'People',icon:'people',crumb:'Capacity, retention and hiring'},
 {id:'growth',name:'Growth',icon:'growth',crumb:'Pipeline and strategic initiatives'},
 {id:'targets',name:'Targets',icon:'targets',crumb:'The one registry every view reads from'},
 {id:'risks',name:'Risks',icon:'risks',crumb:'Rule-based register'},
];
export const S={page:'focus',scope:'full',role:null,brand:false,scale:0,calm:false,single:false,ent:'ceas',bmode:'function',fn:'people',plan:{},year:'2026',cmp:'',sort:{},filter:{},targets:{},budgets:{},addedKpis:[],decisions:{},acks:{},prefs:{money:150000,ceo:{cash:1,collections:1,revenue:1,pipeline:1,strategic:1,delivery:0,people:0,operations:0}},narrow:false,log:[]};
/* Who sees what. 'full' (ceo, admin) is every page; 'limited' is the pages
   in LIMITED_PAGES for that role, each fed by its own narrower endpoint —
   operations: Budget + the client book (alone on the Clients page);
   people_culture: Budget. Within the Budget tab, CEO/admin edit everything; P&C and
   Operations edit only the plan cells of the functions they own. The
   server enforces the same rules once edits are saved — this only stops
   the page offering a control the server would refuse. */
const LIMITED_PAGES={operations:['budget','clients'],people_culture:['budget']};
export const pages=()=>S.scope==='limited'?PAGES.filter(p=>(LIMITED_PAGES[S.role]||['budget']).includes(p.id)):PAGES;
const FULL_EDIT_ROLES=['ceo','admin'];
const FN_EDITORS={people_culture:['people','hiring'],operations:['ops']};
export const canEditBudgets=()=>FULL_EDIT_ROLES.includes(S.role);
export const canEditFn=fid=>canEditBudgets()||(FN_EDITORS[S.role]||[]).includes(fid);
/* ═════ escalation ═════ */
export function tierOf(d){const p=S.prefs,rs=[];let t='team';
  if(p.ceo[d.category]){t='ceo';rs.push(`You see everything in ${d.category}`);}
  else{t='head';rs.push(`${d.category} is delegated to the head`);}
  if(d.value!=null){if(d.value>=p.money){if(t!=='ceo')rs.push(`EGP ${num(d.value)} is above your EGP ${num(p.money)} threshold`);t='ceo';}
    else if(t==='ceo'&&!p.ceo[d.category])t='head';}
  const hrs=Math.round((new Date('2026-10-05T08:14:00+03:00')-new Date(d.raised+'T09:00:00+03:00'))/36e5);
  const br=d.sla?hrs>d.sla:false;
  if(br&&t==='head'){rs.push(`${hrs}h against a ${d.sla}h SLA — promoted`);t='ceo';}
  return{tier:t,reasons:rs,hrs,breached:br};
}
export const ceoQueue=()=>D.decisions.map(d=>({...d,esc:tierOf(d)})).filter(d=>d.esc.tier==='ceo')
  .sort((a,b)=>(S.decisions[a.id]?1:0)-(S.decisions[b.id]?1:0)||(b.esc.breached-a.esc.breached)||a.due.localeCompare(b.due));
/* A KPI added here is a real registry entry: it carries a direction, a target
   type and a source, because a metric without those cannot be scored or argued
   with. It enters unscored — the health composite is governed annually. */
export function addKpi(){
  const name=$('#nkname').value.trim();
  if(!name){toast('Give the KPI a name');return;}
  const target=parseFloat($('#nktarget').value), actual=parseFloat($('#nkactual').value);
  if(isNaN(target)||isNaN(actual)){toast('A KPI needs both a target and a current actual');return;}
  let id='c_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  if(!id||id==='c_')id='c_kpi';
  while(KPI(id))id+='x';
  const type=$('#nktype').value;
  D.kpis.push({id,name,band:'money',component:$('#nkcomp').value,dept:'exec',
    unit:$('#nkunit').value,direction:$('#nkdir').value,targetType:type,
    tolerance:type==='exact'?Math.max(Math.abs(target)*.05,1):null,
    agg:'end_of_period',actual,target,scored:false,drill:null,
    source:'Entered by hand',query:'Added on the Targets page, 5 Oct 2026 — not yet mapped to Odoo or ClickUp',
    formula:'Defined by you. Map it to a source query before the first live sync, or it will stop updating.'});
  S.addedKpis.push(id);
  S.log.unshift({a:'kpi',name,from:'—',to:fmt(KPI(id),target),note:'added'});
  ['nkname','nktarget','nkactual'].forEach(i=>{const n=$('#'+i);if(n)n.value='';});
  const m=LK(id);
  toast(`${name} added · ${fmt(KPI(id),actual)} against ${fmt(KPI(id),target)} · ${pctx(m.ach)}`);
  render();}
export function setTarget(id,v,note){
  const k=KPI(id),before=liveHealth().score,was=LK(id);
  if(v===k.target)delete S.targets[id];else S.targets[id]=v;
  const now=LK(id),after=liveHealth().score;
  S.log.unshift({a:'target',name:k.name,from:fmt(k,was.target),to:fmt(k,now.target),note});
  toast(`${k.name} target ${fmt(k,now.target)} · ${pctx(now.ach)} achieved`+(after!==before&&k.scored?` · health ${before} → ${after}`:''));
  render();
}
