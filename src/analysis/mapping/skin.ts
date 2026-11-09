import { defaultParams } from '../../catalog/params';
import { medianColorTrimmed } from '../color';
import { faceBox, LM, polygonMask } from '../landmarks';
import { andMasks, restrictToBox } from '../masks';
import type { Point2, RgbaImage } from '../types';

/**
 * Skin tone: trimmed median of the cheek and forehead patches ∧ the face-skin mask; falls back to
 * the whole face-skin mask inside the face box, then to the default skin.
 */
export function extractSkin(image: RgbaImage, faceSkin: Uint8Array, pixels: Point2[]): string {
  const { width, height } = image;
  const patches = [LM.cheekPatchR, LM.cheekPatchL, LM.foreheadPatch].map((idx) =>
    polygonMask(pixels, idx, width, height),
  );
  const union = new Uint8Array(width * height);
  for (const p of patches)
    for (let i = 0; i < union.length; i++) union[i] = (union[i] ?? 0) | p[i]!;
  const primary = medianColorTrimmed(image, andMasks(union, faceSkin));
  if (primary) return primary;
  const fallback = medianColorTrimmed(
    image,
    restrictToBox(faceSkin, width, height, faceBox(pixels)),
  );
  return fallback ?? defaultParams.skin;
}
