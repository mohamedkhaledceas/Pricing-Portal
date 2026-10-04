import { escapeHtml } from './dom.js';

// Markup builders for the panel system in employees.css (.attn / .panel /
// .list). Shared by every tab migrated onto it so each one renders the same
// structure instead of keeping its own copy.

export function plural(n, one, many) {
  return n === 1 ? one : many;
}

export function panel({ id, title, meta, actions, body }) {
  return `<section class="panel"${id ? ` id="${id}"` : ''}>
    <div class="panel-head">
      <h2 class="panel-title">${escapeHtml(title)}</h2>
      ${meta ? `<span class="panel-meta">${meta}</span>` : ''}
      ${actions ? `<div class="panel-actions">${actions}</div>` : ''}
    </div>
    ${body}
  </section>`;
}

export function split(cols, template) {
  return `<div class="panel-split"${template ? ` style="--split:${template}"` : ''}>${cols.map((c) => `<div class="panel-col"${c.id ? ` id="${c.id}"` : ''}>${c.html}</div>`).join('')}</div>`;
}

export function colTitle(text, meta) {
  return `<h3 class="panel-col-title"><span>${escapeHtml(text)}</span>${meta ? `<span class="panel-meta">${meta}</span>` : ''}</h3>`;
}

function initialsOf(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function personRow(name, meta, opts) {
  const o = opts || {};
  return `<li class="list-row${o.flagged ? ' is-flagged' : ''}">
    <span class="initials" aria-hidden="true">${escapeHtml(initialsOf(name))}${o.online ? '<span class="presence-dot online"></span>' : ''}</span>
    <div class="list-main">
      <div class="list-title">${escapeHtml(name)}</div>
      ${meta ? `<div class="list-meta">${meta}</div>` : ''}
      ${o.flag ? `<div class="list-flag">${escapeHtml(o.flag)}</div>` : ''}
    </div>
  </li>`;
}

export function list(rowsHtml, emptyMessage, extraClass) {
  return rowsHtml.length
    ? `<ul class="list${extraClass ? ' ' + extraClass : ''}">${rowsHtml.join('')}</ul>`
    : `<div class="list-empty">${escapeHtml(emptyMessage)}</div>`;
}

// Trims a trailing ".0" (e.g. partial-day usage can leave a value like 13.5,
// but whole numbers should read as "14", not "14.0").
export function fmtBalanceNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function meter(b) {
  const unit = b.unit === 'hours' ? 'h' : (b.remaining === 1 ? ' day' : ' days');
  const pct = b.total ? Math.max(0, Math.min(100, (b.remaining / b.total) * 100)) : 0;
  return `<div class="meter${b.remaining <= 0 ? ' is-empty' : ''}">
    <div class="meter-top">
      <span class="meter-label">${escapeHtml(b.label)}${b.period === 'month' ? ' <span class="muted">this month</span>' : ''}</span>
      <span class="meter-value"><strong>${fmtBalanceNum(b.remaining)}${unit}</strong> left of ${fmtBalanceNum(b.total)}</span>
    </div>
    <div class="meter-track" role="img" aria-label="${escapeHtml(`${b.label}: ${fmtBalanceNum(b.remaining)} of ${fmtBalanceNum(b.total)} left`)}"><div class="meter-fill" style="width:${pct}%;"></div></div>
  </div>`;
}

// Sick/Unpaid have no quota (leaveBalanceRules.computeBalances gives them
// no total/remaining, deliberately — see that file's own comment), so they
// get a plain "taken this year" footnote rather than a meter with nothing
// to measure against.
export function balancesHtml(balances) {
  if (!balances) return '<div class="list-empty">Balances are unavailable right now.</div>';
  const taken = (b) => `${escapeHtml(b.label)}: ${fmtBalanceNum(b.used)}${b.unit === 'hours' ? 'h' : ''} taken`;
  return `<div class="meter-list">${[balances.planned, balances.combined, balances.wfh, balances.excuse].map(meter).join('')}</div>
    <div class="footnote">This year — ${taken(balances.sick)}, ${taken(balances.unpaid)}</div>`;
}

export function loadErrorPanel(heading, err, retryAttr) {
  return `<section class="panel"><div class="panel-body">
    <div style="font-weight:650;margin-bottom:4px;">${escapeHtml(heading)}</div>
    <div class="muted small">${escapeHtml(err && err.message ? err.message : 'The server did not respond.')}</div>
    <div class="mt-16"><button class="small" ${retryAttr}>Try again</button></div>
  </div></section>`;
}

export function fullName(e) {
  const name = `${e.firstName || ''} ${e.lastName || ''}`.trim();
  return name || `Unnamed employee #${e.id}`;
}

// One person with every directory field visible (no click-to-expand):
// avatar, name + badges, job title, department, email. Uses the
// AccountMenu/Departments globals every people-facing page already loads.
// badges: [{ label, tone }] where tone is any .badge-* suffix.
export function peopleRowHtml(e, badges, attrs) {
  const dept = e.department ? window.Departments.labelFor(e.department) : '';
  return `<li class="people-row"${attrs || ''}>
    <span class="people-avatar">${window.AccountMenu.avatarHtml(e.photoUrl, e)}</span>
    <div class="list-main">
      <div class="list-title">${escapeHtml(fullName(e))}${(badges || []).map((b) => ` <span class="badge badge-${b.tone}">${escapeHtml(b.label)}</span>`).join('')}</div>
      <div class="list-meta">${escapeHtml(e.jobTitle || 'No job title')}</div>
    </div>
    <div class="people-dept">${escapeHtml(dept || '—')}</div>
    <div class="people-email">${e.email ? `<a href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '<span class="muted">No email</span>'}</div>
  </li>`;
}
