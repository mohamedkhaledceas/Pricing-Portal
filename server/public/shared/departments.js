/* Live department list, replacing the old static window.OrgConstants
   .DEPARTMENTS/DEPARTMENT_LABELS arrays — those departments are now a real,
   role-manageable table (see docs/adr/0011) instead of a frozen array, so
   every consumer fetches them once per page load instead of reading a
   static script value.

   load(fetchFn) takes whatever fetch-wrapper the calling page already has
   (apiFetch in the employees module, the pre-auth signup wizard's own
   apiGet) — both are `async (path) => parsedJson`-shaped. list()/labelFor()
   are synchronous reads off the cache, for call sites that only need a
   label lookup after something else already awaited load() earlier in the
   same page's lifecycle. */
(function () {
  let cache = null;
  let inflight = null;

  async function load(fetchFn) {
    if (cache) return cache;
    if (!inflight) {
      inflight = fetchFn('/api/employees/departments')
        .then((res) => {
          cache = res.departments || [];
          return cache;
        })
        .catch((err) => {
          inflight = null;
          throw err;
        });
    }
    return inflight;
  }

  function list() {
    return cache || [];
  }

  function labelFor(code) {
    const found = (cache || []).find((d) => d.code === code);
    return found ? found.label : code;
  }

  // Forces a re-fetch — used after creating/deactivating a department so
  // every dropdown on the page reflects it without a full page reload.
  function refresh(fetchFn) {
    cache = null;
    inflight = null;
    return load(fetchFn);
  }

  window.Departments = { load, list, labelFor, refresh };
})();
