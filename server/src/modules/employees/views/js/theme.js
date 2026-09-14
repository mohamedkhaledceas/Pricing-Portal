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

export function themePref() {
  try {
    return localStorage.getItem('pricingPortalTheme') || 'system';
  } catch (err) {
    return 'system';
  }
}

// #theme-seg-btn elements now live inside the shared account-menu dropdown
// (accountMenu.js), which isn't mounted yet the first time init() calls
// this — querySelectorAll on nothing is a harmless no-op then.
export function updateAppearanceControls() {
  const pref = themePref();
  document.querySelectorAll('.theme-seg-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeValue === pref));
  });
}

export function setTheme(value) {
  if (value === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);
  try {
    if (value === 'system') localStorage.removeItem('pricingPortalTheme');
    else localStorage.setItem('pricingPortalTheme', value);
  } catch (err) {}
  paintLogo();
  updateAppearanceControls();
}
