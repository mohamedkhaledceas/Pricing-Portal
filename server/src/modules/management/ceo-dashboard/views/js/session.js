/* Auth session only — the access token lives here in memory, never in
   storage (docs/adr/0002). The dashboard's own UI state is `S` in model.js. */
export const session = {
  accessToken: null,
  currentUser: null,
};
