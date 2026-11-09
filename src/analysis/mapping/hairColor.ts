import { medianColorTrimmed } from '../color';
import { hexToOklab, oklabToHex, rgbToHex } from '../../color/oklab';
import type { RgbaImage } from '../types';

/**
 * Hair colour: median of the brighter half of hair pixels (spec §6), so shadowed strands do not
 * drag dark hair to black. Returns null when the mask is too small.
 */
export function extractHairColor(image: RgbaImage, hair: Uint8Array): string | null {
  const { data } = image;
  const lit: { i: number; L: number }[] = [];
  for (let i = 0; i < hair.length; i++) {
    if (!hair[i]) continue;
    const L = hexToOklab(
      rgbToHex([data[i * 4]! / 255, data[i * 4 + 1]! / 255, data[i * 4 + 2]! / 255]),
    ).L;
    lit.push({ i, L });
  }
  if (lit.length < 20) return null;
  lit.sort((a, b) => a.L - b.L);
  const brighter = new Uint8Array(hair.length);
  for (const { i } of lit.slice(Math.floor(lit.length / 2))) brighter[i] = 1;
  const median = medianColorTrimmed(image, brighter, 0);
  if (!median) return null;
  // Guard against pure black mapping (MToon tint × 0 = invisible hair): keep L ≥ 0.12.
  const lab = hexToOklab(median);
  return lab.L < 0.12 ? oklabToHex({ ...lab, L: 0.12 }) : median;
}
