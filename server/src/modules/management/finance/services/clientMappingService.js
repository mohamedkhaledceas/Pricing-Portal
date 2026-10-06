/* Review and fix the mapping between portal clients (the ClickUp-side
   client identity) and Odoo customers (docs/adr/0013 §8, amended
   2026-10-05). Suggestions come from clientMatcher.js; nothing is linked
   without a person confirming it, and every decision is audited.

   Access: ceo, admin, operations (USER_MANAGER_ROLES — user decision
   2026-10-05, the Commercial Lead page's gate, where clients live).
   Checked here as well as by requireRole on the routes. */
const { FinanceError } = require('../errors');
const { USER_MANAGER_ROLES } = require('../../../../common/permissions');
const { ENTITY_COMPANY_IDS } = require('../constants');
const { normalizeName, buildSuggestions } = require('./clientMatcher');

const ENTITY_BY_COMPANY_ID = new Map(Object.entries(ENTITY_COMPANY_IDS).map(([key, id]) => [id, key]));
const STATUS_ORDER = { suggested: 0, unmatched: 1, linked: 2 };

function createClientMappingService({
  clientRepository, partnerRepository, linkRepository, invoiceRepository, transaction, audit,
}) {
  function requireCanManage(actor) {
    if (!actor || !USER_MANAGER_ROLES.includes(actor.role)) {
      throw new FinanceError('You do not have permission to manage client mappings.', 403);
    }
  }

  function requirePositiveInt(value, label) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new FinanceError(`${label} must be a positive integer.`);
    return n;
  }

  function requireActiveClient(clientId) {
    const client = clientRepository.findById(clientId);
    if (!client) throw new FinanceError('Client not found.', 404);
    if (client.status !== 'active') throw new FinanceError('That client is inactive.');
    return client;
  }

  function requirePartner(odooPartnerId) {
    const partner = partnerRepository.findById(odooPartnerId);
    if (!partner) throw new FinanceError('Odoo customer not found in the synced data.', 404);
    return partner;
  }

  /* Unlinked Odoo customers whose name equals exactly one client's name
     (same normalization as the matcher: case, punctuation, legal
     suffixes like LLC/Co.). Never a pair someone already rejected. The
     page shows this list before anything is linked. */
  function findExactPairs(clients, partners, links) {
    const linked = new Set(links.filter((l) => l.status === 'linked').map((l) => l.odooPartnerId));
    const rejected = new Set(links.filter((l) => l.status === 'rejected').map((l) => `${l.clientId}:${l.odooPartnerId}`));
    const clientsByName = new Map();
    for (const c of clients) {
      const key = normalizeName(c.name);
      if (!key) continue;
      clientsByName.set(key, [...(clientsByName.get(key) || []), c]);
    }
    return partners.flatMap((p) => {
      const matches = linked.has(p.odooPartnerId) ? null : clientsByName.get(normalizeName(p.name));
      if (!matches || matches.length !== 1 || rejected.has(`${matches[0].id}:${p.odooPartnerId}`)) return [];
      return [{ odooPartnerId: p.odooPartnerId, partnerName: p.name, clientId: matches[0].id, clientName: matches[0].name }];
    });
  }

  function getOverview(actor) {
    requireCanManage(actor);
    const clients = clientRepository.listActive();
    const clientsById = new Map(clients.map((c) => [c.id, c]));
    const partners = partnerRepository.listAll();
    const links = linkRepository.listAll();
    const linkedByPartner = new Map(links.filter((l) => l.status === 'linked').map((l) => [l.odooPartnerId, l]));
    const rejected = new Set(links.filter((l) => l.status === 'rejected').map((l) => `${l.clientId}:${l.odooPartnerId}`));
    const suggestions = buildSuggestions(partners, clients, rejected);
    const invoiceSummary = new Map(invoiceRepository.summarizeByPartner().map((s) => [s.partnerId, s]));

    const customers = partners.map((partner) => {
      const link = linkedByPartner.get(partner.odooPartnerId);
      const linkedClient = link ? clientsById.get(link.clientId) || { id: link.clientId, name: '(inactive client)' } : null;
      const candidates = link ? [] : suggestions.get(partner.odooPartnerId) || [];
      const summary = invoiceSummary.get(partner.odooPartnerId);
      return {
        ...partner,
        invoiceCount: summary ? summary.invoiceCount : 0,
        lastInvoiceDate: summary ? summary.lastInvoiceDate : null,
        entities: summary
          ? String(summary.companyIds).split(',').map((id) => ENTITY_BY_COMPANY_ID.get(Number(id))).filter(Boolean)
          : [],
        status: link ? 'linked' : candidates.length ? 'suggested' : 'unmatched',
        client: linkedClient ? { id: linkedClient.id, name: linkedClient.name } : null,
        linkedBy: link ? link.decidedBy : null,
        linkedAt: link ? link.decidedAt : null,
        suggestions: candidates,
      };
    }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));

    const linkedClientIds = new Set([...linkedByPartner.values()].map((l) => l.clientId));
    const count = (status) => customers.filter((c) => c.status === status).length;
    return {
      summary: {
        odooCustomers: customers.length,
        linked: count('linked'),
        suggested: count('suggested'),
        unmatched: count('unmatched'),
        clientsWithoutOdoo: clients.filter((c) => !linkedClientIds.has(c.id)).length,
      },
      customers,
      clients: clients.map((c) => ({ id: c.id, name: c.name })),
      exactPairs: findExactPairs(clients, partners, links),
    };
  }

  /* Links every same-name pair in one go — recomputed here, never taken
     from the request, so it links exactly what the page showed (or fewer,
     if something changed meanwhile). One audit entry per pair. */
  function linkExactPairs({ actor, ip }) {
    requireCanManage(actor);
    const pairs = findExactPairs(clientRepository.listActive(), partnerRepository.listAll(), linkRepository.listAll());
    transaction(() => {
      for (const p of pairs) {
        linkRepository.upsert({ clientId: p.clientId, odooPartnerId: p.odooPartnerId, status: 'linked', decidedBy: actor.id });
      }
    });
    for (const p of pairs) {
      audit.record({
        userId: actor.id,
        action: 'client_odoo_link.link',
        entityType: 'client',
        entityId: String(p.clientId),
        details: { clientName: p.clientName, odooPartnerId: p.odooPartnerId, odooPartnerName: p.partnerName, bulkExactName: true },
        ip,
      });
    }
    return { linked: pairs.length };
  }

  function link({ actor, clientId, odooPartnerId, ip }) {
    requireCanManage(actor);
    const cId = requirePositiveInt(clientId, 'clientId');
    const pId = requirePositiveInt(odooPartnerId, 'odooPartnerId');
    const client = requireActiveClient(cId);
    const partner = requirePartner(pId);

    const existing = linkRepository.findLinkedByPartner(pId);
    if (existing && existing.clientId === cId) return { clientId: cId, odooPartnerId: pId, status: 'linked' };
    if (existing) {
      const other = clientRepository.findById(existing.clientId);
      throw new FinanceError(
        `This Odoo customer is already linked to "${other ? other.name : `client ${existing.clientId}`}". Unlink it there first.`,
        409,
      );
    }

    linkRepository.upsert({ clientId: cId, odooPartnerId: pId, status: 'linked', decidedBy: actor.id });
    audit.record({
      userId: actor.id,
      action: 'client_odoo_link.link',
      entityType: 'client',
      entityId: String(cId),
      details: { clientName: client.name, odooPartnerId: pId, odooPartnerName: partner.name },
      ip,
    });
    return { clientId: cId, odooPartnerId: pId, status: 'linked' };
  }

  /* Covers both "this suggestion is wrong" and "unlink this": either way
     the pair is recorded as not-the-same-customer. */
  function reject({ actor, clientId, odooPartnerId, ip }) {
    requireCanManage(actor);
    const cId = requirePositiveInt(clientId, 'clientId');
    const pId = requirePositiveInt(odooPartnerId, 'odooPartnerId');
    const client = clientRepository.findById(cId);
    if (!client) throw new FinanceError('Client not found.', 404);
    const partner = requirePartner(pId);

    const previous = linkRepository.findPair(cId, pId);
    if (previous && previous.status === 'rejected') return { clientId: cId, odooPartnerId: pId, status: 'rejected' };

    linkRepository.upsert({ clientId: cId, odooPartnerId: pId, status: 'rejected', decidedBy: actor.id });
    audit.record({
      userId: actor.id,
      action: previous && previous.status === 'linked' ? 'client_odoo_link.unlink' : 'client_odoo_link.reject',
      entityType: 'client',
      entityId: String(cId),
      details: { clientName: client.name, odooPartnerId: pId, odooPartnerName: partner.name },
      ip,
    });
    return { clientId: cId, odooPartnerId: pId, status: 'rejected' };
  }

  /* For an Odoo customer with no portal client yet (e.g. never went
     through the ClickUp pipeline). Refuses when an active client already
     has the same normalized name — that's a link, not a new client. */
  function createClientFromPartner({ actor, odooPartnerId, ip }) {
    requireCanManage(actor);
    const pId = requirePositiveInt(odooPartnerId, 'odooPartnerId');
    const partner = requirePartner(pId);
    if (linkRepository.findLinkedByPartner(pId)) {
      throw new FinanceError('This Odoo customer is already linked to a client.', 409);
    }
    const key = normalizeName(partner.name);
    const sameName = clientRepository.listActive().find((c) => normalizeName(c.name) === key);
    if (sameName) {
      throw new FinanceError(`A client "${sameName.name}" already matches this name — link it instead.`, 409);
    }

    const client = transaction(() => {
      const created = clientRepository.insert({
        name: partner.name.trim(),
        website: partner.website,
        primaryContactEmail: partner.email,
      });
      linkRepository.upsert({ clientId: created.id, odooPartnerId: pId, status: 'linked', decidedBy: actor.id });
      return created;
    });
    audit.record({
      userId: actor.id,
      action: 'client.create_from_odoo',
      entityType: 'client',
      entityId: String(client.id),
      details: { clientName: client.name, odooPartnerId: pId },
      ip,
    });
    return { client: { id: client.id, name: client.name }, odooPartnerId: pId, status: 'linked' };
  }

  return { getOverview, link, reject, createClientFromPartner, linkExactPairs };
}

module.exports = createClientMappingService;
