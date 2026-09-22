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
  $('#brandLogo').src = src;
  $('#logoPreview').src = src;
  $('#s_logoQuote').checked = S().logoQuote !== false;
}

const THEME_KEY = 'pricingPortalTheme';
export function themePref() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (err) { return 'system'; }
}
// .theme-seg-btn elements live inside the shared account-menu dropdown
// (accountMenu.js) — querySelectorAll on nothing before it's mounted is a
// harmless no-op.
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
    if (value === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch (err) { /* ignore */ }
  paintLogos();
  updateAppearanceControls();
}

export function bindTheme() {
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => paintLogos();
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
  }
  updateAppearanceControls();
  // .theme-seg-btn buttons live inside the shared account-menu dropdown
  // now, not in the static page markup — accountMenu.js binds their click
  // handlers itself each time the menu is (re-)rendered. Nothing to bind
  // here anymore.
  document.addEventListener('input', () => { setDirty(true); }, true);
  document.addEventListener('change', () => { setDirty(true); }, true);
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault(); e.returnValue = '';
  });
}
