/** Dev-only UI (params panel, `window.__kiss`) is on in dev builds or with `#dev` in the URL. */
export function isDevPanelEnabled(loc: Location = location): boolean {
  return import.meta.env.DEV || loc.hash === '#dev';
}
