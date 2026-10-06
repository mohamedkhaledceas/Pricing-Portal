/* Odoo JSON-2 record -> snake_case DB row. Odoo returns many2one fields as
   [id, displayName] and empty values as `false` (not null), so both are
   normalized here and nowhere else. */
const ODOO_INVOICE_FIELDS = [
  'id', 'company_id', 'move_type', 'name', 'commercial_partner_id', 'invoice_date', 'invoice_date_due',
  'state', 'payment_state', 'currency_id', 'amount_untaxed', 'amount_total', 'amount_residual',
  'amount_untaxed_signed', 'amount_total_signed', 'amount_residual_signed', 'invoice_user_id', 'invoice_origin',
  'write_date',
];

const ODOO_PAYMENT_FIELDS = [
  'id', 'company_id', 'partner_id', 'partner_type', 'payment_type', 'date', 'state', 'is_reconciled',
  'currency_id', 'amount', 'amount_company_currency_signed', 'journal_id', 'write_date',
];

const ODOO_PARTNER_FIELDS = ['id', 'name', 'email', 'website', 'vat', 'is_company', 'write_date'];

// account.invoice.report (Invoices Analysis) — one record per invoice line.
const ODOO_INVOICE_REPORT_FIELDS = [
  'id', 'move_id', 'move_type', 'company_id', 'invoice_date', 'partner_id', 'invoice_user_id',
  'product_id', 'product_categ_id', 'price_subtotal',
];

const orNull = (value) => (value === false || value === undefined ? null : value);
const m2oId = (value) => (Array.isArray(value) ? value[0] : null);
const m2oName = (value) => (Array.isArray(value) ? value[1] : null);

// sale.report (Sales Analysis) — one record per sales-order line.
const ODOO_SALE_REPORT_FIELDS = [
  'id', 'name', 'order_reference', 'date', 'state', 'company_id', 'commercial_partner_id', 'user_id', 'product_id',
  'categ_id', 'product_uom_qty', 'price_subtotal', 'untaxed_amount_to_invoice',
];

const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });
// Odoo datetimes are UTC "YYYY-MM-DD HH:MM:SS"; Odoo groups by the user's
// timezone, so an order placed after 22:00 UTC belongs to the next Cairo day.
const cairoDate = (odooDatetime) => (odooDatetime ? CAIRO_DATE.format(new Date(`${odooDatetime.replace(' ', 'T')}Z`)) : null);

/* `own` is the line read with its company alone allowed (own currency),
   `consolidated` the same line read with all companies (Odoo's EGP). */
function toSaleReportRow(own, consolidated, syncedAt) {
  const orderRef = typeof own.order_reference === 'string' ? own.order_reference.split(',') : [];
  return {
    odoo_id: own.id,
    order_id: orderRef[0] === 'sale.order' ? Number(orderRef[1]) : null,
    order_name: orNull(own.name),
    company_id: m2oId(own.company_id),
    order_date: cairoDate(orNull(own.date)),
    state: own.state,
    // The customer company, not the contact person on the order — the same
    // customer the invoices and the client book use.
    partner_id: m2oId(own.commercial_partner_id),
    partner_name: m2oName(own.commercial_partner_id),
    salesperson_name: m2oName(own.user_id),
    product_name: m2oName(own.product_id),
    category_name: m2oName(own.categ_id),
    quantity: own.product_uom_qty || 0,
    subtotal_company: own.price_subtotal || 0,
    to_invoice_company: own.untaxed_amount_to_invoice || 0,
    subtotal_consolidated: consolidated ? consolidated.price_subtotal || 0 : 0,
    to_invoice_consolidated: consolidated ? consolidated.untaxed_amount_to_invoice || 0 : 0,
    synced_at: syncedAt,
  };
}

/* price_subtotal arrives already converted by Odoo into the first allowed
   company's currency (migration 035) — stored as is, labelled with that
   currency (record.currency_id is the invoice's own currency). */
function toInvoiceReportRow(record, syncedAt, consolidatedCurrency) {
  return {
    odoo_id: record.id,
    move_id: m2oId(record.move_id),
    move_name: m2oName(record.move_id),
    move_type: record.move_type,
    company_id: m2oId(record.company_id),
    invoice_date: orNull(record.invoice_date),
    partner_id: m2oId(record.partner_id),
    partner_name: m2oName(record.partner_id),
    salesperson_name: m2oName(record.invoice_user_id),
    product_name: m2oName(record.product_id),
    category_name: m2oName(record.product_categ_id),
    price_subtotal_consolidated: record.price_subtotal || 0,
    consolidated_currency: consolidatedCurrency,
    synced_at: syncedAt,
  };
}

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
    invoice_origin: orNull(record.invoice_origin),
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

/* Client book detail. Amounts are the *_signed company-currency ones
   (credit notes negative), same basis as every other finance figure. */
function toInvoice(row) {
  return {
    odooId: row.odoo_id,
    companyId: row.company_id,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    name: row.name,
    isCreditNote: row.move_type === 'out_refund',
    invoiceDate: row.invoice_date,
    invoiceDateDue: row.invoice_date_due,
    paymentState: row.payment_state,
    untaxed: row.amount_untaxed_signed,
    total: row.amount_total_signed,
    residual: row.amount_residual_signed,
    salespersonName: row.salesperson_name,
  };
}

function toPayment(row) {
  return {
    odooId: row.odoo_id,
    companyId: row.company_id,
    partnerId: row.partner_id,
    date: row.date,
    state: row.state,
    paymentType: row.payment_type,
    amount: row.amount_company_currency_signed,
    journalName: row.journal_name,
  };
}

module.exports = {
  ODOO_INVOICE_FIELDS, ODOO_PAYMENT_FIELDS, ODOO_PARTNER_FIELDS, ODOO_INVOICE_REPORT_FIELDS, ODOO_SALE_REPORT_FIELDS,
  toInvoiceReportRow, toSaleReportRow, toInvoiceRow, toPaymentRow, toPartnerRow, toPartner, toSyncState, toOpenInvoice, toInvoice, toPayment,
};
