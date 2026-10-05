/* Portal entity key -> Odoo company (docs/adr/0013 §6). A constant, not a
   table: it changes about once a year and any change needs code review
   anyway. Et3alemha (Odoo company id 3) is to be implemented — it joins
   this map once the integration account is granted access to it in Odoo;
   until then every request naming it fails with an Odoo AccessError.
   `currency` is the Odoo company's own currency — every *_signed amount
   for that company is already in it. */
const ENTITIES = Object.freeze({
  ceas: Object.freeze({ companyId: 1, currency: 'EGP' }), // Ceas Comm
  fze: Object.freeze({ companyId: 2, currency: 'AED' }), // Ceas Comm FZE
  lwm: Object.freeze({ companyId: 2268, currency: 'EGP' }), // Learn With Marie
});

const ENTITY_COMPANY_IDS = Object.freeze(
  Object.fromEntries(Object.entries(ENTITIES).map(([key, entity]) => [key, entity.companyId])),
);

const SYNCED_COMPANY_IDS = Object.freeze(Object.values(ENTITY_COMPANY_IDS));

/* Odoo 19 payment states that count as cash collected. `in_process` (posted
   but not yet matched to a bank statement line) is deliberately excluded —
   user decision 2026-10-05: unreconciled to the bank is not collected. */
const COLLECTED_PAYMENT_STATES = Object.freeze(['paid']);

/* Thresholds carried over from the original prototype (ADR-0013, "Rules
   carried over"). Configuration, not render code. */
const FINANCE_THRESHOLDS = Object.freeze({
  concentrationPct: 25,
  dsoTargetDays: 55,
  collectionRateTargetPct: 85,
  agedRiskDays: 90,
  agedWatchDays: 60,
});

module.exports = {
  ENTITIES, ENTITY_COMPANY_IDS, SYNCED_COMPANY_IDS, COLLECTED_PAYMENT_STATES, FINANCE_THRESHOLDS,
};
