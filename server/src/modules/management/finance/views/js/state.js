/* Page-scoped state — one plain object, per docs/frontend-architecture.md §7. */
export const state = {
  accessToken: null,
  currentUser: null,
  data: null,             // GET /api/finance/client-mapping -> clientMapping
  status: 'suggested',    // suggested | unmatched | linked | all
  search: '',
  expanded: new Set(),    // odooPartnerIds showing the manual picker under their suggestions
  confirmingUnlink: null, // odooPartnerId awaiting inline unlink confirmation
  busy: false,
  bulkOpen: false,        // same-name pairs panel expanded for confirmation
  clickupSync: null,      // { status, checking, state } from POST /api/clients/clickup-sync
};
