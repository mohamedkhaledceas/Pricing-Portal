/* commercial_lead_deal_records — the durable counterpart to
   commercial_lead_live_cache (see migration 027's comment for the full
   reasoning). Only SQL here, matching dealRepository.js's convention.

   Deliberately no remove()/delete function exported anywhere in this file.
   That's not an oversight — the entire point of this table is that nothing
   in the sync pipeline (webhook handler, reconciliation) ever deletes from
   it, unlike the live cache. If a real, considered reason to delete a row
   here ever comes up, that's a new function someone adds on purpose, not
   something that falls out of copying dealRepository.js's shape. */
const db = require('../../../../db');

function upsert({ dealId, listId, name, status, salesPerson, accountManager, value, currency, clickupCreatedAt, clickupUpdatedAt }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO commercial_lead_deal_records
      (deal_id, list_id, name, status, sales_person, account_manager, value, currency, clickup_created_at, clickup_updated_at, created_at, updated_at)
    VALUES
      (@deal_id, @list_id, @name, @status, @sales_person, @account_manager, @value, @currency, @clickup_created_at, @clickup_updated_at, @now, @now)
    ON CONFLICT(deal_id) DO UPDATE SET
      list_id = excluded.list_id,
      name = excluded.name,
      status = excluded.status,
      sales_person = excluded.sales_person,
      account_manager = excluded.account_manager,
      value = excluded.value,
      currency = excluded.currency,
      clickup_created_at = excluded.clickup_created_at,
      clickup_updated_at = excluded.clickup_updated_at,
      updated_at = excluded.updated_at
  `).run({
    deal_id: dealId,
    list_id: listId,
    name,
    status,
    sales_person: salesPerson || null,
    account_manager: accountManager || null,
    value: value ?? null,
    currency: currency || null,
    clickup_created_at: clickupCreatedAt || null,
    clickup_updated_at: clickupUpdatedAt || null,
    now,
  });
}

function findByDealId(dealId) {
  return db.prepare('SELECT * FROM commercial_lead_deal_records WHERE deal_id = ?').get(dealId);
}

function findByClientId(clientId) {
  return db.prepare('SELECT * FROM commercial_lead_deal_records WHERE client_id = ? ORDER BY updated_at DESC').all(clientId);
}

function setClientId(dealId, clientId) {
  db.prepare('UPDATE commercial_lead_deal_records SET client_id = ?, updated_at = ? WHERE deal_id = ?').run(clientId, new Date().toISOString(), dealId);
}

module.exports = { upsert, findByDealId, findByClientId, setClientId };
