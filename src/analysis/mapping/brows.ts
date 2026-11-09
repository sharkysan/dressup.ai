import type { AvatarParams } from '../../catalog/params';
import { dist, LM } from '../landmarks';
import type { Point2 } from '../types';

export const BROW_RULES = {
  thicknessRange: [0.012, 0.04] as const, // of face height → 0..1
  straightMax: 0.08, // arch height ÷ chord
  archedMin: 0.16,
  angledOuterRise: -0.1, // outer end not clearly below the inner end → angled (canonical is ≈ −0.17)
} as const;

/** Brow thickness (0..1) and shape from the brow landmark contours (spec §6). */
export function extractBrows(pixels: Point2[]): AvatarParams['brows'] {
  const faceH = dist(pixels[LM.faceTop]!, pixels[LM.chin]!);
  const brows = [LM.browR, LM.browL];

  let thicknessSum = 0;
  for (const b of brows) {
    let s = 0;
    for (let i = 0; i < b.upper.length; i++) s += dist(pixels[b.upper[i]!]!, pixels[b.lower[i]!]!);
    thicknessSum += s / b.upper.length;
  }
  const rawThickness = thicknessSum / brows.length / faceH;
  const [lo, hi] = BROW_RULES.thicknessRange;
  const thickness = Math.max(0, Math.min(1, (rawThickness - lo) / (hi - lo)));

  // Shape from the upper contour: arch = max height above the inner→outer chord (toward the top of the
  // image, so both brows measure the same way) ÷ chord; outerRise = how much higher the outer end sits
  // than the inner end ÷ chord (brows normally slope down outward, so this is usually negative).
  let archSum = 0;
  let outerRiseSum = 0;
  for (const b of brows) {
    const outer = pixels[b.upper[0]!]!;
    const inner = pixels[b.upper[b.upper.length - 1]!]!;
    const chord = dist(outer, inner);
    let maxH = 0;
    for (let i = 1; i < b.upper.length - 1; i++) {
      const p = pixels[b.upper[i]!]!;
      const t = (p.x - outer.x) / (inner.x - outer.x || 1e-6);
      const chordY = outer.y + t * (inner.y - outer.y);
      maxH = Math.max(maxH, chordY - p.y);
    }
    archSum += maxH / chord;
    outerRiseSum += (inner.y - outer.y) / chord;
  }
  const arch = archSum / brows.length;
  const outerRise = outerRiseSum / brows.length;
  let shape: AvatarParams['brows']['shape'];
  if (outerRise > BROW_RULES.angledOuterRise) shape = 'angled';
  else if (arch < BROW_RULES.straightMax) shape = 'straight';
  else shape = arch >= BROW_RULES.archedMin ? 'arched' : 'soft';
  return { shape, thickness };
}
