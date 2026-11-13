import type { FaceObservation, Point2, RgbaImage } from '../analysis/types';
import type { Correspondence } from './correspondence';
import { projectFace } from './faceTexture';
import { fitHead, type HeadFit } from './headFit';
import { FACE_TEXTURE_TYPES, likenessSchema, type Likeness } from './types';

/** The face texture's WebP quality. */
export const FACE_TEXTURE_QUALITY = 0.92;

/** The head fit's diagnostics, and how long each step took (ms) for the debug page. */
export type LikenessDebug = HeadFit['debug'] & {
  ms: { fit: number; project: number; encode: number };
};

/**
 * The Likeness of a face (spec §6): the head fitted to its landmarks, and the face crop projected into
 * the head's UV square and encoded as WebP (PNG where the browser cannot encode WebP). `crop` is the
 * full-resolution face crop with the landmarks and the hair mask in its pixels. Rejects a head fit
 * that is not finite (degenerate landmarks) and an encoding that fails. A `sourceSkin` channel of 0 is
 * raised to 1/255, as the face layer divides by it.
 */
export async function buildLikeness(
  input: {
    face: FaceObservation;
    crop: { image: RgbaImage; landmarks: Point2[]; hair: Uint8Array };
    sourceSkin: string;
  },
  corr: Correspondence,
): Promise<{ likeness: Likeness; debug: LikenessDebug }> {
  const start = performance.now();
  const fit = fitHead(input.face, corr);
  if (!fit.headOffsets.every(Number.isFinite)) {
    throw new Error('buildLikeness: the head fit is not finite');
  }
  const fitted = performance.now();
  const { image, landmarks, hair } = input.crop;
  const texture = projectFace({ photo: image, landmarks, hair }, corr);
  const projected = performance.now();
  const faceTexture = await encodeFaceTexture(texture);
  const encoded = performance.now();
  const likeness = likenessSchema.parse({
    version: 1,
    faceTexture,
    headOffsets: fit.headOffsets,
    sourceSkin: withoutZeroChannel(input.sourceSkin),
  });
  return {
    likeness,
    debug: {
      ...fit.debug,
      ms: { fit: fitted - start, project: projected - fitted, encode: encoded - projected },
    },
  };
}

/**
 * The image as WebP; a browser that cannot encode WebP gives PNG instead (the canvas spec's fallback),
 * which is kept.
 */
async function encodeFaceTexture(image: RgbaImage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('buildLikeness: 2D canvas is not available');
  const pixels = context.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', FACE_TEXTURE_QUALITY),
  );
  if (!blob) throw new Error('buildLikeness: the face texture could not be encoded');
  if (!(FACE_TEXTURE_TYPES as readonly string[]).includes(blob.type)) {
    throw new Error(`buildLikeness: the face texture was encoded as ${blob.type || 'no type'}`);
  }
  return blob;
}

/** `#rrggbb` with each channel at least 1 (of 255), lower case. */
function withoutZeroChannel(hex: string): string {
  const channels = [1, 3, 5].map((i) => Math.max(1, parseInt(hex.slice(i, i + 2), 16)));
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
