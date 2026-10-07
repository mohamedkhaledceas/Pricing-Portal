/* Keeps portal clients in step with ClickUp's "Client Name" dropdown
   (migration 034). Read-only against ClickUp (one GET of the field).

   For each dropdown option:
   - already a client (same option id) → rename / re-flag / reactivate
     in place if ClickUp changed it;
   - else an imported row (source 'deal_import', no option yet) with exactly
     the same name → that row becomes this client (keeps its id, deals and
     Odoo links);
   - else → a new client (source 'clickup').
   Then:
   - a client whose option is gone from ClickUp → inactive (never deleted);
   - imported rows that matched no option → kind 'lead' (hidden, kept);
   - unlinked deals → linked to the client their own "Client Name" names
     (commercial-leads' linkDealsByClientName).

   Everything is written in one transaction. dryRun computes the same plan
   and writes nothing — plus the imported rows that only loosely resemble a
   dropdown name, for a person to review (never applied automatically).

   Triggers (all share one in-flight guard + throttle): every 30 minutes,
   at startup, and when the client book / client-mapping page loads. */
const {
  CLIENT_NAME_FIELD_ID, FIELD_SOURCE_LIST_ID, INTERNAL_CLIENT_NAMES, SYNC_THROTTLE_MS, normalizeClientName,
} = require('../constants');

const INTERNAL = new Set(INTERNAL_CLIENT_NAMES.map(normalizeClientName));
// Punctuation-, "co"/"group"/"llc"-insensitive — only ever a suggestion.
const looseName = (name) => normalizeClientName(name)
  .replace(/\b(co|company|group|llc|l\.l\.c|ltd|inc|fze|for trade|trading)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

function planChanges(options, rows) {
  const byOption = new Map(rows.filter((r) => r.clickupOptionId).map((r) => [r.clickupOptionId, r]));
  const importedByName = new Map();
  for (const r of rows.filter((x) => !x.clickupOptionId && x.source === 'deal_import')) {
    const key = normalizeClientName(r.name);
    importedByName.set(key, importedByName.has(key) ? null : r); // null = ambiguous, never attached
  }

  const plan = { create: [], attach: [], update: [], deactivate: [], leads: [], looseCandidates: [] };
  const attachedIds = new Set();
  const seen = new Set();
  for (const o of options) {
    seen.add(o.id);
    const isInternal = INTERNAL.has(normalizeClientName(o.name));
    const existing = byOption.get(o.id);
    if (existing) {
      const changed = existing.name !== o.name || existing.isInternal !== isInternal || existing.status !== 'active';
      if (changed) plan.update.push({ id: existing.id, from: existing.name, name: o.name, isInternal, status: 'active' });
      continue;
    }
    const imported = importedByName.get(normalizeClientName(o.name));
    if (imported && !attachedIds.has(imported.id)) {
      attachedIds.add(imported.id);
      plan.attach.push({ id: imported.id, name: o.name, clickupOptionId: o.id, isInternal });
    } else {
      plan.create.push({ name: o.name, clickupOptionId: o.id, isInternal });
    }
  }

  for (const r of rows) {
    if (r.clickupOptionId && !seen.has(r.clickupOptionId) && r.status === 'active') {
      plan.deactivate.push({ id: r.id, name: r.name });
    }
  }

  const looseOptions = new Map(options.map((o) => [looseName(o.name), o.name]));
  for (const r of rows) {
    if (r.clickupOptionId || r.source !== 'deal_import' || attachedIds.has(r.id)) continue;
    if (r.kind !== 'lead') plan.leads.push({ id: r.id, name: r.name });
    const match = looseOptions.get(looseName(r.name));
    if (match) plan.looseCandidates.push({ id: r.id, name: r.name, clickupName: match });
  }
  return plan;
}

function createClickupClientSyncService({
  clickupGet, clientRepository, syncStateRepository, linkDealsByClientName, transaction, audit, logger,
  now = () => Date.now(),
}) {
  let inFlight = null;
  let lastRunAt = 0;

  async function fetchOptions() {
    const { fields } = await clickupGet(`/list/${FIELD_SOURCE_LIST_ID}/field`);
    const field = (fields || []).find((f) => f.id === CLIENT_NAME_FIELD_ID);
    if (!field) throw new Error('ClickUp "Client Name" field not found on the pipeline list.');
    const options = (field.type_config && field.type_config.options) || [];
    // A broken or empty response must never deactivate every client.
    if (!options.length) throw new Error('ClickUp returned no "Client Name" options — refusing to sync.');
    return options.map((o) => ({ id: o.id, name: String(o.name).trim() }));
  }

  function apply(plan) {
    for (const c of plan.create) clientRepository.insertFromClickup(c);
    for (const a of plan.attach) clientRepository.attachOption(a.id, a);
    for (const u of plan.update) clientRepository.updateFromClickup(u.id, u);
    for (const d of plan.deactivate) clientRepository.setStatus(d.id, 'inactive');
    for (const l of plan.leads) clientRepository.markLead(l.id);
    const clientIdByName = new Map(clientRepository.listAllForSync()
      .filter((r) => r.clickupOptionId && r.kind === 'client' && !r.isInternal)
      .map((r) => [normalizeClientName(r.name), r.id]));
    return linkDealsByClientName(clientIdByName);
  }

  const summarize = (plan, dealsLinked) => ({
    created: plan.create.length,
    attached: plan.attach.length,
    updated: plan.update.length,
    deactivated: plan.deactivate.length,
    markedLeads: plan.leads.length,
    dealsLinked,
  });

  async function run(trigger) {
    lastRunAt = now();
    const at = new Date(lastRunAt).toISOString();
    try {
      const options = await fetchOptions();
      const plan = planChanges(options, clientRepository.listAllForSync());
      const dealsLinked = transaction(() => apply(plan));
      const summary = summarize(plan, dealsLinked);
      syncStateRepository.recordResult({ status: 'ok', trigger, at });
      const changed = Object.values(summary).some((n) => n > 0);
      if (changed) {
        logger.info('ClickUp client sync applied changes.', { trigger, ...summary });
        audit.record({
          action: 'clients.clickup_sync',
          entityType: 'clients',
          details: {
            trigger,
            ...summary,
            created: plan.create.map((c) => c.name),
            renamed: plan.update.filter((u) => u.from !== u.name).map((u) => ({ from: u.from, to: u.name })),
            deactivated: plan.deactivate.map((d) => d.name),
          },
        });
      }
      return { status: 'ok', changed, summary, state: syncStateRepository.get() };
    } catch (error) {
      logger.error('ClickUp client sync failed — keeping the last known clients.', { trigger, message: error.message });
      syncStateRepository.recordResult({ status: 'error', trigger, error: error.message, at });
      return { status: 'error', changed: false, summary: null, state: syncStateRepository.get() };
    }
  }

  /* Joins a run already in flight; otherwise at most one run per throttle
     window (force skips the throttle — startup and the 30-minute job). */
  function sync({ trigger, force = false }) {
    if (inFlight) return inFlight;
    if (!force && now() - lastRunAt < SYNC_THROTTLE_MS) {
      return Promise.resolve({ status: 'throttled', changed: false, summary: null, state: syncStateRepository.get() });
    }
    inFlight = run(trigger).finally(() => { inFlight = null; });
    return inFlight;
  }

  /* What a sync would do right now — nothing is written. */
  async function preview() {
    const options = await fetchOptions();
    const rows = clientRepository.listAllForSync();
    return { options: options.length, clients: rows.length, plan: planChanges(options, rows) };
  }

  return { sync, preview, getState: () => syncStateRepository.get() };
}

module.exports = createClickupClientSyncService;
