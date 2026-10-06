import { apiFetch } from './apiClient.js';
import { D } from './data.js';
import { loadEntity } from './loader.js';
import { addKpi, ceoQueue, KPI, LB, pages, removeKpi, S, setBudget, setPlan, setTarget } from './model.js';
import { largestInvoicesBody } from './pages.js';
import { applyBrand, closeDrill, draw, goto, openDrill, render } from './shell.js';
import { isDarkTheme, setTheme, syncThemeChip } from './theme.js';
import { $, esc, fmt, toast } from './util.js';

/* ═════ palette ═════ */
export let cmdAll=[],cmdF=[],cmdS=0;
export function buildCmd(){cmdAll=[
  ...pages().map(p=>({t:p.name,k:'Page',go:()=>goto(p.id)})),
  ...D.kpis.map(k=>({t:k.name,k:fmt(k,k.actual),go:()=>openDrill(k.id)})),
  ...D.decisions.map(d=>({t:d.title,k:'Decision',go:()=>goto('risks')})),
  ...(S.scope==='limited'?[]:D.revenue.clients.map(c=>({t:c.name,k:'Client',go:()=>goto('clients')}))),
];}
export const cmdOpen=()=>{$('#cmd').dataset.open='true';$('#cmdin').value='';cmdS=0;cmdRender('');setTimeout(()=>$('#cmdin').focus(),20);};
export const cmdClose=()=>$('#cmd').dataset.open='false';
export function cmdRender(q){
  cmdF=cmdAll.filter(i=>i.t.toLowerCase().includes(q.toLowerCase())).slice(0,8);
  cmdS=Math.min(cmdS,Math.max(0,cmdF.length-1));
  $('#cmdl').innerHTML=cmdF.length?cmdF.map((i,n)=>`<div class="ci" aria-selected="${n===cmdS}" data-c="${n}"><span>${esc(i.t)}</span><span class="kk">${esc(i.k)}</span></div>`).join('')
    :'<div class="empty">No match</div>';
}
/* Each entity is its own payload (Odoo figures are per company). On a
   failed fetch the previous entity stays loaded and selected — the
   switcher never claims to show something it doesn't. */
async function switchEntity(key){
  if(key===S.ent)return;
  try{await loadEntity(key);}
  catch(err){toast(err.message||'Could not load that entity');return;}
  buildCmd();render();
  const e=D.entity;toast(`${e.name} · ${e.note}`);
}
const SOURCE_NAMES={finance:'Revenue, receivables and clients',pipeline:'Pipeline',people:'Headcount and leave',costs:'Monthly cost base'};
function sourcesSummary(){
  const s=D.sources,live=Object.keys(SOURCE_NAMES).filter(k=>s[k]&&s[k]!=='sample'&&s[k]!=='error');
  const failed=Object.keys(SOURCE_NAMES).filter(k=>s[k]==='error');
  return (live.length?'Live: '+live.map(k=>SOURCE_NAMES[k]).join(', ')+'. ':'')
    +(failed.length?'Could not read: '+failed.map(k=>SOURCE_NAMES[k]).join(', ')+' — showing sample. ':'')
    +'Everything else is sample data.';
}
/* ═════ events ═════ */
document.addEventListener('click',e=>{
  const g=e.target.closest('[data-go]');if(g){goto(g.dataset.go);return;}
  const ip=e.target.closest('[data-inv-page]');if(ip){if(!ip.disabled){S.invPage=Number(ip.dataset.invPage);const b=$('#lg-inv');if(b)b.innerHTML=largestInvoicesBody();}return;}
  const k=e.target.closest('[data-kpi]');if(k){openDrill(k.dataset.kpi);return;}
  const ev=e.target.closest('[data-ev]');if(ev){const kk=D.kpis.find(x=>x.drill===ev.dataset.ev);if(kk)openDrill(kk.id);return;}
  const s=e.target.closest('[data-sort]');if(s){const[key,i]=s.dataset.sort.split('|');
    const cur=S.sort[key];S.sort[key]=(cur&&cur.i==i)?{i:+i,d:cur.d==='asc'?'desc':'asc'}:{i:+i,d:'desc'};render();return;}
  const d=e.target.closest('[data-decide]');if(d){const id=d.dataset.decide;
    const o=document.querySelector(`input[name="o-${id}"]:checked`);
    S.decisions[id]={option:o?o.value:null};S.log.unshift({a:'Decision recorded',id});toast('Decision recorded and logged');render();return;}
  const ro=e.target.closest('[data-reopen]');if(ro){delete S.decisions[ro.dataset.reopen];toast('Reopened');render();return;}
  const a=e.target.closest('[data-ack]');if(a){const[i,op]=a.dataset.ack.split('|');
    if(op==='clear')delete S.acks['r'+i];else S.acks['r'+i]=op;toast(op==='clear'?'Risk reopened':'Risk '+op);render();return;}
  const tr=e.target.closest('[data-treset]');if(tr){setTarget(tr.dataset.treset,null,'cleared');return;}
  if(e.target.closest('#tapply')){
    const id=$('#tkpi').value,v=parseFloat(String($('#tval').value).replace(/,/g,'')),note=$('#tnote').value.trim(),k=KPI(id);
    if(isNaN(v)){toast('Enter a target value first');return;}
    setTarget(id,v,note);return;}
  // Restoring saves the workbook figure back — it's a change like any other, and audited.
  const br=e.target.closest('[data-breset]');if(br){const n=br.dataset.breset;
    setBudget(n,LB(n).orig,'restored to the workbook figure');return;}
  const fd=e.target.closest('[data-fdone]');if(fd){S.decisions[fd.dataset.fdone]={option:null};
    const left=ceoQueue().filter(d=>!S.decisions[d.id]).length;
    toast(left?`Recorded · ${left} left`:'Queue clear');render();return;}
  const fs2=e.target.closest('[data-fskip]');if(fs2){S.acks['skip-'+fs2.dataset.fskip]='snoozed';
    S.decisions[fs2.dataset.fskip]={option:null,skipped:true};toast('Moved to tomorrow');render();return;}
  const fr=e.target.closest('[data-freopen]');if(fr){delete S.decisions[fr.dataset.freopen];render();return;}
  if(e.target.closest('[data-freset]')){S.decisions={};toast('Queue restored');render();return;}
  if(e.target.closest('#single')){S.single=!S.single;document.body.classList.toggle('single',S.single);
    toast(S.single?'One at a time':'Full list');render();return;}
  if(e.target.closest('#brand')){S.brand=!S.brand;applyBrand();
    toast(S.brand?'Ceas Comm palette':'Default palette');setTimeout(draw,60);return;}
  if(e.target.closest('#scale')){S.scale=(S.scale+1)%3;
    document.body.classList.toggle('sc1',S.scale===1);document.body.classList.toggle('sc2',S.scale===2);
    $('#scale').textContent=['Aa','Aa+','Aa++'][S.scale];
    toast(['Normal text','Larger text','Largest text'][S.scale]);setTimeout(draw,60);return;}
  if(e.target.closest('#calm')){S.calm=!S.calm;
    document.documentElement.classList.toggle('calm',S.calm);document.body.classList.toggle('calm',S.calm);
    $('#calm').textContent=S.calm?'Full colour':'Calm';
    toast(S.calm?'Colour only where it changes a decision':'Full colour');setTimeout(draw,60);return;}
  const bm=e.target.closest('[data-bmode]');if(bm){S.bmode=bm.dataset.bmode;render();return;}
  const fb=e.target.closest('[data-fn]');if(fb){S.fn=fb.dataset.fn;
    if(S.page!=='budget'||S.bmode!=='function'){S.bmode='function';goto('budget');}else render();return;}
  const en=e.target.closest('[data-ent]');if(en){switchEntity(en.dataset.ent);return;}
  if(e.target.closest('#bresetall')){(async()=>{for(const l of D.budget.lines){const b=LB(l.name);
    if(b.edited)await setBudget(l.name,b.orig,'restored to the workbook figure');}})();return;}
  if(e.target.closest('#bapply')){
    const n=$('#bline').value,v=parseFloat(String($('#bval').value).replace(/,/g,'')),note=$('#bnote').value.trim();
    if(isNaN(v)||v<0){toast('Enter an annual budget first');return;}
    setBudget(n,v,note);return;}
  if(e.target.closest('#nkadd')){addKpi();return;}
  const kd=e.target.closest('[data-kdel]');if(kd){removeKpi(kd.dataset.kdel);return;}
  const pf=e.target.closest('[data-pref]');if(pf){setEscalation('routes/'+encodeURIComponent(pf.dataset.pref),{comesToCeo:!S.prefs.ceo[pf.dataset.pref]},'Queue re-routed');return;}
  if(e.target.closest('#collapse')){S.narrow=!S.narrow;$('#app').classList.toggle('narrow',S.narrow);setTimeout(draw,180);return;}
  if(e.target.closest('#hideamt')){const on=document.body.classList.toggle('blurred');
    $('#hideamt').textContent=on?'Show amounts':'Hide amounts';toast(on?'Figures hidden':'Figures visible');return;}
  if(e.target.closest('#search')){cmdOpen();return;}
  if(e.target.closest('#syncchip')){toast(sourcesSummary());return;}
  /* Goes through the portal's setTheme so the choice persists and stays in
     step with the account menu's own theme control. */
  if(e.target.closest('#theme')){setTheme(isDarkTheme()?'light':'dark');syncThemeChip();
    applyBrand();render();return;}
  if(e.target.closest('#drclose')||e.target.id==='sc'){closeDrill();return;}
  if(e.target.closest('#railhome')){location.href='/';return;}
  const hr=e.target.closest('[data-href]');if(hr){location.href=hr.dataset.href;return;}
  const ci=e.target.closest('.ci');if(ci){const n=+ci.dataset.c;cmdClose();cmdF[n].go();return;}
  if(e.target.id==='cmd')cmdClose();
});
document.addEventListener('input',e=>{
  if(e.target.id==='cmdin'){cmdS=0;cmdRender(e.target.value);}
});
document.addEventListener('change',e=>{
  if(e.target.id==='yr'){S.year=e.target.value;if(S.cmp===S.year)S.cmp='';
    toast(S.year==='2026'?'Back to the live year':`${S.year} · closed year scorecard`);render();return;}
  if(e.target.id==='cmp'){S.cmp=e.target.value;
    toast(S.cmp?`Comparing with ${S.cmp}`:'Comparison off');render();return;}
  const pl=e.target.closest('[data-plan]');
  if(pl){const [fid,cat,i]=pl.dataset.plan.split('|');
    const v=parseFloat(String(pl.value).replace(/,/g,''));
    if(!isNaN(v)&&v>=0)setPlan(fid,cat,+i,v);else render();return;}
  const bs=e.target.closest('[data-bset]');
  if(bs){const v=parseFloat(String(bs.value).replace(/,/g,''));
    if(!isNaN(v)&&v>=0)setBudget(bs.dataset.bset,v);else render();return;}
  const ts=e.target.closest('[data-tset]');
  // An emptied box clears the target.
  if(ts){const raw=String(ts.value).replace(/,/g,'').trim(),v=parseFloat(raw);
    if(raw==='')setTarget(ts.dataset.tset,null);else if(!isNaN(v))setTarget(ts.dataset.tset,v);else render();return;}
  if(e.target.id==='mth'){const v=Math.round(+String(e.target.value).replace(/,/g,''));
    if(Number.isFinite(v)&&v>=0)setEscalation('threshold',{amount:v},'Threshold updated');else render();}});
/* Escalation preferences are company-wide and saved first; the queue only
   re-routes once the server has the change. */
async function setEscalation(path,body,done){
  try{const {prefs}=await apiFetch('/api/ceo-dashboard/escalation/'+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    S.prefs=prefs;D.prefs=structuredClone(prefs);toast(done);}
  catch(err){toast('Not saved — '+(err.message||'the server refused the change'));}
  render();}
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('tin')){e.target.blur();}
  if(e.key==='Enter'&&e.target.id==='railhome'){location.href='/';}
});
addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();cmdOpen();return;}
  if(e.key==='Escape'){cmdClose();closeDrill();}
  if($('#cmd').dataset.open==='true'){
    if(e.key==='ArrowDown'){e.preventDefault();cmdS++;cmdRender($('#cmdin').value);}
    if(e.key==='ArrowUp'){e.preventDefault();cmdS=Math.max(0,cmdS-1);cmdRender($('#cmdin').value);}
    if(e.key==='Enter'&&cmdF[cmdS]){cmdClose();cmdF[cmdS].go();}
    return;}
  if(e.key==='f'&&S.scope!=='limited'&&!/input|textarea|select/i.test(e.target.tagName)){goto('focus');return;}
  if(/^[1-9]$/.test(e.key)&&!/input|textarea|select/i.test(e.target.tagName)&&pages()[+e.key-1])goto(pages()[+e.key-1].id);
});
/* Back/forward between pages. goto() sets S.page before the hash, so its
   own hash change is a no-op here. */
addEventListener('hashchange',()=>{const id=location.hash.slice(1);
  if(!pages().some(p=>p.id===id)){history.replaceState(null,'','#'+S.page);return;}
  if(id!==S.page){S.page=id;closeDrill();render();}});
let rt;
addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(draw,140);});
