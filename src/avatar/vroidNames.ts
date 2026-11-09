/**
 * Material-role detection by name, shared by the asset pipeline and the runtime so they cannot drift.
 * VRoid Studio names materials like `Body_00_SKIN`, often wrapped as `N00_000_00_Body_00_SKIN (Instance)`;
 * other tools frequently just use `hair`.
 */
export const isSkinMaterial = (name: string | undefined) => /_SKIN(?![A-Za-z])/.test(name ?? '');
export const isIrisMaterial = (name: string | undefined) => /EyeIris/.test(name ?? '');
export const isMouthMaterial = (name: string | undefined) => /FaceMouth/.test(name ?? '');
export const isBrowMaterial = (name: string | undefined) => /FaceBrow/.test(name ?? '');
export const isHairMaterial = (name: string | undefined) =>
  /_HAIR(?![A-Za-z])|^hair(?![A-Za-z])/i.test(name ?? '');
