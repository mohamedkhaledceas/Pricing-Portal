/* Page-scoped mutable state — see docs/frontend-architecture.md §7. Not
   shared with the Commercial Lead page's own state.js; promote the truly
   generic parts to a shared location only when a third consumer justifies
   it, per that page's own state.js comment. */
export const state = {
  accessToken: null,
  currentUser: null,
  myEmployee: null,
  mainTab: 'overview',
  subTab: 'new-request',
};
