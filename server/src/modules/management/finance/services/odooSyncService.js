/* Copies Odoo invoices and payments into the portal's cache tables
   (docs/adr/0013 §2, §5). Read-only against Odoo.

   Two modes per model:
   - incremental: records whose write_date >= the last one seen. `>=`, not
     `>`, because several records can share a write_date second; upserting
     a few twice is harmless, missing one isn't.
   - full: every record in scope, re-upserted, then local rows Odoo no
     longer has are removed (Odoo deletes draft moves outright).

   Each model's rows + its sync-state row are written in one transaction.
   One model failing is recorded on its own sync-state row and doesn't stop
   the other.

   Partners (res.partner) run after invoices, every run, both modes: the
   customers the invoice cache references are re-read by id and the rest
   are dropped. Not filtered by company — most Odoo partners are shared
   across companies (company_id empty) — the id list already comes from
   company-scoped invoices. A few dozen records, so no incremental mode.

   The Invoices Analysis report (account.invoice.report) runs last, every
   run, both modes: read with all three companies allowed and Ceas Comm
   first, so Odoo itself converts every line into EGP (migration 035), and
   the table is replaced whole — the conversion follows Odoo's rates, so an
   unchanged line can still change value. A few hundred lines. */
const {
  ODOO_INVOICE_FIELDS, ODOO_PAYMENT_FIELDS, ODOO_PARTNER_FIELDS, ODOO_INVOICE_REPORT_FIELDS,
  toInvoiceRow, toPaymentRow, toPartnerRow, toInvoiceReportRow,
} = require('../models/odooRecord.model');

const PAGE_SIZE = 500;

function createOdooSyncService({
  odooClient, invoiceRepository, paymentRepository, partnerRepository, invoiceReportRepository, syncStateRepository,
  transaction, logger, companyIds, consolidationCompanyIds, consolidationCurrency,
}) {
  const SPECS = [
    {
      key: 'account.move',
      model: 'account.move',
      domain: [['move_type', 'in', ['out_invoice', 'out_refund']]],
      fields: ODOO_INVOICE_FIELDS,
      toRow: toInvoiceRow,
      repository: invoiceRepository,
    },
    {
      key: 'account.payment',
      model: 'account.payment',
      domain: [],
      fields: ODOO_PAYMENT_FIELDS,
      toRow: toPaymentRow,
      repository: paymentRepository,
    },
  ];

  async function fetchAll(spec, extraDomain) {
    const domain = [...spec.domain, ['company_id', 'in', companyIds], ...extraDomain];
    const records = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      const page = await odooClient.searchRead(spec.model, {
        domain, fields: spec.fields, order: 'write_date asc, id asc', limit: PAGE_SIZE, offset, companyIds,
      });
      records.push(...page);
      if (page.length < PAGE_SIZE) return records;
    }
  }

  async function syncModel(spec, mode) {
    const runAt = new Date().toISOString();
    try {
      const state = syncStateRepository.findByModel(spec.key);
      const since = mode === 'incremental' && state ? state.lastWriteDate : null;
      const records = await fetchAll(spec, since ? [['write_date', '>=', since]] : []);
      const rows = records.map((record) => spec.toRow(record, runAt));

      const rowWithoutCompany = rows.find((row) => !row.company_id);
      if (rowWithoutCompany) {
        throw new Error(`Odoo ${spec.model} record ${rowWithoutCompany.odoo_id} has no company — refusing to cache it.`);
      }

      const lastWriteDate = rows.reduce((max, row) => (row.odoo_write_date > (max || '') ? row.odoo_write_date : max), null);

      let removed = 0;
      transaction(() => {
        spec.repository.upsertMany(rows);
        if (mode === 'full') {
          const remoteIds = new Set(rows.map((row) => row.odoo_id));
          const localIds = spec.repository.listIdsByCompanies(companyIds);
          // An empty Odoo answer while we hold rows is far more likely a
          // permissions/scope problem than every record being deleted —
          // keep the cache rather than wipe it.
          if (remoteIds.size === 0 && localIds.length > 0) {
            logger.warn('Odoo full sync returned no records while the cache has some — skipping removal.', { model: spec.model, cached: localIds.length });
          } else {
            const missing = localIds.filter((id) => !remoteIds.has(id));
            spec.repository.removeByIds(missing);
            removed = missing.length;
          }
        }
        syncStateRepository.recordSuccess(spec.key, { lastWriteDate, recordsSynced: rows.length, runAt });
      });

      return { model: spec.model, mode, status: 'ok', upserted: rows.length, removed };
    } catch (error) {
      syncStateRepository.recordFailure(spec.key, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model: spec.model, mode, message: error.message });
      return { model: spec.model, mode, status: 'error', error: error.message };
    }
  }

  async function syncPartners() {
    const model = 'res.partner';
    const runAt = new Date().toISOString();
    try {
      const ids = invoiceRepository.listPartnerIds();
      const records = [];
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        // eslint-disable-next-line no-await-in-loop
        records.push(...await odooClient.searchRead(model, {
          // Archived customers still own historical invoices.
          domain: [['id', 'in', ids.slice(i, i + PAGE_SIZE)], ['active', 'in', [true, false]]],
          fields: ODOO_PARTNER_FIELDS,
          companyIds,
        }));
      }
      const rows = records.map((record) => toPartnerRow(record, runAt));
      const remoteIds = new Set(rows.map((row) => row.odoo_id));
      let removed = 0;
      transaction(() => {
        partnerRepository.upsertMany(rows);
        // Same guard as syncModel's full mode: never wipe on an empty answer.
        if (remoteIds.size > 0) {
          const missing = partnerRepository.listIds().filter((id) => !remoteIds.has(id));
          partnerRepository.removeByIds(missing);
          removed = missing.length;
        }
        syncStateRepository.recordSuccess(model, { lastWriteDate: null, recordsSynced: rows.length, runAt });
      });
      return { model, mode: 'by-reference', status: 'ok', upserted: rows.length, removed };
    } catch (error) {
      syncStateRepository.recordFailure(model, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model, message: error.message });
      return { model, mode: 'by-reference', status: 'error', error: error.message };
    }
  }

  async function syncInvoiceReport() {
    const model = 'account.invoice.report';
    const runAt = new Date().toISOString();
    try {
      const records = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        // eslint-disable-next-line no-await-in-loop
        const page = await odooClient.searchRead(model, {
          domain: [['state', 'not in', ['draft', 'cancel']], ['move_type', 'in', ['out_invoice', 'out_refund']]],
          fields: ODOO_INVOICE_REPORT_FIELDS,
          order: 'id asc',
          limit: PAGE_SIZE,
          offset,
          companyIds: consolidationCompanyIds,
        });
        records.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      // The line's currency_id is the invoice's own currency, not the one
      // Odoo converted into — that is the first allowed company's (EGP).
      const rows = records.map((record) => toInvoiceReportRow(record, runAt, consolidationCurrency));
      transaction(() => {
        // Same guard as the other syncs: never wipe on an empty answer.
        if (rows.length === 0 && invoiceReportRepository.countAll() > 0) {
          logger.warn('Odoo invoice report returned no lines while the cache has some — keeping the cache.');
        } else {
          invoiceReportRepository.replaceAll(rows);
        }
        syncStateRepository.recordSuccess(model, { lastWriteDate: null, recordsSynced: rows.length, runAt });
      });
      return { model, mode: 'replace', status: 'ok', upserted: rows.length, removed: 0 };
    } catch (error) {
      syncStateRepository.recordFailure(model, { error: error.message, runAt });
      logger.error('Odoo sync failed for model.', { model, message: error.message });
      return { model, mode: 'replace', status: 'error', error: error.message };
    }
  }

  async function run(mode) {
    const results = [];
    for (const spec of SPECS) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await syncModel(spec, mode));
    }
    results.push(await syncPartners());
    results.push(await syncInvoiceReport());
    return results;
  }

  return {
    runIncremental: () => run('incremental'),
    runFull: () => run('full'),
    getSyncState: () => syncStateRepository.listAll(),
  };
}

module.exports = createOdooSyncService;
