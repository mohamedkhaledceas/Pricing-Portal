/* ═════ helpers ═════ */
export const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
export const NS='http://www.w3.org/2000/svg';
export const V=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const el=(t,a,p)=>{const e=document.createElementNS(NS,t);for(const k in a)if(a[k]!=null)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e;};
export function money(v,c=true){if(v==null)return'—';const a=Math.abs(v);
  if(!c)return Math.round(v).toLocaleString('en-US');
  if(a>=1e6)return(v/1e6).toFixed(a>=1e7?1:2).replace(/\.?0+$/,'')+'M';
  if(a>=1e3)return Math.round(v/1e3)+'K';return String(Math.round(v));}
export const egp=(v,c=true)=>(v<0?'−':'')+money(Math.abs(v),c);
export const num=v=>Math.round(v).toLocaleString('en-US');
export const r1=v=>Math.round(v*10)/10;
export function fmt(k,v){if(v==null)return'—';
  return k.unit==='egp'?egp(v):k.unit==='pct'?r1(v)+'%':k.unit==='days'?Math.round(v)+'d':
    k.unit==='months'?r1(v)+' mo':k.unit==='ratio'?v.toFixed(2)+'×':num(v);}
export function fmtD(k,v){if(v==null)return'—';const s=v>0?'+':'−',a=Math.abs(v);
  return k.unit==='egp'?s+egp(a):k.unit==='pct'?s+r1(a)+'pts':k.unit==='days'?s+Math.round(a)+'d':
    k.unit==='months'?s+r1(a)+'mo':k.unit==='ratio'?s+a.toFixed(2)+'×':s+num(a);}
/* Live KPIs can have no target (none agreed) or no actual (nothing billed
   yet) — these render the gap as "—" instead of "null%". */
export const pctx=v=>v==null?'—':v+'%';
export const tval=v=>v==null?'':v.toLocaleString('en-US');
/* fmt() with the entity currency in front, for live money KPIs. */
export const fmtc=(k,v)=>(k.currency&&k.unit==='egp'&&v!=null?k.currency+' ':'')+fmt(k,v);
export const TT={min:'min',max:'max',exact:'target',threshold:'threshold'};
export const RAGL={green:'On target',amber:'At risk',red:'Off target',none:'—'};
export const tag=r=>r==='none'?'':`<span class="tag g-${r}">${RAGL[r]}</span>`;
export const sevtag=s=>`<span class="tag g-${s==='critical'?'red':s==='serious'?'amber':'amber'}">${s[0].toUpperCase()+s.slice(1)}</span>`;
/* tooltip */
export const tip=$('#tip');
export const tShow=(h,e)=>{tip.innerHTML=h;tip.style.display='block';tMove(e);};
export function tMove(e){const p=14,w=tip.offsetWidth,h=tip.offsetHeight;let x=e.clientX+p,y=e.clientY+p;
  if(x+w>innerWidth-8)x=e.clientX-w-p;if(y+h>innerHeight-8)y=e.clientY-h-p;tip.style.left=x+'px';tip.style.top=Math.max(8,y)+'px';}
export const tHide=()=>tip.style.display='none';
export const hov=(n,h)=>{n.addEventListener('mouseenter',e=>tShow(h,e));n.addEventListener('mousemove',tMove);n.addEventListener('mouseleave',tHide);};
export function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),2400);}
