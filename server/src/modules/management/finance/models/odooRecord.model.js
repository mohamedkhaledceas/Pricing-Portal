/* Odoo JSON-2 record -> snake_case DB row. Odoo returns many2one fields as
   [id, displayName] and empty values as `false` (not null), so both are
   normalized here and nowhere else. */
const ODOO_INVOICE_FIELDS = [
  'id', 'company_id', 'move_type', 'name', 'commercial_partner_id', 'invoice_date', 'invoice_date_due',
  'state', 'payment_state', 'currency_id', 'amount_untaxed', 'amount_total', 'amount_residual',
  'amount_untaxed_signed', 'amount_total_signed', 'amount_residual_signed', 'invoice_user_id', 'write_date',
];

const ODOO_PAYMENT_FIELDS = [
  'id', 'company_id', 'partner_id', 'partner_type', 'payment_type', 'date', 'state', 'is_reconciled',
  'currency_id', 'amount', 'amount_company_currency_signed', 'journal_id', 'write_date',
];

const ODOO_PARTNER_FIELDS = ['id', 'name', 'email', 'website', 'vat', 'is_company', 'write_date'];

const orNull = (value) => (value === false || value === undefined ? null : value);
const m2oId = (value) => (Array.isArray(value) ? value[0] : null);
const m2oName = (value) => (Array.isArray(value) ? value[1] : null);

function toInvoiceRow(record, syncedAt) {
  return {
    odoo_id: record.id,
    company_id: m2oId(record.company_id),
    move_type: record.move_type,
    name: orNull(record.name),
    partner_id: m2oId(record.commercial_partner_id),
    partner_name: m2oName(record.commercial_partner_id),
    invoice_date: orNull(record.invoice_date),
    invoice_date_due: orNull(record.invoice_date_due),
    state: record.state,
    payment_state: orNull(record.payment_state),
    currency: m2oName(record.currency_id),
    amount_untaxed: record.amount_untaxed || 0,
    amount_total: record.amount_total || 0,
    amount_residual: record.amount_residual || 0,
    amount_untaxed_signed: record.amount_untaxed_signed || 0,
    amount_total_signed: record.amount_total_signed || 0,
    amount_residual_signed: record.amount_residual_signed || 0,
    salesperson_name: m2oName(record.invoice_user_id),
    odoo_write_date: record.write_date,
    synced_at: syncedAt,
  };
}

function toPaymentRow(record, syncedAt) {
  return {
    odoo_id: record.id,
    company_id: m2oId(record.company_id),
    partner_id: m2oId(record.partner_id),
    partner_name: m2oName(record.partner_id),
    partner_type: orNull(record.partner_type),
    payment_type: record.payment_type,
    date: orNull(record.date),
    state: record.state,
    is_reconciled: record.is_reconciled ? 1 : 0,
    currency: m2oName(record.currency_id),
    amount: record.amount || 0,
    amount_company_currency_signed: record.amount_company_currency_signed || 0,
    journal_name: m2oName(record.journal_id),
    odoo_write_date: record.write_date,
    synced_at: syncedAt,
  };
}

function toPartnerRow(record, syncedAt) {
  return {
    odoo_id: record.id,
    name: orNull(record.name) || `Odoo partner ${record.id}`,
    email: orNull(record.email),
    website: orNull(record.website),
    vat: orNull(record.vat),
    is_company: record.is_company ? 1 : 0,
    odoo_write_date: record.write_date,
    synced_at: syncedAt,
  };
}

function toPartner(row) {
  return {
    odooPartnerId: row.odoo_id,
    name: row.name,
    email: row.email,
    website: row.website,
    vat: row.vat,
    isCompany: Boolean(row.is_company),
  };
}

function toSyncState(row) {
  return {
    model: row.model,
    lastWriteDate: row.last_write_date,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    recordsSynced: row.records_synced,
  };
}

function toOpenInvoice(row) {
  return {
    odooId: row.odoo_id,
    name: row.name,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    invoiceDate: row.invoice_date,
    invoiceDateDue: row.invoice_date_due,
    residual: row.amount_residual_signed,
    salespersonName: row.salesperson_name,
  };
}

module.exports = {
  ODOO_INVOICE_FIELDS, ODOO_PAYMENT_FIELDS, ODOO_PARTNER_FIELDS,
  toInvoiceRow, toPaymentRow, toPartnerRow, toPartner, toSyncState, toOpenInvoice,
};
