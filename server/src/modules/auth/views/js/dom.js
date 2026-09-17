export function $(sel, root) {
  return (root || document).querySelector(sel);
}

// Same implementation as every other view module's dom.js (e.g.
// modules/employees/views/js/dom.js) — this file was missing it entirely,
// which let main.js interpolate employee names straight into innerHTML
// unescaped (see refreshManagerOptions' team-head dropdown) — a stored XSS
// reachable by any unauthenticated visitor of the signup wizard, since a
// self-registered first/last name is only trimmed, never HTML-stripped.
export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
