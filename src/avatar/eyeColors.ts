import type { AvatarParams } from '../catalog/params';

/**
 * Reference iris colours of the six eye-colour presets (spec §6): analysis picks the nearest. The avatar
 * shows each preset's own eye texture (spec §7), chosen to match these by the base build.
 */
export const EYE_COLORS: Record<AvatarParams['eyeColor'], string> = {
  brown: '#6b4423',
  darkBrown: '#3b2314',
  hazel: '#8f7032',
  green: '#4e7d44',
  blue: '#4a76b0',
  grey: '#7d838c',
};
