import { apiFetch } from './apiClient.js';
import { panel } from './components.js';
import { $, egp, esc, num } from './util.js';

/* The cross-company client book on the Clients page, and the client
   drawer it opens. Filtering, sorting and paging happen on the server
   (GET /api/ceo-dashboard/clients); this module keeps the query, renders
   only its own panel body on each response — so typing in the search box
   never loses focus — and ignores responses that arrive out of order.
   Independent of the entity switcher: it always covers all three
   companies, with EGP and AED kept apart (no FX yet). */

const COMPANY_NAMES = { ceas: 'Ceas Comm', fze: 'FZE', lwm: 'LWM' };
const TYPE_LABELS = { client: 'Clients', prospect: 'Prospects', lost: 'Lost', all: 'All' };
const SOURCE_LABELS = {
  linked: 'Linked to Odoo',
  unlinked: 'Not linked to Odoo',
  odoo_only: 'Odoo only — no portal client',
};
const SORT_OPTIONS = [
  ['invoiced|EGP', 'Invoiced this year · EGP'], ['invoiced|AED', 'Invoiced this year · AED'],
  ['open|EGP', 'Open · EGP'], ['open|AED', 'Open · AED'],
  ['overdue|EGP', 'Overdue · EGP'], ['overdue|AED', 'Overdue · AED'],
  ['last_invoice|EGP', 'Last invoice'], ['deals|EGP', 'Deals'], ['name|EGP', 'Name'],
];

const book = {
  query: { search: '', company: '', type: 'client', link: 'all', overdue: '0', sort: 'invoiced', currency: 'EGP', dir: 'desc', page: 1, pageSize: 25 },
  result: null,
  loading: false,
  error: null,
  seq: 0,
};
const drawer = { seq: 0, detail: null, taskFilter: 'open' };

const money = (cur, v) => `${cur} ${egp(v, false)}`;
const moneyCell = (r, field) => {
  const parts = Object.entries(r.money).filter(([, m]) => m[field]).map(([cur, m]) =>
    `<div class="num${cur === book.query.currency ? '' : ' cb-alt'}">${money(cur, m[field])}</div>`);
  return parts.length ? parts.join('') : '<span class="note">—</span>';
};
const companyChips = (keys) => keys.map((k) => `<span class="lite">${esc(COMPANY_NAMES[k] || k)}</span>`).join(' ');
const typeTag = (t) => `<span class="tag ${t === 'client' ? 'g-green' : t === 'lost' ? 'g-red' : 'g-amber'}">${esc(TYPE_LABELS[t].replace(/s$/, ''))}</span>`;
const dateText = (iso) => (iso ? esc(String(iso).slice(0, 10)) : '—');

/* Clients page panel. The body fills in once the first response lands. */
export function clientBookPanel() {
  const q = book.query;
  const sortValue = `${q.sort}|${['invoiced', 'open', 'overdue'].includes(q.sort) ? q.currency : 'EGP'}`;
  const controls = `<div class="cb-controls">
    <input class="inp" id="cb-search" type="search" placeholder="Search clients…" value="${esc(q.search)}" aria-label="Search clients" style="width:190px">
    <select class="inp" data-cb="company" aria-label="Company">
      <option value="">All companies</option>
      ${Object.entries(COMPANY_NAMES).map(([k, n]) => `<option value="${k}"${q.company === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <select class="inp" data-cb="link" aria-label="Odoo link">
      ${[['all', 'Any Odoo link'], ...Object.entries(SOURCE_LABELS)].map(([k, n]) => `<option value="${k}"${q.link === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <label class="cb-check"><input type="checkbox" data-cb="overdue"${q.overdue === '1' ? ' checked' : ''}> Has overdue</label>
    <select class="inp" data-cb="sortkey" aria-label="Sort by">
      ${SORT_OPTIONS.map(([v, n]) => `<option value="${v}"${v === sortValue ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <button class="btn" data-cb="dir" title="Reverse the order">${q.dir === 'asc' ? '↑ Ascending' : '↓ Descending'}</button>
  </div>`;
  return panel('Client book · all companies', 'Ceas Comm, FZE and Learn with Marie · EGP and AED shown separately',
    `<div class="pb" style="padding-bottom:0">${controls}</div><div id="cb-body">${bodyHtml()}</div>`);
}

function bodyHtml() {
  if (book.error) return `<div class="empty"><b>Couldn't load the client book</b>${esc(book.error)} <button class="btn" data-cb="retry">Retry</button></div>`;
  const r = book.result;
  if (!r) return '<div class="empty"><b>Loading clients…</b></div>';
  const q = r.query;
  const tabs = `<div class="seg" role="group" aria-label="Type">${['client', 'prospect', 'lost', 'all'].map((t) =>
    `<button data-cb-type="${t}" aria-pressed="${q.type === t}" title="${t === 'client' ? 'Invoiced in Odoo, or a deal that is onboarding, in progress, won or complete' : t === 'lost' ? 'Never invoiced and every deal lost' : t === 'prospect' ? 'Open leads and qualified deals, not yet a client' : ''}">${TYPE_LABELS[t]} <span class="cb-n">${r.counts[t]}</span></button>`).join('')}</div>`;
  const head = [['name', 'Client'], [null, 'Type'], [null, 'Companies'], [null, 'Account manager'],
    ['invoiced', 'Invoiced this year', 1], ['open', 'Open', 1], ['overdue', 'Overdue', 1], ['last_invoice', 'Last invoice', 1], ['deals', 'Deals', 1]]
    .map(([key, label, n]) => {
      if (!key) return `<th>${label}</th>`;
      const on = q.sort === key;
      return `<th class="s${n ? ' n' : ''}" data-cb-sort="${key}"${on ? ` aria-sort="${q.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>${label}<span class="ar">${on ? (q.dir === 'asc' ? '↑' : '↓') : '↕'}</span></th>`;
    }).join('');
  const rows = r.rows.map((c) => `<tr class="cb-row" data-client="${esc(c.key)}" tabindex="0">
      <td><b style="font-weight:500">${esc(c.name)}</b>
        <div class="note">${esc(SOURCE_LABELS[c.source])}${c.status === 'inactive' ? ' · inactive' : ''}</div></td>
      <td>${typeTag(c.type)}</td>
      <td>${c.companies.length ? companyChips(c.companies) : '<span class="note">—</span>'}</td>
      <td>${c.accountManager ? esc(c.accountManager) : '<span class="note">—</span>'}</td>
      <td class="n">${moneyCell(c, 'invoicedYtd')}</td>
      <td class="n">${moneyCell(c, 'open')}</td>
      <td class="n" style="color:var(--badtx)">${moneyCell(c, 'overdue')}</td>
      <td class="n"><span class="num">${dateText(c.lastInvoiceDate)}</span></td>
      <td class="n"><span class="num">${c.deals || '—'}</span>${c.latestDeal ? `<div class="note">${esc(c.latestDeal.status)}</div>` : ''}</td>
    </tr>`).join('');
  const from = r.total ? (q.page - 1) * q.pageSize + 1 : 0;
  const to = Math.min(q.page * q.pageSize, r.total);
  return `<div class="pb" style="padding-top:12px">${tabs}</div>
    <div class="tw${book.loading ? ' cb-loading' : ''}"><table><thead><tr>${head}</tr></thead>
      <tbody>${rows || `<tr><td colspan="9"><div class="empty"><b>No clients match</b>Try clearing the search or a filter.</div></td></tr>`}</tbody></table></div>
    <div class="pb cb-pager">
      <span class="note">${from}–${to} of ${r.total}</span>
      <div class="sp"></div>
      <select class="inp" data-cb="pageSize" aria-label="Rows per page">${[10, 25, 50, 100].map((n) => `<option value="${n}"${q.pageSize === n ? ' selected' : ''}>${n} per page</option>`).join('')}</select>
      <button class="btn" data-cb-page="${q.page - 1}"${q.page <= 1 ? ' disabled' : ''}>Previous</button>
      <span class="note">Page ${q.page} of ${r.pages}</span>
      <button class="btn" data-cb-page="${q.page + 1}"${q.page >= r.pages ? ' disabled' : ''}>Next</button>
    </div>
    <p class="note" style="padding:0 16px 14px">Odoo customers become one row with their portal client once linked on the
      <button class="btn" data-href="/client-mapping?from=ceo" style="padding:0 6px">client-mapping page</button>; until then a client can appear twice.</p>`;
}

function paint() {
  const body = $('#cb-body');
  if (body) body.innerHTML = bodyHtml();
}

/* Called after every page render; fetches the first time and whenever the
   query changed. */
export async function loadBook(force) {
  if (!$('#cb-body')) return;
  if (book.result && !force) { paint(); return; }
  const seq = ++book.seq;
  book.loading = true;
  book.error = null;
  paint();
  const params = new URLSearchParams(Object.entries(book.query).filter(([, v]) => v !== '' && v != null));
  try {
    const { clients } = await apiFetch('/api/ceo-dashboard/clients?' + params.toString());
    if (seq !== book.seq) return;
    book.result = clients;
    book.query.page = clients.query.page;
  } catch (err) {
    if (seq !== book.seq) return;
    book.error = err.message || 'Request failed';
  }
  book.loading = false;
  paint();
}

function setQuery(patch) {
  Object.assign(book.query, patch);
  loadBook(true);
}

/* ═════ client drawer ═════ */

function openDrawerShell() {
  const dr = $('#dr');
  dr.dataset.open = 'true';
  dr.classList.add('wide');
  document.body.style.overflow = 'hidden';
}

export async function openClient(key) {
  const seq = ++drawer.seq;
  drawer.detail = null;
  drawer.taskFilter = 'open';
  openDrawerShell();
  $('#dr .dbody').innerHTML = '<div class="empty"><b>Loading client…</b>Odoo record and ClickUp tasks</div>';
  try {
    const { client } = await apiFetch('/api/ceo-dashboard/clients/' + encodeURIComponent(key));
    if (seq !== drawer.seq) return;
    drawer.detail = client;
    paintDrawer();
  } catch (err) {
    if (seq !== drawer.seq) return;
    $('#dr .dbody').innerHTML = `<div class="empty"><b>Couldn't load this client</b>${esc(err.message || 'Request failed')}</div>`;
  }
}

function paintDrawer() {
  const d = drawer.detail;
  if (!d || $('#dr').dataset.open !== 'true') return;
  const r = d.row;
  const p = d.client;
  const profile = [
    p && p.accountManager ? ['Account manager', p.accountManager] : r && r.accountManager ? ['Account manager', r.accountManager] : null,
    p && p.country ? ['Country', p.country] : null,
    p && p.industry ? ['Industry', p.industry] : null,
    p && p.primaryContactName ? ['Contact', p.primaryContactName] : null,
    p && p.primaryContactEmail ? ['Email', p.primaryContactEmail] : null,
    p && p.primaryContactPhone ? ['Phone', p.primaryContactPhone] : null,
    p && p.website ? ['Website', p.website] : null,
  ].filter(Boolean);

  $('#dr .dbody').innerHTML = `
    <div><div class="dkick">Client${r ? ' · ' + esc(SOURCE_LABELS[r.source]) : ''}</div>
      <div class="dtitle">${esc(r ? r.name : p ? p.name : 'Client')}</div>
      <div class="dsub">${r ? typeTag(r.type) : ''} ${r ? companyChips(r.companies) : ''}${p && p.status === 'inactive' ? ' <span class="lite">inactive</span>' : ''}</div></div>
    ${r && r.source !== 'linked' ? `<div class="alert w"><div>${r.source === 'odoo_only'
      ? '<b>Odoo customer with no portal client.</b> Link it to its ClickUp client so invoices, deals and tasks show together.'
      : '<b>Not linked to an Odoo customer.</b> Its invoices may be listed under the Odoo customer\'s own row.'}
      <button class="btn" data-href="/client-mapping?from=ceo" style="margin-left:6px">Open client mapping</button></div></div>` : ''}
    ${profile.length ? `<div>${profile.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><i>${esc(v)}</i></div>`).join('')}</div>` : ''}
    ${odooSection(d)}
    ${dealsSection(d)}
    ${tasksSection(d)}`;
}

function odooSection(d) {
  const companies = Object.entries(d.companies);
  const partners = d.partners.length ? `<p class="note">Odoo customer${d.partners.length > 1 ? 's' : ''}: ${d.partners.map((pt) =>
    esc(pt.name) + (pt.email ? ` · ${esc(pt.email)}` : '') + (pt.vat ? ` · VAT ${esc(pt.vat)}` : '')).join('; ')}</p>` : '';
  if (!companies.length && !d.invoices.length) {
    return `<h3 class="sec">Odoo</h3><div class="empty" style="padding:14px"><b>No Odoo invoices</b>${d.partners.length ? '' : 'No Odoo customer is linked to this client.'}</div>${partners}`;
  }
  const strip = companies.map(([k, c]) => `<div class="kpi" style="cursor:default">
      <span class="k">${esc(COMPANY_NAMES[k] || k)} · ${esc(c.currency)}</span>
      <span class="val">${egp(c.invoicedYtd)}</span>
      <span class="meta">invoiced this year · ${egp(c.invoicedTotal)} all time</span>
      <span class="meta">open ${egp(c.open)}${c.overdue ? ` · <b style="color:var(--badtx)">overdue ${egp(c.overdue)}</b>` : ''} · ${c.invoiceCount} invoices</span></div>`).join('');
  const invoices = d.invoices.map((i) => `<tr>
      <td>${esc(i.name || '—')}${i.isCreditNote ? ' <span class="lite">credit note</span>' : ''}</td>
      <td>${esc(COMPANY_NAMES[i.company])}</td>
      <td class="n"><span class="num">${dateText(i.invoiceDate)}</span></td>
      <td class="n"><span class="num">${dateText(i.invoiceDateDue)}</span></td>
      <td class="n"><span class="num">${money(i.currency, i.untaxed)}</span></td>
      <td class="n"><span class="num"${i.residual && i.invoiceDateDue < d.asOf ? ' style="color:var(--badtx)"' : ''}>${i.residual ? money(i.currency, i.residual) : '—'}</span></td>
      <td><span class="lite">${esc((i.paymentState || '').replace(/_/g, ' ') || '—')}</span></td></tr>`).join('');
  const payments = d.payments.map((pm) => `<tr>
      <td class="n" style="text-align:left"><span class="num">${dateText(pm.date)}</span></td>
      <td>${esc(COMPANY_NAMES[pm.company])}</td>
      <td class="n"><span class="num">${money(pm.currency, pm.amount)}</span></td>
      <td>${esc(pm.journalName || '—')}</td>
      <td><span class="lite">${esc(pm.state.replace(/_/g, ' '))}</span></td></tr>`).join('');
  return `<h3 class="sec">Odoo</h3>
    <div class="strip">${strip}</div>${partners}
    <div class="tw cb-scroll"><table><thead><tr><th>Invoice</th><th>Company</th><th class="n">Date</th><th class="n">Due</th><th class="n">Untaxed</th><th class="n">Open</th><th>Payment</th></tr></thead>
      <tbody>${invoices || '<tr><td colspan="7" class="note">No invoices</td></tr>'}</tbody></table></div>
    <h3 class="sec">Payments received</h3>
    ${payments ? `<div class="tw cb-scroll"><table><thead><tr><th>Date</th><th>Company</th><th class="n">Amount</th><th>Journal</th><th>State</th></tr></thead><tbody>${payments}</tbody></table></div>`
      : '<p class="note">No customer payments in Odoo.</p>'}`;
}

const clickupUrl = (id) => `https://app.clickup.com/t/${encodeURIComponent(id)}`;
const extLink = (id, text) => `<a href="${clickupUrl(id)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

function dealsSection(d) {
  if (!d.client) return '';
  if (!d.deals.length) return '<h3 class="sec">Deals · ClickUp</h3><p class="note">No Commercial Lead deals recorded for this client.</p>';
  return `<h3 class="sec">Deals · ClickUp</h3>
    <div class="tw"><table><thead><tr><th>Deal</th><th>List</th><th>Status</th><th class="n">Value</th><th>Account manager</th><th>Sales</th><th class="n">Updated</th></tr></thead><tbody>
    ${d.deals.map((x) => `<tr><td>${extLink(x.dealId, x.name || 'Deal')}</td><td>${esc(x.listName)}</td><td><span class="lite">${esc(x.status)}</span></td>
      <td class="n"><span class="num">${x.value ? esc(x.currency || '') + ' ' + num(x.value) : '—'}</span></td>
      <td>${esc(x.accountManager || '—')}</td><td>${esc(x.salesPerson || '—')}</td><td class="n"><span class="num">${dateText(x.updatedAt)}</span></td></tr>`).join('')}
    </tbody></table></div>`;
}

function tasksSection(d) {
  const c = d.clickup;
  if (c.status === 'error') return '<h3 class="sec">Tasks · ClickUp</h3><div class="alert"><div>Couldn\'t reach ClickUp just now. The rest of this client is unaffected — reopen it to try again.</div></div>';
  if (c.status === 'no_match') return '<h3 class="sec">Tasks · ClickUp</h3><p class="note">No ClickUp "Client Name" option matches this client\'s name, so its tasks can\'t be found. Leads entered only as a deal company have no option.</p>';
  const open = c.tasks.filter((t) => !t.closed);
  const shown = drawer.taskFilter === 'open' ? open : drawer.taskFilter === 'closed' ? c.tasks.filter((t) => t.closed) : c.tasks;
  const byList = {};
  c.tasks.forEach((t) => { byList[t.list || '—'] = (byList[t.list || '—'] || 0) + 1; });
  const sorted = [...shown].sort((a, b) => (a.closed - b.closed) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const rows = sorted.map((t) => `<tr>
      <td>${extLink(t.id, t.name)}${t.isSubtask ? ' <span class="lite">subtask</span>' : ''}</td>
      <td>${esc(t.list || '—')}</td>
      <td><span class="cb-st"><i style="background:${/^#[0-9a-f]{3,8}$/i.test(t.statusColor || '') ? t.statusColor : 'var(--muted)'}"></i>${esc(t.status || '—')}</span></td>
      <td>${t.assignees.length ? esc(t.assignees.join(', ')) : '<span class="note">—</span>'}</td>
      <td class="n"><span class="num"${!t.closed && t.dueDate && t.dueDate.slice(0, 10) < d.asOf ? ' style="color:var(--badtx)"' : ''}>${dateText(t.dueDate)}</span></td>
      <td class="n"><span class="num">${dateText(t.updatedAt)}</span></td></tr>`).join('');
  return `<h3 class="sec">Tasks · ClickUp <span class="srcb">Live</span></h3>
    <div class="cb-controls">
      <div class="seg" role="group" aria-label="Task status">${[['open', `Open ${open.length}`], ['closed', `Closed ${c.tasks.length - open.length}`], ['all', `All ${c.tasks.length}`]]
        .map(([k, l]) => `<button data-cb-tasks="${k}" aria-pressed="${drawer.taskFilter === k}">${l}</button>`).join('')}</div>
      <span class="note">${Object.entries(byList).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${esc(l)} ${n}`).join(' · ')}</span>
    </div>
    ${c.truncated ? '<p class="note">Showing the 300 most recent tasks — open ClickUp for the rest.</p>' : ''}
    ${rows ? `<div class="tw cb-scroll"><table><thead><tr><th>Task</th><th>List</th><th>Status</th><th>Assignees</th><th class="n">Due</th><th class="n">Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="note">No ${drawer.taskFilter === 'all' ? '' : drawer.taskFilter + ' '}tasks.</p>`}
    <p class="note">Matched on ClickUp's "Client Name" option "${esc(c.optionName)}", across every space.</p>`;
}

/* ═════ events (this module's own controls only) ═════ */
let searchTimer;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'cb-search') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setQuery({ search: e.target.value.trim(), page: 1 }), 250);
});
document.addEventListener('change', (e) => {
  const c = e.target.closest('[data-cb]');
  if (!c) return;
  const k = c.dataset.cb;
  if (k === 'company' || k === 'link') setQuery({ [k]: c.value, page: 1 });
  else if (k === 'overdue') setQuery({ overdue: c.checked ? '1' : '0', page: 1 });
  else if (k === 'pageSize') setQuery({ pageSize: Number(c.value), page: 1 });
  else if (k === 'sortkey') {
    const [sort, currency] = c.value.split('|');
    setQuery({ sort, currency, dir: sort === 'name' ? 'asc' : 'desc', page: 1 });
  }
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cb-type]');
  if (t) { setQuery({ type: t.dataset.cbType, page: 1 }); return; }
  const s = e.target.closest('[data-cb-sort]');
  if (s) {
    const sort = s.dataset.cbSort;
    const dir = book.query.sort === sort ? (book.query.dir === 'asc' ? 'desc' : 'asc') : (sort === 'name' ? 'asc' : 'desc');
    setQuery({ sort, dir, page: 1 });
    return;
  }
  const p = e.target.closest('[data-cb-page]');
  if (p && !p.disabled) { setQuery({ page: Number(p.dataset.cbPage) }); return; }
  const c = e.target.closest('[data-cb]');
  if (c && c.dataset.cb === 'dir') { setQuery({ dir: book.query.dir === 'asc' ? 'desc' : 'asc', page: 1 }); return; }
  if (c && c.dataset.cb === 'retry') { loadBook(true); return; }
  const tk = e.target.closest('[data-cb-tasks]');
  if (tk) { drawer.taskFilter = tk.dataset.cbTasks; paintDrawer(); return; }
  const row = e.target.closest('[data-client]');
  if (row && !e.target.closest('a,button')) openClient(row.dataset.client);
});
document.addEventListener('keydown', (e) => {
  const row = e.key === 'Enter' && e.target.closest && e.target.closest('[data-client]');
  if (row) openClient(row.dataset.client);
});
