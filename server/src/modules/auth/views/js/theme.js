import { $ } from './dom.js';

export function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function paintLogo() {
  const el = $('#brandLogo');
  if (el) el.src = isDarkTheme() ? '/logo-dark.png' : '/logo-light.png';
}
