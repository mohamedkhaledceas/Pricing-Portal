/* Page-scoped mutable state, shared across this page's feature modules by
   import — an exported object whose properties get mutated (`state.x = y`),
   not a bare `let` reassigned, since ES module bindings can't be reassigned
   from an importing module. Matches docs/frontend-architecture.md §7: one
   plain state object per page. Not shared with any other page — if the
   Employees module later needs the same apiFetch/theme/dom helpers this
   page's js/ files provide, that's when promoting the truly-generic parts
   into a shared common/views/ location is justified by a second real
   consumer, not before. */
export const state = {
  accessToken: null,
  currentUser: null,
  dealsCache: { pipeline: [], activeClients: [], offboarding: [] },
  statusColors: { pipeline: {}, activeClients: {}, offboarding: {} },
  filters: { status: '', country: '', source: '', search: '' },
  sortMode: 'edited-desc',
  quarterlyState: null,
  pipelinePage: 1,
  pipelinePageSize: 25,
  activeClientsPage: 1,
  activeClientsPageSize: 25,
};
