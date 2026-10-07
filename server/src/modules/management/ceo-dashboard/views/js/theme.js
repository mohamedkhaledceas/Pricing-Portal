/* The theme itself is set from the portal's shared sidebar
   (public/shared/appShell.js, same localStorage key on every page); the
   Control Room only needs to know which one is showing, for its brand
   palette's light and dark forms. */
export function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
