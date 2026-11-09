/** The analysis debug page lives at #analysis (developer tool, spec §13). */
export function isAnalysisRoute(loc: Location = location): boolean {
  return loc.hash === '#analysis';
}

/**
 * Dev-only UI and the `window.__kiss` hook are on in dev builds, with `#dev` in the URL,
 * and on the #analysis developer page (so the lineup runner and e2e tests can drive it).
 */
export function isDevPanelEnabled(
  loc: Location = location,
  devBuild: boolean = import.meta.env.DEV,
): boolean {
  return devBuild || loc.hash === '#dev' || isAnalysisRoute(loc);
}
