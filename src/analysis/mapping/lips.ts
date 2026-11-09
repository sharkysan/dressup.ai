import { defaultParams } from '../../catalog/params';
import { medianColorTrimmed } from '../color';
import { LM, polygonMask } from '../landmarks';
import type { Point2, RgbaImage } from '../types';

/** Lip tint: trimmed median inside the outer-lip polygon; default when the polygon is too small. */
export function extractLipTint(image: RgbaImage, pixels: Point2[]): string {
  const mask = polygonMask(pixels, LM.outerLips, image.width, image.height);
  return medianColorTrimmed(image, mask) ?? defaultParams.lipTint;
}
