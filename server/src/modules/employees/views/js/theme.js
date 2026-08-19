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

export function updateThemeToggleLabel() {
  const pref = themePref();
  const el = $('#themeToggleState');
  if (el) el.textContent = pref === 'dark' ? 'Dark' : pref === 'light' ? 'Light' : 'System';
}

export function cycleTheme() {
  const cur = themePref();
  const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
  if (next === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  try {
    if (next === 'system') localStorage.removeItem('pricingPortalTheme');
    else localStorage.setItem('pricingPortalTheme', next);
  } catch (err) {}
  paintLogo();
  updateThemeToggleLabel();
}
