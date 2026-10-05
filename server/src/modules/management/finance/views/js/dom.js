export function $(sel) {
  return document.querySelector(sel);
}

export function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function skeletonBlock(width, height) {
  return `<div class="skeleton" style="width:${width}; height:${height};"></div>`;
}

export function toast(message, kind) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (kind ? ' toast-' + kind : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}
