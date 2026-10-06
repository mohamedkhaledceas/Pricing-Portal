/* The Control Room's cross-company client book: every portal client and
   every Odoo customer nobody has linked to one yet, across Ceas Comm, FZE
   and Learn with Marie, with filters, sorting and paging done here.

   Sources, each through its owner's public interface:
   - finance customerLedgerService — Odoo invoicing per company + detail.
   - commercial-leads getClientDeals / getDealsForClient — ClickUp deals.
   - clientTasksService — the client's ClickUp tasks, live, detail only.

   Type (user-facing filter, default "client"):
   - client:   invoiced in Odoo, or has a deal that's onboarding, in
               progress, won or "complete", or is on the Active Clients list.
   - lost:     never invoiced and every deal it has is lost.
   - prospect: everything else (open leads, qualified, no deal yet).

   Money stays per currency (EGP / AED) — no conversion until live FX
   (ADR-0013 step 3c), so a money sort is always within one currency. */
const { ValidationError } = require('../../../../common/errors');

const COMPANY_KEYS = ['ceas', 'fze', 'lwm'];
const TYPES = ['client', 'prospect', 'lost', 'all'];
const LINK_FILTERS = ['all', 'linked', 'unlinked', 'odoo_only'];
const SORTS = ['name', 'invoiced', 'open', 'overdue', 'last_invoice', 'deals'];
const MONEY_SORTS = { invoiced: 'invoicedYtd', open: 'open', overdue: 'overdue' };
const CURRENCIES = ['EGP', 'AED'];
const PAGE_SIZES = [10, 25, 50, 100];
const CLIENT_BUCKETS = new Set(['onboarding', 'in_progress', 'won']);

function classify(entry, deals) {
  const invoiced = Object.values(entry.companies).some((c) => c.invoiceCount > 0);
  const isClient = invoiced || deals.some((d) => CLIENT_BUCKETS.has(d.bucket) || d.status === 'complete' || d.list === 'activeClients');
  if (isClient) return 'client';
  if (deals.length && deals.every((d) => d.bucket === 'lost')) return 'lost';
  return 'prospect';
}

function moneyByCurrency(companies) {
  const money = {};
  for (const c of Object.values(companies)) {
    const m = money[c.currency] || { invoicedYtd: 0, invoicedTotal: 0, open: 0, overdue: 0 };
    m.invoicedYtd += c.invoicedYtd;
    m.invoicedTotal += c.invoicedTotal;
    m.open += c.open;
    m.overdue += c.overdue;
    money[c.currency] = m;
  }
  return money;
}

function toRow(entry, deals) {
  const companies = Object.keys(entry.companies);
  const latest = Object.values(entry.companies)
    .reduce((best, c) => (!best || (c.lastInvoiceDate || '') > (best.lastInvoiceDate || '') ? c : best), null);
  const latestDeal = deals[0] || null; // repository orders by most recently updated
  return {
    key: entry.key,
    name: entry.name,
    type: classify(entry, deals),
    status: entry.client ? entry.client.status : null,
    source: !entry.client ? 'odoo_only' : entry.partnerIds.length ? 'linked' : 'unlinked',
    companies,
    accountManager: (entry.client && entry.client.accountManager)
      || (latestDeal && latestDeal.accountManager) || (latest && latest.salesperson) || null,
    money: moneyByCurrency(entry.companies),
    lastInvoiceDate: latest ? latest.lastInvoiceDate : null,
    invoiceCount: Object.values(entry.companies).reduce((n, c) => n + c.invoiceCount, 0),
    deals: deals.length,
    latestDeal: latestDeal ? { name: latestDeal.name, status: latestDeal.status, list: latestDeal.listName } : null,
  };
}

function pick(value, allowed, fallback, label) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(value)) throw new ValidationError(`"${label}" must be one of: ${allowed.join(', ')}.`);
  return value;
}

function parseQuery(q) {
  const search = String(q.search || '').trim();
  if (search.length > 100) throw new ValidationError('"search" must be 100 characters or fewer.');
  const page = q.page === undefined || q.page === '' ? 1 : Number(q.page);
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ValidationError('"page" must be a whole number from 1.');
  const pageSize = q.pageSize === undefined || q.pageSize === '' ? 10 : Number(q.pageSize);
  if (!PAGE_SIZES.includes(pageSize)) throw new ValidationError(`"pageSize" must be one of: ${PAGE_SIZES.join(', ')}.`);
  return {
    search: search.toLowerCase(),
    company: pick(q.company, COMPANY_KEYS, null, 'company'),
    type: pick(q.type, TYPES, 'client', 'type'),
    link: pick(q.link, LINK_FILTERS, 'all', 'link'),
    overdueOnly: pick(q.overdue, ['1', '0'], '0', 'overdue') === '1',
    sort: pick(q.sort, SORTS, 'invoiced', 'sort'),
    currency: pick(q.currency, CURRENCIES, 'EGP', 'currency'),
    dir: pick(q.dir, ['asc', 'desc'], q.sort === 'name' ? 'asc' : 'desc', 'dir'),
    page,
    pageSize,
  };
}

function compareRows(sort, currency, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r) => {
    if (sort === 'name') return r.name.toLowerCase();
    if (sort === 'last_invoice') return r.lastInvoiceDate;
    if (sort === 'deals') return r.deals;
    const m = r.money[currency];
    return m ? m[MONEY_SORTS[sort]] : null;
  };
  return (a, b) => {
    const x = value(a);
    const y = value(b);
    // Rows with nothing to sort on (no invoices in that currency) go last
    // in either direction.
    if (x == null || y == null) return (x == null) - (y == null) || a.name.localeCompare(b.name);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c * sign || a.name.localeCompare(b.name);
  };
}

function createClientBookService({ customerLedgerService, getClientDeals, getDealsForClient, clientTasksService, logger }) {
  function buildRows() {
    const { asOf, entries } = customerLedgerService.getLedger();
    const dealsByClient = new Map();
    for (const d of getClientDeals()) {
      if (!dealsByClient.has(d.clientId)) dealsByClient.set(d.clientId, []);
      dealsByClient.get(d.clientId).push(d);
    }
    const rows = entries.map((e) => toRow(e, (e.clientId && dealsByClient.get(e.clientId)) || []));
    return { asOf, entries, rows };
  }

  function listClients(query) {
    const q = parseQuery(query || {});
    const { asOf, rows } = buildRows();

    // Type counts reflect every other filter, so the type tabs show what
    // each would return.
    const base = rows.filter((r) => (!q.search || r.name.toLowerCase().includes(q.search))
      && (!q.company || r.companies.includes(q.company))
      && (q.link === 'all' || r.source === q.link)
      && (!q.overdueOnly || Object.values(r.money).some((m) => m.overdue > 0)));
    const counts = { all: base.length, client: 0, prospect: 0, lost: 0 };
    base.forEach((r) => { counts[r.type] += 1; });

    const filtered = base.filter((r) => q.type === 'all' || r.type === q.type).sort(compareRows(q.sort, q.currency, q.dir));
    const pages = Math.max(1, Math.ceil(filtered.length / q.pageSize));
    const page = Math.min(q.page, pages);
    return {
      asOf,
      query: { ...q, page },
      total: filtered.length,
      pages,
      counts,
      rows: filtered.slice((page - 1) * q.pageSize, page * q.pageSize),
    };
  }

  /* One client: profile, per-company Odoo summary, invoices, payments,
     deals, and its ClickUp tasks. A ClickUp failure doesn't fail the
     drawer — the tasks block reports it instead. */
  async function getClientDetail(key) {
    const odoo = customerLedgerService.getCustomerDetail(key); // validates the key, 404s
    const { rows, entries } = buildRows();
    const row = rows.find((r) => r.key === key);
    const entry = entries.find((e) => e.key === key);
    const deals = odoo.client ? getDealsForClient(odoo.client.id) : [];

    // Tasks come from the client's stored ClickUp "Client Name" option id;
    // an Odoo-only customer, or a client created from Odoo, has none.
    let clickup;
    const optionId = odoo.client && odoo.client.clickupOptionId;
    try {
      clickup = optionId
        ? { ...(await clientTasksService.getTasksForOption(optionId)), optionName: odoo.client.name }
        : { status: 'no_match', optionName: null, tasks: [], truncated: false };
    } catch (error) {
      logger.error('Client book: ClickUp task fetch failed', { key, error: error.message });
      clickup = { status: 'error', optionName: null, tasks: [], truncated: false };
    }

    return {
      asOf: odoo.asOf,
      row,
      client: odoo.client,
      companies: entry ? entry.companies : {},
      partners: odoo.partners,
      invoices: odoo.invoices,
      payments: odoo.payments,
      deals,
      clickup,
    };
  }

  return { listClients, getClientDetail };
}

module.exports = createClientBookService;
