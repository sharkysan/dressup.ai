import type { AvatarParams } from '../catalog/params';

/** Iris tints for the six eye-colour presets (spec §6). Applied to greyscale iris textures. */
export const EYE_COLORS: Record<AvatarParams['eyeColor'], string> = {
  brown: '#6b4423',
  darkBrown: '#3b2314',
  hazel: '#8f7032',
  green: '#4e7d44',
  blue: '#4a76b0',
  grey: '#7d838c',
};
