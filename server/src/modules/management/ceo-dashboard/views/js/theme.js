/* Same localStorage key and system/light/dark semantics as every other page
   (and the shared account menu), so a theme picked here follows the user
   around the portal. Unlike the other pages there's no logo to repaint —
   the rail mark is drawn in CSS. */
export function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function themePref() {
  try {
    return localStorage.getItem('pricingPortalTheme') || 'system';
  } catch (err) {
    return 'system';
  }
}

// .theme-seg-btn elements live inside the shared account-menu dropdown,
// which isn't mounted the first time this runs — a harmless no-op then.
export function updateAppearanceControls() {
  const pref = themePref();
  document.querySelectorAll('.theme-seg-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeValue === pref));
  });
}

/* The top-bar chip names the theme a click switches to. */
export function syncThemeChip() {
  const chip = document.getElementById('theme');
  if (chip) chip.textContent = isDarkTheme() ? 'Light' : 'Dark';
}

export function setTheme(value) {
  if (value === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);
  try {
    if (value === 'system') localStorage.removeItem('pricingPortalTheme');
    else localStorage.setItem('pricingPortalTheme', value);
  } catch (err) {
    // Storage blocked (private mode) — the theme still applies for this page view.
  }
  updateAppearanceControls();
  syncThemeChip();
}
