/* The Odoo side of the CEO Control Room's client book — finance's public
   read interface for it (the ceo-dashboard calls this, never the
   repositories).

   A "customer" is a portal client (key `client:<id>`, with every Odoo
   customer linked to it on the client-mapping page) or an Odoo customer
   nobody has linked yet (key `partner:<odooId>`). Portal clients are the
   ClickUp "Client Name" dropdown (migration 034) plus clients created
   from Odoo; every one is listed even with no invoices. An Odoo customer
   linked to a row that isn't a client (an old lead row) is shown as its
   own customer rather than dropped.

   Figures are per Odoo company, in that company's own currency (EGP for
   Ceas Comm and Learn with Marie, AED for FZE) — never added across
   currencies until live FX exists (ADR-0013 step 3c). Posted invoices
   only; *_signed amounts, so credit notes net out. Links are read on
   every call, so a mapping change shows immediately. */
const { ValidationError } = require('../../../../common/errors');
const { FinanceError } = require('../errors');
const { ENTITIES } = require('../constants');

const KEY_PATTERN = /^(client|partner):([1-9]\d{0,9})$/;

const COMPANIES = new Map(Object.entries(ENTITIES).map(([key, e]) => [e.companyId, { key, currency: e.currency }]));

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

const round = (value) => Math.round(value || 0);

function createCustomerLedgerService({
  invoiceRepository, paymentRepository, partnerRepository, clientRepository, linkRepository, today = cairoToday,
}) {
  function parseKey(key) {
    const match = KEY_PATTERN.exec(String(key || ''));
    if (!match) throw new ValidationError('Customer key must look like client:<id> or partner:<id>.');
    return { kind: match[1], id: Number(match[2]) };
  }

  /* Every customer with its per-company Odoo figures. */
  function getLedger() {
    const asOf = today();
    const clientByPartner = new Map(linkRepository.listLinkedWithClientNames().map((l) => [l.odooPartnerId, l.clientId]));
    const entries = new Map();

    for (const client of clientRepository.listAllProfiles()) {
      entries.set(`client:${client.id}`, {
        key: `client:${client.id}`, clientId: client.id, client, name: client.name, partnerIds: [], companies: {},
      });
    }

    for (const row of invoiceRepository.summarizeByPartnerAndCompany(`${asOf.slice(0, 4)}-01-01`, asOf)) {
      const company = COMPANIES.get(row.companyId);
      if (!company) continue;
      const clientId = clientByPartner.get(row.partnerId);
      const clientKey = clientId ? `client:${clientId}` : null;
      const key = clientKey && entries.has(clientKey) ? clientKey : `partner:${row.partnerId}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { key, clientId: null, client: null, name: row.partnerName, partnerIds: [], companies: {} };
        entries.set(key, entry);
      }
      if (!entry.partnerIds.includes(row.partnerId)) entry.partnerIds.push(row.partnerId);

      const c = entry.companies[company.key] || {
        currency: company.currency, invoicedYtd: 0, invoicedTotal: 0, open: 0, overdue: 0,
        invoiceCount: 0, lastInvoiceDate: null, salesperson: null,
      };
      c.invoicedYtd += row.invoicedYtd;
      c.invoicedTotal += row.invoicedTotal;
      c.open += row.openAmount;
      c.overdue += row.overdueAmount;
      c.invoiceCount += row.invoiceCount;
      if (!c.lastInvoiceDate || row.lastInvoiceDate > c.lastInvoiceDate) {
        c.lastInvoiceDate = row.lastInvoiceDate;
        c.salesperson = row.salespersonName;
      }
      entry.companies[company.key] = c;
    }

    for (const entry of entries.values()) {
      for (const c of Object.values(entry.companies)) {
        c.invoicedYtd = round(c.invoicedYtd);
        c.invoicedTotal = round(c.invoicedTotal);
        c.open = round(c.open);
        c.overdue = round(c.overdue);
      }
    }
    return { asOf, entries: [...entries.values()] };
  }

  /* One customer's Odoo record: the Odoo customers behind it, every posted
     invoice and credit note, and its payments. */
  function getCustomerDetail(key) {
    const { kind, id } = parseKey(key);
    let client = null;
    let partnerIds;
    if (kind === 'client') {
      client = clientRepository.findProfileById(id);
      if (!client) throw new FinanceError('Client not found.', 404);
      partnerIds = linkRepository.listLinkedWithClientNames().filter((l) => l.clientId === id).map((l) => l.odooPartnerId);
    } else {
      partnerIds = [id];
    }

    const withCompany = (row) => {
      const company = COMPANIES.get(row.companyId);
      return company ? { ...row, company: company.key, currency: company.currency } : null;
    };
    const invoices = invoiceRepository.listPostedByPartners(partnerIds).map(withCompany).filter(Boolean);
    const partners = partnerRepository.findByIds(partnerIds);
    if (kind === 'partner' && !partners.length && !invoices.length) throw new FinanceError('Odoo customer not found.', 404);

    return {
      asOf: today(),
      client,
      partners,
      invoices,
      payments: paymentRepository.listCustomerByPartners(partnerIds).map(withCompany).filter(Boolean),
    };
  }

  return { getLedger, getCustomerDetail, parseKey };
}

module.exports = createCustomerLedgerService;
