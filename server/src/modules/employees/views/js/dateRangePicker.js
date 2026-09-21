const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }
function fmtShort(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
}

/*
 * A date-range button + single-month calendar popover, with no separate
 * "Apply" step: the first day clicked sets the range start, and the second
 * click sets the end and calls onApply(...) right away — same effect as
 * hitting a filter button or Enter, per the Leave Report's spec. Matches
 * the toggle-only (no outside-click-to-close) behavior of the KPI
 * notification panel elsewhere in this app rather than inventing a new
 * dismissal pattern.
 */
export function mountDateRangeFilter(container, { onApply }) {
  let start = null; // 'YYYY-MM-DD' | null
  let end = null;
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  const wrap = document.createElement('div');
  wrap.className = 'date-range-filter';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small date-range-btn';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn small icon-btn date-range-clear';
  clearBtn.textContent = '×';
  clearBtn.title = 'Clear date filter';
  clearBtn.hidden = true;

  const popover = document.createElement('div');
  popover.className = 'date-range-popover';
  popover.hidden = true;

  wrap.appendChild(btn);
  wrap.appendChild(clearBtn);
  wrap.appendChild(popover);
  container.appendChild(wrap);

  function updateButton() {
    btn.textContent = start && end ? `📅 ${fmtShort(start)} – ${fmtShort(end)}` : '📅 Date Range';
    clearBtn.hidden = !(start && end);
  }

  function dayClass(iso) {
    if (start && end) {
      if (iso === start || iso === end) return 'selected-end';
      if (iso > start && iso < end) return 'in-range';
    } else if (start && iso === start) {
      return 'selected-end';
    }
    return '';
  }

  function renderCalendar() {
    const startWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    let cells = '';
    for (let i = 0; i < startWeekday; i += 1) cells += '<div class="date-range-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = toISO(viewYear, viewMonth, d);
      cells += `<div class="date-range-day ${dayClass(iso)}" data-date="${iso}">${d}</div>`;
    }

    popover.innerHTML = `
      <div class="date-range-nav">
        <button type="button" class="btn small icon-btn" data-nav="prev">‹</button>
        <div class="date-range-month-label">${MONTH_NAMES[viewMonth]} ${viewYear}</div>
        <button type="button" class="btn small icon-btn" data-nav="next">›</button>
      </div>
      <div class="date-range-weekdays">${WEEKDAY_LABELS.map((w) => `<div>${w}</div>`).join('')}</div>
      <div class="date-range-grid">${cells}</div>
      <div class="date-range-hint">${start && !end ? 'Click an end date' : 'Click a start date'}</div>
    `;

    popover.querySelector('[data-nav="prev"]').addEventListener('click', () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      renderCalendar();
    });
    popover.querySelector('[data-nav="next"]').addEventListener('click', () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderCalendar();
    });
    popover.querySelectorAll('.date-range-day[data-date]').forEach((el) => {
      el.addEventListener('click', () => handleDayClick(el.dataset.date));
    });
  }

  function handleDayClick(iso) {
    if (!start || end) {
      start = iso;
      end = null;
      renderCalendar();
      return;
    }
    if (iso < start) { end = start; start = iso; } else { end = iso; }
    updateButton();
    popover.hidden = true;
    onApply({ startDate: start, endDate: end });
  }

  btn.addEventListener('click', () => {
    if (!popover.hidden) { popover.hidden = true; return; }
    const seed = start || toISO(today.getFullYear(), today.getMonth(), today.getDate());
    const [y, m] = seed.split('-').map(Number);
    viewYear = y;
    viewMonth = m - 1;
    renderCalendar();
    popover.hidden = false;
  });

  clearBtn.addEventListener('click', () => {
    start = null;
    end = null;
    updateButton();
    popover.hidden = true;
    onApply({ startDate: null, endDate: null });
  });

  updateButton();
}
