import { EYE_COLORS } from '../avatar/eyeColors';
import type { AvatarParams } from '../catalog/params';
import { hexToOklab, oklabToHex, rgbToHex } from '../color/oklab';
import type { RgbaImage } from './types';

export const MIN_SAMPLE_PIXELS = 20;

/** sRGB bytes → OKLab, inlined for speed over large masks. */
function pixelToOklab(r: number, g: number, b: number): [number, number, number] {
  const lab = hexToOklab(rgbToHex([r / 255, g / 255, b / 255]));
  return [lab.L, lab.a, lab.b];
}

/**
 * Median colour (per OKLab channel) of the masked pixels after dropping the darkest and brightest
 * `trim` fraction by lightness — spec §6's "drop the darkest/brightest 20% to dodge shadows and shine".
 * Returns null with fewer than MIN_SAMPLE_PIXELS pixels.
 */
export function medianColorTrimmed(image: RgbaImage, mask: Uint8Array, trim = 0.2): string | null {
  const samples: [number, number, number][] = [];
  const { data } = image;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || data[i * 4 + 3]! < 128) continue;
    samples.push(pixelToOklab(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!));
  }
  if (samples.length < MIN_SAMPLE_PIXELS) return null;
  samples.sort((p, q) => p[0] - q[0]);
  const drop = Math.floor(samples.length * trim);
  const kept = samples.slice(drop, samples.length - drop);
  const median = (idx: 0 | 1 | 2) => {
    const v = kept.map((s) => s[idx]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  return oklabToHex({ L: median(0), a: median(1), b: median(2) });
}

/** Snaps a sampled iris colour to the nearest preset by OKLab distance (spec §6). */
export function nearestEyeColor(hex: string): AvatarParams['eyeColor'] {
  const target = hexToOklab(hex);
  let best: AvatarParams['eyeColor'] = 'brown';
  let bestDistance = Infinity;
  for (const [name, preset] of Object.entries(EYE_COLORS) as [AvatarParams['eyeColor'], string][]) {
    const p = hexToOklab(preset);
    const d = Math.hypot(p.L - target.L, p.a - target.a, p.b - target.b);
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best;
}
