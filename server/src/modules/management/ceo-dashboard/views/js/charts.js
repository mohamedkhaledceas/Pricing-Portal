/* Chart primitives ported from the CEO dashboard prototype almost
   unchanged — hand-rolled inline SVG (bars, columns, line, stacked bar,
   sparkline), tooltip, and the money/percent formatting helpers the
   render functions in render.js depend on. This module has no fetch/state
   dependency of its own: everything here is a pure function of the data
   it's given, same as commercial-leads/views/js/charts.js's smaller
   bar-chart version — this one is a page-specific superset, not a shared
   library, per state.js's note that promotion to something shared waits
   for a second real consumer. */
import { escapeHtml as esc } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const V = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export function money(v, compact = true) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (!compact) return v.toLocaleString('en-US');
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
  if (a >= 1e3) return Math.round(v / 1e3) + 'K';
  return String(Math.round(v));
}
export const egp = (v, c = true) => 'EGP ' + money(v, c);
export const num = (v) => v.toLocaleString('en-US');

export function deltaHTML(d, goodUp = true, suffix = '', prefix = '') {
  if (d === 0) return `<span class="delta flat">no change</span>`;
  const up = d > 0, good = (up === goodUp);
  let s = suffix;
  if (Math.abs(d) === 1) { s = s.replace(' pts', ' pt').replace(' days', ' day'); }
  return `<span class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${prefix}${Math.abs(d).toLocaleString('en-US')}${s}</span>`;
}

/* clean axis numbers — never a raw 8.88M tick */
const STEPS = [1, 2, 2.5, 5, 10], INTSTEPS = [1, 2, 5, 10];
function niceStep(rough, intOnly) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))));
  for (const m of (intOnly ? INTSTEPS : STEPS)) { if (m * mag >= rough) return m * mag; }
  return 10 * mag;
}
function niceMax(v, ticks = 4, intOnly = false) { return niceStep(v / ticks, intOnly) * ticks; }
function niceScale(lo, hi, ticks = 4, intOnly = false) {
  const step = niceStep(((hi - lo) || 1) / ticks, intOnly);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}

/* white or ink inside a coloured fill, by luminance */
function inkOn(hex) {
  const h = hex.replace('#', ''); const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.substr(i, 2), 16) / 255)
    .map((c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.42 ? '#0b0b0b' : '#ffffff';
}
export function sevOf(score) { return score >= 70 ? 'good' : score >= 60 ? 'warning' : score >= 50 ? 'serious' : 'critical'; }
export function sevColor(s) { return V('--' + s); }
export const RAGMAP = { green: 'good', amber: 'warning', red: 'critical' };
export function badge(sev, label) { return `<span class="badge ${sev}"><i class="bd"></i>${esc(label)}</span>`; }

function barH(x, y, w, h, r = 4) {
  r = Math.min(r, Math.max(w, 0), h / 2);
  if (w <= 0.6) return '';
  if (w <= r) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`;
}
function barV(x, yTop, w, h, r = 4) {
  const y0 = yTop + h; r = Math.min(r, w / 2, Math.max(h, 0));
  if (h <= 0.6) return '';
  return `M${x},${y0} V${yTop + r} A${r},${r} 0 0 1 ${x + r},${yTop} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${yTop + r} V${y0} Z`;
}

/* tooltip */
let tip;
function tipShow(html, ev) { tip = tip || document.getElementById('tip'); tip.innerHTML = html; tip.style.display = 'block'; tipMove(ev); }
function tipMove(ev) {
  tip = tip || document.getElementById('tip');
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = x + 'px'; tip.style.top = Math.max(8, y) + 'px';
}
function tipHide() { tip = tip || document.getElementById('tip'); tip.style.display = 'none'; }
function hoverable(node, html) {
  node.style.cursor = 'default';
  node.addEventListener('mouseenter', (e) => tipShow(html, e));
  node.addEventListener('mousemove', tipMove);
  node.addEventListener('mouseleave', tipHide);
}

export function buildTable(headers, rows) {
  return `<table><thead><tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/* Horizontal bars. items:[{name,value,color?,label?}] */
export function chartBarsH(mount, { items, color, valueFmt, reference, refLabel, unit, labelW = null }) {
  mount.innerHTML = '';
  const W = mount.clientWidth || 600;
  const labW = labelW ?? Math.min(190, Math.max(90, W * 0.30));
  const rowH = Math.min(34, Math.max(26, 240 / items.length)), gap = 8, barT = Math.min(22, rowH - gap);
  const top = reference != null ? 16 : 0;
  const H = items.length * rowH + 8 + top;
  const plotW = W - labW - 64;
  const max = Math.max(...items.map((d) => d.value), reference ?? 0) * 1.02 || 1;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, mount);

  if (reference != null) {
    const rx = labW + (reference / max) * plotW;
    svgEl('line', { x1: rx, x2: rx, y1: top, y2: H - 8, stroke: V('--axis'), 'stroke-width': 1 }, svg);
    const t = svgEl('text', { x: rx, y: 10, 'text-anchor': 'middle', fill: V('--muted'), 'font-size': 10.5 }, svg);
    t.textContent = refLabel || 'target';
  }
  items.forEach((d, i) => {
    const y = top + i * rowH + (rowH - barT) / 2;
    const w = Math.max(0, (d.value / max) * plotW);
    const lab = svgEl('text', { x: labW - 10, y: y + barT / 2 + 4, 'text-anchor': 'end', fill: V('--ink-2'), 'font-size': 12 }, svg);
    lab.textContent = d.name;
    const p = svgEl('path', { d: barH(labW, y, w, barT, 4), fill: d.color || color || V('--s1') }, svg);
    hoverable(p, `<div class="tk">${esc(d.name)}</div><b>${valueFmt(d.value)}</b>${d.extra ? `<div class="tk">${d.extra}</div>` : ''}`);
    const vt = svgEl('text', { x: labW + w + 8, y: y + barT / 2 + 4, fill: V('--ink-2'), 'font-size': 11.5 }, svg);
    vt.textContent = (d.label !== undefined ? d.label : valueFmt(d.value));
  });
  return { headers: ['Item', unit || 'Value'], rows: items.map((d) => [esc(d.name), valueFmt(d.value)]) };
}

/* Columns with a target reference line */
export function chartColumns(mount, { labels, values, target, valueFmt, partialLast, unit }) {
  mount.innerHTML = '';
  const W = mount.clientWidth || 600, H = 240, pad = { t: 16, r: 12, b: 28, l: 52 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(...values, target || 0), 4);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, mount);
  const y = (v) => pad.t + plotH - (v / max) * plotH;

  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = max * i / ticks, yy = y(val);
    svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: V('--grid'), 'stroke-width': 1 }, svg);
    const t = svgEl('text', {
      x: pad.l - 8, y: yy + 3.5, 'text-anchor': 'end', fill: V('--muted'), 'font-size': 10.5,
      style: 'font-variant-numeric:tabular-nums',
    }, svg);
    t.textContent = money(val);
  }
  const band = plotW / values.length, bw = Math.min(24, band * 0.5);
  if (target) {
    const ty = y(target);
    svgEl('line', { x1: pad.l, x2: W - pad.r, y1: ty, y2: ty, stroke: V('--axis'), 'stroke-width': 1 }, svg);
    const t = svgEl('text', { x: W - pad.r, y: ty - 6, 'text-anchor': 'end', fill: V('--muted'), 'font-size': 10.5 }, svg);
    t.textContent = 'monthly target ' + money(target);
  }
  values.forEach((v, i) => {
    const x = pad.l + band * i + (band - bw) / 2, yy = y(v), h = pad.t + plotH - yy;
    const partial = partialLast && i === values.length - 1;
    const p = svgEl('path', { d: barV(x, yy, bw, h, 4), fill: partial ? V('--o1') : V('--s1') }, svg);
    hoverable(p, `<div class="tk">${esc(labels[i])}${partial ? ' (month to date)' : ''}</div><b>${valueFmt(v)}</b>${target ? `<div class="tk">target ${valueFmt(target)}</div>` : ''}`);
    const t = svgEl('text', { x: pad.l + band * i + band / 2, y: H - 9, 'text-anchor': 'middle', fill: V('--muted'), 'font-size': 10.5 }, svg);
    t.textContent = labels[i];
  });
  const li = values.length - 1, lx = pad.l + band * li + band / 2;
  const lt = svgEl('text', { x: lx, y: y(values[li]) - 7, 'text-anchor': 'middle', fill: V('--ink-2'), 'font-size': 11, 'font-weight': 600 }, svg);
  lt.textContent = valueFmt(values[li]);
  return { headers: ['Month', unit || 'Value'], rows: labels.map((l, i) => [esc(l) + (partialLast && i === li ? ' (MTD)' : ''), valueFmt(values[i])]) };
}

/* Single-series line with crosshair, optional reference line */
export function chartLine(mount, { labels, values, valueFmt, reference, refLabel, unit, area = true }) {
  mount.innerHTML = '';
  const W = mount.clientWidth || 600, H = 210, pad = { t: 20, r: 56, b: 26, l: 44 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const all = values.concat(reference != null ? [reference] : []);
  const sc = niceScale(Math.min(...all), Math.max(...all), 4, true);
  const lo = sc.lo, hi = sc.hi;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, mount);
  const x = (i) => pad.l + (plotW * i / Math.max(1, values.length - 1));
  const y = (v) => pad.t + plotH - ((v - lo) / (hi - lo)) * plotH;

  for (let v = lo; v <= hi + 1e-9; v += sc.step) {
    const yy = y(v);
    svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: V('--grid'), 'stroke-width': 1 }, svg);
    const t = svgEl('text', {
      x: pad.l - 8, y: yy + 3.5, 'text-anchor': 'end', fill: V('--muted'), 'font-size': 10.5,
      style: 'font-variant-numeric:tabular-nums',
    }, svg);
    t.textContent = Math.round(v * 10) / 10;
  }
  if (reference != null) {
    const ry = y(reference);
    svgEl('line', { x1: pad.l, x2: W - pad.r, y1: ry, y2: ry, stroke: V('--axis'), 'stroke-width': 1 }, svg);
    const t = svgEl('text', { x: pad.l + 4, y: ry - 6, fill: V('--muted'), 'font-size': 10.5 }, svg);
    t.textContent = (refLabel || 'target') + ' ' + valueFmt(reference);
  }
  const pts = values.map((v, i) => [x(i), y(v)]);
  if (area) {
    svgEl('path', {
      d: `M${pts[0][0]},${pad.t + plotH} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${pts.at(-1)[0]},${pad.t + plotH} Z`,
      fill: V('--s1'), opacity: .10,
    }, svg);
  }
  svgEl('path', {
    d: 'M' + pts.map((p) => p.join(',')).join(' L'), fill: 'none', stroke: V('--s1'),
    'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }, svg);
  const e = pts.at(-1);
  svgEl('circle', { cx: e[0], cy: e[1], r: 5, fill: V('--s1'), stroke: V('--card'), 'stroke-width': 2 }, svg);
  const el = svgEl('text', { x: e[0] + 8, y: e[1] - 8, fill: V('--ink-2'), 'font-size': 11, 'font-weight': 600 }, svg);
  el.textContent = valueFmt(values.at(-1));

  labels.forEach((l, i) => {
    if (labels.length > 8 && i % 2) return;
    const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', fill: V('--muted'), 'font-size': 10.5 }, svg);
    t.textContent = l;
  });
  const cross = svgEl('line', { x1: 0, x2: 0, y1: pad.t, y2: pad.t + plotH, stroke: V('--axis'), 'stroke-width': 1, opacity: 0 }, svg);
  const cdot = svgEl('circle', { r: 5, fill: V('--s1'), stroke: V('--card'), 'stroke-width': 2, opacity: 0 }, svg);
  const hit = svgEl('rect', { x: pad.l - 8, y: pad.t, width: plotW + 16, height: plotH, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    let i = Math.round((px - pad.l) / (plotW / Math.max(1, values.length - 1)));
    i = Math.max(0, Math.min(values.length - 1, i));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    cdot.setAttribute('cx', x(i)); cdot.setAttribute('cy', y(values[i])); cdot.setAttribute('opacity', 1);
    tipShow(`<div class="tk">${esc(labels[i])}</div><b>${valueFmt(values[i])}</b>` +
      (reference != null ? `<div class="tk">${refLabel || 'target'} ${valueFmt(reference)}</div>` : ''), ev);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); cdot.setAttribute('opacity', 0); tipHide(); });
  return { headers: ['Period', unit || 'Value'], rows: labels.map((l, i) => [esc(l), valueFmt(values[i])]) };
}

/* Stacked horizontal bar. segments:[{name,value,color}] — 2px surface gap between fills */
export function chartStackH(mount, { segments, valueFmt, unit, height = 54 }) {
  mount.innerHTML = '';
  const W = mount.clientWidth || 600, H = height;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const gap = 2, avail = W - gap * (segments.length - 1);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, mount);
  const barT = Math.min(28, H - 24);
  let x = 0;
  segments.forEach((s, i) => {
    const w = (s.value / total) * avail;
    const first = i === 0, last = i === segments.length - 1;
    let d;
    if (first && last) d = barH(x, 0, w, barT, 4);
    else if (first) d = `M${x + 4},0 H${x + w} V${barT} H${x + 4} A4,4 0 0 1 ${x},${barT - 4} V4 A4,4 0 0 1 ${x + 4},0 Z`;
    else if (last) d = barH(x, 0, w, barT, 4);
    else d = `M${x},0 H${x + w} V${barT} H${x} Z`;
    const p = svgEl('path', { d, fill: s.color }, svg);
    const pctv = (s.value / total * 100).toFixed(1);
    hoverable(p, `<div class="tk">${esc(s.name)}</div><b>${valueFmt(s.value)}</b> · ${pctv}%`);
    const txt = pctv + '%';
    if (w > 52) {
      const t = svgEl('text', {
        x: x + w / 2, y: barT / 2 + 4, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 600,
        fill: inkOn(s.color),
      }, svg);
      t.textContent = txt;
    }
    const nl = svgEl('text', { x, y: barT + 16, 'font-size': 11, fill: V('--muted') }, svg);
    if (w > 62) nl.textContent = s.name;
    x += w + gap;
  });
  return {
    headers: ['Segment', unit || 'Value', 'Share'],
    rows: segments.map((s) => [esc(s.name), valueFmt(s.value), (s.value / total * 100).toFixed(1) + '%']),
  };
}

/* sparkline for stat tiles */
export function sparkSVG(values, w = 120, h = 26) {
  const lo = Math.min(...values), hi = Math.max(...values), s = (hi - lo) || 1;
  const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 2 - ((v - lo) / s) * (h - 4)]);
  const last = pts.at(-1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="M${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' L')}" fill="none"
      stroke="${V('--demph')}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="${V('--s1')}"
      stroke="${V('--surface-1')}" stroke-width="2"/></svg>`;
}

export function tile({ lab, val, sec, delta, spark }) {
  return `<div class="tile"><div class="lab">${esc(lab)}</div><div class="val">${val}</div>
    ${sec ? `<div class="sec">${sec}</div>` : ''}${delta ? `<div class="sec">${delta}</div>` : ''}
    ${spark || ''}</div>`;
}
export function meter(c) {
  const sev = sevOf(c.score);
  return `<div class="meterrow">
      <span class="mname">${esc(c.name)}</span>
      <span class="mw">${c.weight}%</span>
      <span class="meterbar"><i style="width:${c.score}%;background:${sevColor(sev)}"></i></span>
      <span class="mval">${c.score}</span>
    </div><div class="meternote">${esc(c.note)}</div>`;
}
