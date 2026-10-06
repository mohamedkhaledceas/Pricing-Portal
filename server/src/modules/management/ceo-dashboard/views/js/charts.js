import { el, esc, hov, money, tHide, tShow, V } from './util.js';

/* axis */
export const ST=[1,2,2.5,5,10],IST=[1,2,5,10];
export function stp(r,i){const m=Math.pow(10,Math.floor(Math.log10(Math.max(r,1e-9))));for(const x of(i?IST:ST))if(x*m>=r)return x*m;return 10*m;}
export const niceMax=(v,t=4,i=false)=>stp(v/t,i)*t;
export const niceScale=(lo,hi,t=4,i=false)=>{const s=stp(((hi-lo)||1)/t,i);return{lo:Math.floor(lo/s)*s,hi:Math.ceil(hi/s)*s,s};};
export function inkOn(hex){const h=hex.replace('#','');const n=h.length===3?h.split('').map(c=>c+c).join(''):h;
  const[r,g,b]=[0,2,4].map(i=>parseInt(n.substr(i,2),16)/255).map(c=>c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4));
  return(.2126*r+.7152*g+.0722*b)>.42?'#101620':'#ffffff';}
export const barH=(x,y,w,h,r=3)=>{r=Math.min(r,Math.max(w,0),h/2);if(w<=.6)return'';if(w<=r)return`M${x},${y} h${w} v${h} h${-w} Z`;
  return`M${x},${y} H${x+w-r} A${r},${r} 0 0 1 ${x+w},${y+r} V${y+h-r} A${r},${r} 0 0 1 ${x+w-r},${y+h} H${x} Z`;};
export const barV=(x,t,w,h,r=3)=>{const b=t+h;r=Math.min(r,w/2,Math.max(h,0));if(h<=.6)return'';
  return`M${x},${b} V${t+r} A${r},${r} 0 0 1 ${x+r},${t} H${x+w-r} A${r},${r} 0 0 1 ${x+w},${t+r} V${b} Z`;};
/* ═════ charts ═════ */
export function chLine(m,{labels,values,fmtv,ref,refLab,intTicks=true,h=180}){
  m.innerHTML='';const W=m.clientWidth||600,H=h,p={t:18,r:50,b:24,l:44};
  const pw=W-p.l-p.r,ph=H-p.t-p.b;
  const all=values.concat(ref!=null?[ref]:[]),sc=niceScale(Math.min(...all),Math.max(...all),4,intTicks);
  const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,height:H,role:'img'},m);
  const X=i=>p.l+pw*i/Math.max(1,values.length-1),Y=v=>p.t+ph-((v-sc.lo)/(sc.hi-sc.lo))*ph;
  for(let v=sc.lo;v<=sc.hi+1e-9;v+=sc.s){const y=Y(v);
    el('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,stroke:V('--grid'),'stroke-width':1},svg);
    const t=el('text',{x:p.l-7,y:y+3.5,'text-anchor':'end',fill:V('--muted'),'font-size':10,'font-family':V('--f-mono')},svg);
    t.textContent=Math.round(v*10)/10;}
  if(ref!=null){const y=Y(ref);el('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,stroke:V('--axis'),'stroke-width':1},svg);
    const t=el('text',{x:p.l+4,y:y-5,fill:V('--muted'),'font-size':10},svg);t.textContent=(refLab||'target')+' '+fmtv(ref);}
  const pts=values.map((v,i)=>[X(i),Y(v)]);
  el('path',{d:`M${pts[0][0]},${p.t+ph} `+pts.map(q=>`L${q[0]},${q[1]}`).join(' ')+` L${pts.at(-1)[0]},${p.t+ph} Z`,fill:V('--accent'),opacity:.09},svg);
  el('path',{d:'M'+pts.map(q=>q.join(',')).join(' L'),fill:'none',stroke:V('--accent'),'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round'},svg);
  const e=pts.at(-1);el('circle',{cx:e[0],cy:e[1],r:4.5,fill:V('--accent'),stroke:V('--surface'),'stroke-width':2},svg);
  const lt=el('text',{x:e[0]+7,y:e[1]-7,fill:V('--ink2'),'font-size':10.5,'font-weight':600,'font-family':V('--f-mono')},svg);lt.textContent=fmtv(values.at(-1));
  labels.forEach((l,i)=>{if(labels.length>8&&i%2)return;const t=el('text',{x:X(i),y:H-7,'text-anchor':'middle',fill:V('--muted'),'font-size':10},svg);t.textContent=l;});
  const cr=el('line',{y1:p.t,y2:p.t+ph,stroke:V('--axis'),'stroke-width':1,opacity:0},svg);
  const cd=el('circle',{r:4.5,fill:V('--accent'),stroke:V('--surface'),'stroke-width':2,opacity:0},svg);
  const hit=el('rect',{x:p.l-8,y:p.t,width:pw+16,height:ph,fill:'transparent'},svg);
  hit.addEventListener('mousemove',ev=>{const r=svg.getBoundingClientRect(),px=(ev.clientX-r.left)*(W/r.width);
    let i=Math.round((px-p.l)/(pw/Math.max(1,values.length-1)));i=Math.max(0,Math.min(values.length-1,i));
    cr.setAttribute('x1',X(i));cr.setAttribute('x2',X(i));cr.setAttribute('opacity',1);
    cd.setAttribute('cx',X(i));cd.setAttribute('cy',Y(values[i]));cd.setAttribute('opacity',1);
    tShow(`<div class="tk">${esc(labels[i])}</div><b>${fmtv(values[i])}</b>`,ev);});
  hit.addEventListener('mouseleave',()=>{cr.setAttribute('opacity',0);cd.setAttribute('opacity',0);tHide();});
}
export function chCols(m,{labels,values,target,fmtv,partialLast}){
  m.innerHTML='';const W=m.clientWidth||600,H=206,p={t:16,r:10,b:26,l:50};
  const pw=W-p.l-p.r,ph=H-p.t-p.b,hi=Math.max(...values,target||0),lo=Math.min(...values,0);
  /* A month can net negative (a credit note larger than that month's
     invoices), so the axis extends below zero when it has to. */
  const step=niceMax(hi-lo,4)/4,max=lo<0?Math.ceil(hi/step)*step:step*4,min=lo<0?Math.floor(lo/step)*step:0;
  const ticks=Math.round((max-min)/step);
  const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,height:H,role:'img'},m),Y=v=>p.t+ph-((v-min)/(max-min))*ph;
  for(let i=0;i<=ticks;i++){const v=min+step*i,y=Y(v);
    el('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,stroke:V('--grid'),'stroke-width':1},svg);
    const t=el('text',{x:p.l-7,y:y+3.5,'text-anchor':'end',fill:V('--muted'),'font-size':10,'font-family':V('--f-mono')},svg);t.textContent=money(v);}
  const band=pw/values.length,bw=Math.min(22,band*.52);
  if(target){const y=Y(target);el('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,stroke:V('--axis'),'stroke-width':1},svg);
    const t=el('text',{x:W-p.r,y:y-5,'text-anchor':'end',fill:V('--muted'),'font-size':10},svg);t.textContent='target '+money(target);}
  if(min<0){const z=Y(0);el('line',{x1:p.l,x2:W-p.r,y1:z,y2:z,stroke:V('--axis'),'stroke-width':1},svg);}
  values.forEach((v,i)=>{const x=p.l+band*i+(band-bw)/2,y=Y(Math.max(v,0)),h=Math.abs(Y(v)-Y(0)),part=partialLast&&i===values.length-1;
    const q=el('path',{d:barV(x,y,bw,h,3),fill:v<0?V('--crit'):part?V('--o1'):V('--accent')},svg);
    hov(q,`<div class="tk">${esc(labels[i])}${part?' · month to date':''}</div><b>${fmtv(v)}</b>`);
    const t=el('text',{x:p.l+band*i+band/2,y:H-8,'text-anchor':'middle',fill:V('--muted'),'font-size':10},svg);t.textContent=labels[i];});
}
export function chBars(m,{items,color,fmtv,ref,refLab}){
  m.innerHTML='';const W=m.clientWidth||600;
  const lw=Math.min(180,Math.max(84,W*.32)),rh=Math.min(30,Math.max(23,230/items.length)),bt=Math.min(18,rh-7),top=ref!=null?14:0;
  const H=items.length*rh+6+top,pw=W-lw-62;
  const max=Math.max(...items.map(d=>d.value),ref??0)*1.02||1;
  const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,height:H,role:'img'},m);
  if(ref!=null){const x=lw+(ref/max)*pw;el('line',{x1:x,x2:x,y1:top,y2:H-6,stroke:V('--axis'),'stroke-width':1},svg);
    const t=el('text',{x:x,y:9,'text-anchor':'middle',fill:V('--muted'),'font-size':10},svg);t.textContent=refLab||'target';}
  items.forEach((d,i)=>{const y=top+i*rh+(rh-bt)/2,w=Math.max(0,(d.value/max)*pw);
    const l=el('text',{x:lw-9,y:y+bt/2+3.5,'text-anchor':'end',fill:V('--ink2'),'font-size':11.5},svg);l.textContent=d.name;
    const q=el('path',{d:barH(lw,y,w,bt,3),fill:d.color||color||V('--accent')},svg);
    hov(q,`<div class="tk">${esc(d.name)}</div><b>${fmtv(d.value)}</b>${d.extra?`<div class="tk">${esc(d.extra)}</div>`:''}`);
    const t=el('text',{x:lw+w+7,y:y+bt/2+3.5,fill:V('--ink2'),'font-size':11,'font-family':V('--f-mono')},svg);
    t.textContent=d.label!==undefined?d.label:fmtv(d.value);});
}
export function chStack(m,{segments,fmtv,height=50}){
  m.innerHTML='';const W=m.clientWidth||600,H=height,tot=segments.reduce((a,s)=>a+s.value,0)||1;
  const gap=2,avail=W-gap*(segments.length-1),bt=Math.min(24,H-22);
  const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,height:H,role:'img'},m);let x=0;
  segments.forEach((s,i)=>{const w=(s.value/tot)*avail,first=i===0,last=i===segments.length-1;
    let d;if(first&&last)d=barH(x,0,w,bt,3);
    else if(first)d=`M${x+3},0 H${x+w} V${bt} H${x+3} A3,3 0 0 1 ${x},${bt-3} V3 A3,3 0 0 1 ${x+3},0 Z`;
    else if(last)d=barH(x,0,w,bt,3);else d=`M${x},0 H${x+w} V${bt} H${x} Z`;
    const q=el('path',{d,fill:s.color},svg),pc=(s.value/tot*100).toFixed(1);
    hov(q,`<div class="tk">${esc(s.name)}</div><b>${fmtv(s.value)}</b> · ${pc}%`);
    if(w>46){const t=el('text',{x:x+w/2,y:bt/2+3.5,'text-anchor':'middle','font-size':10.5,'font-weight':600,fill:inkOn(s.color),'font-family':V('--f-mono')},svg);t.textContent=pc+'%';}
    const n=el('text',{x:x,y:bt+14,'font-size':10.5,fill:V('--muted')},svg);if(w>62)n.textContent=s.name;
    x+=w+gap;});
}
export function chWater(m,{items,fmtv}){
  m.innerHTML='';const W=m.clientWidth||600,H=250,p={t:16,r:10,b:48,l:56};
  const pw=W-p.l-p.r,ph=H-p.t-p.b;let run=0;
  const geo=items.map(it=>{if(it.kind==='total'){const g={lo:0,hi:it.value,total:true};run=it.value;return g;}
    const s=run,e=run+it.value;run=e;return{lo:Math.min(s,e),hi:Math.max(s,e),total:false};});
  const max=niceMax(Math.max(...geo.map(g=>g.hi)),5);
  const svg=el('svg',{viewBox:`0 0 ${W} ${H}`,height:H,role:'img'},m),Y=v=>p.t+ph-(v/max)*ph;
  for(let i=0;i<=5;i++){const v=max*i/5,y=Y(v);
    el('line',{x1:p.l,x2:W-p.r,y1:y,y2:y,stroke:V('--grid'),'stroke-width':1},svg);
    const t=el('text',{x:p.l-7,y:y+3.5,'text-anchor':'end',fill:V('--muted'),'font-size':10,'font-family':V('--f-mono')},svg);t.textContent=money(v);}
  const band=pw/items.length,bw=Math.min(46,band*.6);
  items.forEach((it,i)=>{const g=geo[i],x=p.l+band*i+(band-bw)/2,yT=Y(g.hi),h=Math.max(1.5,Y(g.lo)-Y(g.hi));
    const col=g.total?V('--demph'):(it.value>=0?V('--pos'):V('--neg'));
    const q=el('path',{d:barV(x,yT,bw,h,3),fill:col},svg);
    hov(q,`<div class="tk">${esc(it.label)}</div><b>${fmtv(it.value)}</b>`);
    if(i<items.length-1){const yc=Y(g.total?g.hi:(it.value>=0?g.hi:g.lo));
      el('line',{x1:x+bw,x2:p.l+band*(i+1)+(band-bw)/2,y1:yc,y2:yc,stroke:V('--axis'),'stroke-width':1},svg);}
    const vt=el('text',{x:x+bw/2,y:yT-6,'text-anchor':'middle',fill:V('--ink2'),'font-size':10.5,'font-weight':600,'font-family':V('--f-mono')},svg);
    vt.textContent=(it.value>=0?'':'−')+money(Math.abs(it.value));
    const w2=it.label.split(' '),mid=Math.ceil(w2.length/2);
    const t=el('text',{x:x+bw/2,y:H-30,'text-anchor':'middle',fill:V('--muted'),'font-size':10},svg);t.textContent=w2.slice(0,mid).join(' ');
    if(w2.length>1){const t2=el('text',{x:x+bw/2,y:H-18,'text-anchor':'middle',fill:V('--muted'),'font-size':10},svg);t2.textContent=w2.slice(mid).join(' ');}});
}
export function spark(vals,w=96,h=20){
  if(!vals||!vals.length)return'';
  const lo=Math.min(...vals),hi=Math.max(...vals),s=(hi-lo)||1;
  const pts=vals.map((v,i)=>[i*(w/(vals.length-1)),h-1.5-((v-lo)/s)*(h-3)]),e=pts.at(-1);
  return`<svg class="sprk" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="M${pts.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' L')}" fill="none" stroke="${V('--demph')}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="2.6" fill="${V('--accent')}"/></svg>`;
}
/* ═════ icons ═════ */
export const I={
 today:'<path d="M3 9.5 10 4l7 5.5"/><path d="M5 9v7h10V9"/>',
 focus:'<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none"/>',
 money:'<circle cx="10" cy="10" r="7"/><path d="M10 6v8M8 8.2h3.4M8 11.8h3.4"/>',
 clients:'<circle cx="7.5" cy="7" r="2.6"/><path d="M3 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><circle cx="14" cy="7.5" r="2"/><path d="M13 12.2c2 .2 4 1.3 4 3.8"/>',
 delivery:'<path d="M4 5.5h12v9H4z"/><path d="M4 9h12"/><path d="M8 12.2h4"/>',
 people:'<circle cx="10" cy="6.5" r="2.8"/><path d="M4 16c0-3 2.7-5 6-5s6 2 6 5"/>',
 growth:'<path d="M3.5 14.5 8 10l3 3 5.5-6"/><path d="M13 7h3.5v3.5"/>',
 targets:'<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3"/><circle cx="10" cy="10" r=".9" fill="currentColor"/>',
 budget:'<path d="M3.5 5.5h13v9h-13z"/><path d="M3.5 8.5h13"/><path d="M6.5 11.5h3"/><path d="M13 11.5h1.2"/>',
 risks:'<path d="M10 3.5 17 16H3z"/><path d="M10 8.5v3M10 13.6v.1"/>',
 settings:'<circle cx="10" cy="10" r="2.6"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4"/>',
 more:'<circle cx="5" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.4" fill="currentColor" stroke="none"/>'};
export const ico=n=>`<svg viewBox="0 0 20 20" aria-hidden="true">${I[n]}</svg>`;
