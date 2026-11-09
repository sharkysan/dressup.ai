import type { AvatarParams } from '../../catalog/params';
import { hexToOklab, rgbToHex } from '../../color/oklab';
import { medianColorTrimmed, nearestEyeColor } from '../color';
import { dist, LM } from '../landmarks';
import type { Point2, RgbaImage } from '../types';

const INNER = 0.45;
const OUTER = 0.95;
const SPECULAR_L = 0.85;

/** Iris colour from an annulus around each iris centre, excluding pupil and specular highlights. */
export function extractEyeColor(
  image: RgbaImage,
  pixels: Point2[],
): { preset: AvatarParams['eyeColor']; sample: string | null } {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (const iris of [LM.irisR, LM.irisL]) {
    const c = pixels[iris[0]!]!;
    const r = dist(pixels[iris[1]!]!, pixels[iris[3]!]!) / 2;
    if (!(r > 1)) continue;
    for (
      let y = Math.max(0, Math.floor(c.y - r));
      y <= Math.min(height - 1, Math.ceil(c.y + r));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(c.x - r));
        x <= Math.min(width - 1, Math.ceil(c.x + r));
        x++
      ) {
        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) / r;
        if (d < INNER || d > OUTER) continue;
        const i = y * width + x;
        const L = hexToOklab(
          rgbToHex([data[i * 4]! / 255, data[i * 4 + 1]! / 255, data[i * 4 + 2]! / 255]),
        ).L;
        if (L > SPECULAR_L) continue;
        mask[i] = 1;
      }
    }
  }
  const sample = medianColorTrimmed(image, mask, 0.1);
  return { preset: sample ? nearestEyeColor(sample) : 'brown', sample };
}
