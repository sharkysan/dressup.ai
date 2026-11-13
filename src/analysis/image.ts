import type { Box, RgbaImage } from './types';

export const MAX_EDGE = 1024;
/** The face crop's longest edge, at most: the face texture is 1024², so more would be wasted. */
export const CROP_MAX_EDGE = 2048;

export class DecodeError extends Error {
  constructor(detail: string) {
    super(`could not decode image: ${detail}`);
    this.name = 'DecodeError';
  }
}

/** Target size with the long edge capped at `maxEdge`; never upscales; integer dimensions. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decodes a photo (honouring EXIF orientation) and draws a copy downsized to ≤1024 px, as a canvas (for
 * MediaPipe) and raw pixels (for colour sampling). The full-resolution `bitmap` is returned open, for the
 * face crop: the caller closes it. The photo stays in memory only (spec §3).
 */
export async function decodePhoto(
  file: Blob,
): Promise<{ canvas: HTMLCanvasElement; image: RgbaImage; bitmap: ImageBitmap }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new DecodeError(cause instanceof Error ? cause.message : String(cause));
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new DecodeError('no 2d context');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return { canvas, image: { width, height, data }, bitmap };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

/**
 * The pixels of `rect` (full-resolution pixels) of the photo, at `scale` = 1, or less where its longer
 * edge would pass `maxEdge`. Crop pixel (x, y) shows photo point rect + (x + ½, y + ½) / scale.
 */
export function cropFace(
  bitmap: ImageBitmap,
  rect: Box,
  maxEdge = CROP_MAX_EDGE,
): { image: RgbaImage; scale: number } {
  const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height));
  const { width, height } = fitWithin(rect.width, rect.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('cropFace: no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  return { image: { width, height, data: ctx.getImageData(0, 0, width, height).data }, scale };
}
