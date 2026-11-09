import type { RgbaImage } from './types';

export const MAX_EDGE = 1024;

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
 * Decodes a photo (honouring EXIF orientation), downsizes to ≤1024 px and returns both a canvas
 * (for MediaPipe) and raw pixels (for colour sampling). The photo stays in memory only (spec §3).
 */
export async function decodePhoto(
  file: Blob,
): Promise<{ canvas: HTMLCanvasElement; image: RgbaImage }> {
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
    return { canvas, image: { width, height, data } };
  } finally {
    bitmap.close();
  }
}
