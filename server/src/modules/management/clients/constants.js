/* ClickUp's workspace-wide "Client Name" dropdown — the source of truth
   for who a client is (migration 034). Verified 2026-10-05: the same field
   id on the Commercial Lead pipeline, every Kitchen delivery list and
   Client Master. Any list carrying the field can describe its options;
   this is the 2026 Projects pipeline. */
const CLIENT_NAME_FIELD_ID = '691263ea-3099-4f0c-b87f-950278899219';
const FIELD_SOURCE_LIST_ID = '901518274897';

/* CEAS's own companies in that dropdown (user, 2026-10-06: Ceas Comm, Ceas
   Comm FZE, Ceas Figures, Learn with Marie are the companies a client is
   serviced from, never clients) — kept as rows, never shown as clients.
   Matched case- and space-insensitively. */
const INTERNAL_CLIENT_NAMES = Object.freeze(['Ceas Comm', 'Ceas Comm FZE', 'Ceas Figures', 'Learn with Marie']);

/* The dropdown is re-read every 30 minutes, at startup, and when the
   client book or client-mapping page loads; all of those share one
   throttle so ClickUp is called at most once a minute. */
const SYNC_INTERVAL_MINUTES = 30;
const SYNC_THROTTLE_MS = 60 * 1000;

const normalizeClientName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = {
  CLIENT_NAME_FIELD_ID,
  FIELD_SOURCE_LIST_ID,
  INTERNAL_CLIENT_NAMES,
  SYNC_INTERVAL_MINUTES,
  SYNC_THROTTLE_MS,
  normalizeClientName,
};
