export function $(sel, root) {
  return (root || document).querySelector(sel);
}
