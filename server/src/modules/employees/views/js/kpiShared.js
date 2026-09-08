import { escapeHtml } from './dom.js';

const STATUS_COLORS = {
  exceptional: 'var(--good-text)', strong: 'var(--good-text)', on_track: '#1a5fd6',
  needs_improvement: '#8a5b00', at_risk: 'var(--critical)',
};

export function scoreColor(score, max) {
  if (score === null || score === undefined) return 'var(--muted)';
  const r = max ? score / max : 0;
  return r >= 0.8 ? 'var(--good-text)' : r >= 0.6 ? '#1a5fd6' : r >= 0.4 ? '#8a5b00' : 'var(--critical)';
}

export function bar(score, max) {
  const pct = Math.max(0, Math.min(100, max ? (score / max) * 100 : 0));
  return `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${pct}%; background:${scoreColor(score, max)};"></div></div>`;
}

export function statusBadge(statusBand) {
  const color = STATUS_COLORS[statusBand.key] || 'var(--muted)';
  return `<span class="badge badge-status-${statusBand.key}" style="background:color-mix(in srgb, ${color} 16%, transparent); color:${color};">${escapeHtml(statusBand.label)}</span>`;
}

export function ratingOptionsHtml(selected) {
  const opts = ['<option value="">—</option>'];
  for (let i = 0; i <= 10; i++) opts.push(`<option value="${i}" ${selected === i ? 'selected' : ''}>${i}</option>`);
  return opts.join('');
}
