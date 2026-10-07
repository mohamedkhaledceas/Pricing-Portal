import { apiFetch } from './apiClient.js';
import { D, setData } from './data.js';
import { S } from './model.js';

/* One payload per entity (the Odoo figures are per company), fetched on
   first view and cached for the page's lifetime. */
const cache = new Map();

/* Operations / P&C: the Budget tab's data only, from its own endpoint. */
export async function loadBudget() {
  const { controlRoom } = await apiFetch('/api/ceo-dashboard/budget');
  setData(controlRoom);
  S.year = D.currentYear || String(D.asOf || new Date().toISOString()).slice(0, 4);
}

export async function loadEntity(key) {
  let data = cache.get(key);
  if (!data) {
    ({ controlRoom: data } = await apiFetch('/api/ceo-dashboard/control-room?entity=' + encodeURIComponent(key)));
    cache.set(key, data);
  }
  // Targets and added KPIs come with each view's payload (saved per view);
  // escalation preferences are company-wide and saved on the server.
  setData(data);
  // Each company has its own years (books started at different dates):
  // fall back to the live year when the selected one isn't in this view.
  if (!D.years[S.year]) S.year = D.currentYear;
  if (S.cmp && !D.years[S.cmp]) S.cmp = '';
  // Only on first load: after that the page's state is current (edits update
  // it), and another view's cached payload may carry older preferences.
  if (data.prefs && !S.prefsLoaded) {
    S.prefs = structuredClone(data.prefs);
    S.prefsLoaded = true;
  }
  S.ent = key;
}
