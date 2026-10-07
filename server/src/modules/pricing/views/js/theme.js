import { $ } from './dom.js';
import { S, dirty, setDirty } from './state.js';
import { LOGO_LIGHT, LOGO_DARK } from './format.js';

export function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
export function logoSrc(forPrint) {
  if (S().logo) return S().logo;
  return (!forPrint && isDarkTheme()) ? LOGO_DARK : LOGO_LIGHT;
}
export function paintLogos() {
  const src = logoSrc(false);
  $('#logoPreview').src = src;
  $('#s_logoQuote').checked = S().logoQuote !== false;
}

// Appearance is set from the shared sidebar (appShell.js), which calls
// paintLogos through its onThemeChange hook — including when the system
// setting flips while on "System".
export function bindTheme() {
  document.addEventListener('input', () => { setDirty(true); }, true);
  document.addEventListener('change', () => { setDirty(true); }, true);
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault(); e.returnValue = '';
  });
}
