/* Page-scoped mutable state — same pattern as commercial-leads/views/js/state.js
   (one plain state object per page, not shared, per docs/frontend-architecture.md §7). */
export const state = {
  accessToken: null,
  currentUser: null,
  entity: 'ceas',
  shell: null,          // { asOf, asOfLabel, currency, syncStatus }
  snapshotCache: {},    // entityKey -> entity data (fetched lazily, cached per switch)
  briefCache: {},       // entityKey -> AI brief
  doneActions: new Set(),   // entityKey + actionIndex -> marked handled (client-only, not persisted)
};
