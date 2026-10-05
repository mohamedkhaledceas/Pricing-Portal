import { chBars, chCols, chLine, chStack, chWater, ico } from './charts.js';
import { loadBook } from './clientBook.js';
import { D } from './data.js';
import { ceoQueue, CUR, KPI, LK, pages, PAGES, S, tierOf, YRS } from './model.js';
import { P } from './pages.js';
import { isDarkTheme } from './theme.js';
import { $, egp, esc, fmt, fmtc, fmtD, money, num, pctx, r1, sevtag, TT, tval, V } from './util.js';

/* ═════ charts per page ═════ */
export function draw(){
  const g=id=>document.getElementById(id);
  const ramp=[V('--o1'),V('--o2'),V('--o3'),V('--o4')];
  if(g('w1'))chWater(g('w1'),{items:D.cash.bridge,fmtv:v=>'EGP '+egp(v)});
  if(g('b1'))chWater(g('b1'),{items:D.budget.bridge,fmtv:v=>'EGP '+egp(v)});
  /* Live aging has five buckets (not yet due + four overdue); the ramp has
     four steps, so "not yet due" takes the neutral colour. */
  const amount=D.revenue.live?v=>CUR()+' '+egp(v):v=>'EGP '+egp(v);
  if(g('ar1')){const aging=D.workingCapital.aging,agingCols=aging.length>4?[V('--demph'),...ramp]:ramp;
    chStack(g('ar1'),{segments:aging.map((a,i)=>({...a,color:agingCols[i]})),fmtv:amount});}
  if(g('rev1'))chCols(g('rev1'),{labels:D.months,values:D.revenue.actual,target:D.revenue.target,fmtv:amount,partialLast:true});
  if(g('hc1'))chBars(g('hc1'),{items:D.people.departments.map(d=>({name:d.name,value:d.count})),fmtv:v=>num(v)+(v===1?' person':' people')});
  if(g('rag1'))chStack(g('rag1'),{segments:[{name:'On track',value:D.delivery.rag.green,color:V('--good')},
    {name:'At risk',value:D.delivery.rag.amber,color:V('--warn')},{name:'Red',value:D.delivery.rag.red,color:V('--crit')}],
    fmtv:v=>num(v)+' projects',height:44});
  if(g('ut1'))chBars(g('ut1'),{items:D.people.teams.map(t=>({name:t.name,value:t.value})),fmtv:v=>r1(v)+'%',ref:75,refLab:'target 75%'});
  if(g('ml1'))chBars(g('ml1'),{items:D.projects.byLine.map(l=>({name:l.name,value:l.margin,
    color:l.margin<35?V('--crit'):l.margin<42?V('--warn'):V('--good'),label:l.margin+'%',
    extra:egp(l.value,false)+' contracted · '+egp(l.profit,false)+' profit'})),fmtv:v=>r1(v)+'%',ref:42,refLab:'target 42%'});
  if(g('pp1')&&D.pipeline.live)chBars(g('pp1'),{items:D.pipeline.stages.map((s,i)=>({name:s.name,value:s.count,color:ramp[Math.min(i,3)]})),
    fmtv:v=>num(v)+(v===1?' deal':' deals')});
  else if(g('pp1'))chBars(g('pp1'),{items:D.pipeline.stages.map((s,i)=>({name:s.name,value:s.value,color:ramp[Math.min(i,3)],
    label:money(s.value)+' · '+s.count,extra:s.prob+'% probability'})),fmtv:v=>'EGP '+egp(v)});
}
/* ═════ drill ═════ */
export function openDrill(id){
  const m=LK(id);if(!m)return;const k=m.k;
  const rec=D.records[k.drill],s=D.series[id];
  const linked=D.risks.filter(r=>r.kpi===id),dec=D.decisions.filter(d=>(d.kpis||[]).includes(id));
  $('#dr').dataset.open='true';$('#dr').classList.remove('wide');document.body.style.overflow='hidden';
  $('#dr .dbody').innerHTML=`
    <div><div class="dkick">${esc(k.component)} · ${esc(k.dept)}</div>
      <div class="dtitle">${esc(k.name)}${k.live?' <span class="mon live">LIVE</span>':''}</div>
      <div class="dsub">${k.direction==='higher_better'?'Higher is better':'Lower is better'} · ${TT[k.targetType]} · rolls up by ${esc(k.agg.replace(/_/g,' '))}</div></div>
    ${k.scored?'':'<div class="alert w"><div><b>Monitoring metric.</b> Measured and wired into the risk engine, not yet part of the health score. It joins the scored set at the 2027 annual plan.</div></div>'}
    <div class="strip">
      <div class="kpi r-${m.rag}" style="cursor:default"><span class="k">Actual</span><span class="val">${fmtc(k,m.actual)}</span></div>
      <div class="kpi" style="cursor:default"><span class="k">Target${m.edited?' · edited':''}</span>
        <span class="val"><input class="tin" data-tset="${id}" value="${tval(m.target)}" placeholder="none set" aria-label="Target for ${esc(k.name)}"></span>
        <span class="meta">press Enter to apply${m.edited?` · was ${fmt(k,m.orig)}`:''}</span></div>
      <div class="kpi" style="cursor:default"><span class="k">Variance</span><span class="val">${fmtD(k,m.variance)}</span></div>
      <div class="kpi" style="cursor:default"><span class="k">Achievement</span><span class="val">${pctx(m.ach)}</span></div></div>
    ${s?'<figure><figcaption><b>Last 13 weeks</b></figcaption><div class="plot" id="dtr"></div></figure>':''}
    <h3 class="sec">Where this number comes from</h3>
    <div class="src"><b>Source</b>${esc(k.source)}</div>
    <div class="src"><b>Query</b>${esc(k.query)}</div>
    <div class="src"><b>Definition</b>${esc(k.formula)}</div>
    ${rec?`<h3 class="sec">Records behind it</h3>
      <div class="tw" style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:9px">
      <table><thead><tr>${rec.columns.map((c,i)=>`<th class="${i?'n':''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rec.rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${i?'n':''}">${typeof c==='number'?`<span class="num">${Math.abs(c)>=1000?num(c):c}</span>`:esc(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note">${esc(rec.source)} — ${esc(rec.note)}</p>`:''}
    ${linked.length?`<h3 class="sec">Linked risks</h3>${linked.map(r=>`<div class="kv"><span>${sevtag(r.severity)} ${esc(r.title)}</span><i>${esc(r.value)}</i></div>`).join('')}`:''}
    ${dec.length?`<h3 class="sec">Linked decisions</h3>${dec.map(d=>`<div class="kv"><span>${esc(d.title)}</span><span class="tier t-${tierOf(d).tier}">${tierOf(d).tier.toUpperCase()}</span></div>`).join('')}`:''}`;
  if(s)chLine($('#dtr'),{labels:D.weekLabels,values:s,fmtv:v=>fmt(k,v),ref:m.target,refLab:'target',intTicks:k.unit!=='egp'});
}
export const closeDrill=()=>{$('#dr').dataset.open='false';$('#dr').classList.remove('wide');document.body.style.overflow='';};
/* ═════ shell ═════ */
export function renderShell(){
  if(S.scope==='budget'){
    $('#railnav').innerHTML=pages().map(navItem).join('');
    $('#railfoot').innerHTML=`<button class="ri" id="collapse">${ico('settings')}<span class="lb">Collapse rail</span></button>`;
    $('#tabs').innerHTML='';
    return;
  }
  $('#railnav').innerHTML=`<div class="rsec">Overview</div>`+
    PAGES.slice(0,1).map(navItem).join('')+
    `<div class="rsec">The business</div>`+PAGES.slice(1,6).map(navItem).join('')+
    `<div class="rsec">System</div>`+PAGES.slice(6).map(navItem).join('');
  $('#railfoot').innerHTML=`<button class="ri" data-href="/client-mapping?from=ceo">${ico('clients')}<span class="lb">Client mapping</span></button>`+
    `<button class="ri" id="collapse">${ico('settings')}<span class="lb">Collapse rail</span></button>`;
  const mob=['today','money','clients','delivery','risks'];
  $('#tabs').innerHTML=mob.map(id=>{const p=PAGES.find(x=>x.id===id);
    return `<button data-go="${id}" aria-current="${S.page===id?'page':'false'}">${ico(p.icon)}${p.name}</button>`;}).join('');
}
export function navItem(p){
  const b=badge(p.id);
  return `<button class="ri" data-go="${p.id}" aria-current="${S.page===p.id?'page':'false'}">${ico(p.icon)}<span class="lb">${p.name}</span>${b}</button>`;
}
export function badge(id){
  if(id==='risks'){const n=ceoQueue().filter(d=>!S.decisions[d.id]).length;return n?`<span class="bd">${n}</span>`:'';}
  if(id==='money')return KPI('cash_runway').rag==='red'?'<span class="bd">!</span>':'';
  if(id==='today'){const n=D.risks.filter(r=>r.since>='2026-09-21').length;return n?`<span class="bd q">${n}</span>`:'';}
  return '';
}
export function goto(id){S.page=id;location.hash='#'+id;render();scrollTo({top:0,behavior:'instant'});}
export function render(){
  const closed=S.year!=='2026';
  const p=pages().find(x=>x.id===S.page)||pages()[0];
  // A page this viewer can't see (typed hash, shortcut) falls back to the
  // first allowed one; keep the URL honest about what is showing.
  if(S.page!==p.id){S.page=p.id;history.replaceState(null,'','#'+p.id);}
  $('#ptitle').textContent=closed?S.year:p.name;
  $('#pcrumb').textContent=closed?'Closed year · settled figures':p.id==='today'?D.asOfLabel:p.crumb;
  $('#page').innerHTML=closed?P.yearreview():P[p.id]();
  renderShell();
  /* Focus shows only the controls that change what is on it; the
     budget-only view has no entity, year or source controls at all. */
  const budgetOnly=S.scope==='budget',bare=S.page==='focus'||budgetOnly;
  if(!budgetOnly){renderYearSel();renderEntSel();renderSync();}
  ['#entsel','#yr','#cmp','#syncchip'].forEach(q=>{const n=$(q);if(n)n.hidden=bare;});
  draw();
  loadBook();
}
/* The brand palette has a light form and a dark form that are not variants of
   each other, so the dark class is applied explicitly rather than inherited. */
export function applyBrand(){
  const dk=isDarkTheme();
  [document.documentElement,document.body].forEach(n=>{
    n.classList.toggle('brand',S.brand);
    n.classList.toggle('dk',S.brand&&dk);});
  const b=$('#brand'); if(b)b.textContent=S.brand?'Default':'Brand';}
export function renderEntSel(){
  $('#entsel').innerHTML=D.entityList.map(e=>
    `<button data-ent="${esc(e.key)}" aria-pressed="${S.ent===e.key}" title="${esc(e.name)} — ${esc(e.note)}">${esc(e.short)}</button>`).join('');}
/* Odoo's last good sync, or the failure, on the top-bar chip. */
export function renderSync(){
  const o=(D.sync||[]).find(x=>x.source==='Odoo'),chip=$('#syncchip');
  $('#syncxt').textContent=!o?'Sample data':o.status==='ok'?`Odoo ${o.at||''}`.trim():o.status==='error'?'Odoo sync failed':'Odoo not synced';
  chip.classList.toggle('bad',!!o&&o.status!=='ok');}
export function renderYearSel(){
  const ys=$('#yr'),cs=$('#cmp');
  ys.innerHTML=YRS().map(y=>`<option value="${y}"${y===S.year?' selected':''}>${y}${D.years[y].status==='current'?'':' · closed'}</option>`).join('');
  cs.innerHTML=`<option value=""${S.cmp?'':' selected'}>No comparison</option>`+
    YRS().filter(y=>y!==S.year).map(y=>`<option value="${y}"${y===S.cmp?' selected':''}>vs ${y}</option>`).join('');
}
