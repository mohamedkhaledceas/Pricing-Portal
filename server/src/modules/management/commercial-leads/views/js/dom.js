export function $(sel) {
  return document.querySelector(sel);
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function skeletonBlock(width, height) {
  return `<div class="skeleton" style="width:${width}; height:${height};"></div>`;
}

export function skeletonTableRows(colWidths) {
  const cells = colWidths.map((w) => `<td>${skeletonBlock(w, '13px')}</td>`).join('');
  return Array.from({ length: 5 }, () => `<tr>${cells}</tr>`).join('');
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 'all'];

/* Generic pager: slices to the current page and renders a page-size select
   (with an "All" option that shows everything, no slicing) beside Prev/Next. */
export function paginate(items, page, pageSize, containerId, onPageChange, onPageSizeChange) {
  const effectiveSize = pageSize === 'all' ? items.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(items.length / effectiveSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * effectiveSize;
  const pageItems = pageSize === 'all' ? items : items.slice(start, start + effectiveSize);

  const el = document.getElementById(containerId);
  if (items.length === 0) {
    el.innerHTML = '';
  } else {
    const sizeOptions = PAGE_SIZE_OPTIONS.map((n) =>
      `<option value="${n}" ${String(pageSize) === String(n) ? 'selected' : ''}>${n === 'all' ? 'All' : n}</option>`
    ).join('');
    el.innerHTML = `
      <label>Show <select data-role="page-size">${sizeOptions}</select></label>
      <button type="button" data-dir="prev" ${clampedPage <= 1 ? 'disabled' : ''}>&larr; Prev</button>
      <span>Page ${clampedPage} of ${totalPages} (${items.length} total)</span>
      <button type="button" data-dir="next" ${clampedPage >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
    `;
    el.querySelector('[data-dir="prev"]')?.addEventListener('click', () => onPageChange(clampedPage - 1));
    el.querySelector('[data-dir="next"]')?.addEventListener('click', () => onPageChange(clampedPage + 1));
    el.querySelector('[data-role="page-size"]')?.addEventListener('change', (e) => {
      onPageSizeChange(e.target.value === 'all' ? 'all' : Number(e.target.value));
    });
  }
  return { pageItems, clampedPage };
}
