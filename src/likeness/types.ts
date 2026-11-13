import { z } from 'zod';

/** What a face texture may be encoded as: WebP, or PNG where the browser cannot encode WebP (Safari). */
export const FACE_TEXTURE_TYPES = ['image/webp', 'image/png'] as const;

/**
 * A #rrggbb skin tone with no channel at 0: the face layer divides by it (bodyTexture.ts), so a zero
 * channel would make the face NaN.
 */
const sourceSkin = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb colour')
  .refine((hex) => [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) > 0), {
    message: 'sourceSkin has a channel at 0',
  });

/**
 * A person's face from their photo (spec §5), kept on the device only (§3): the face texture in the
 * base head's UV square, the head's offsets (metres, x y z per head vertex of the correspondence, in the
 * base's bind space), and the skin tone the photo was taken at.
 */
export const likenessSchema = z.object({
  version: z.literal(1),
  faceTexture: z
    .instanceof(Blob)
    .refine((blob) => (FACE_TEXTURE_TYPES as readonly string[]).includes(blob.type), {
      message: `faceTexture must be one of ${FACE_TEXTURE_TYPES.join(', ')}`,
    }),
  headOffsets: z
    .instanceof(Float32Array)
    .refine((offsets) => offsets.length % 3 === 0 && offsets.every(Number.isFinite), {
      message: 'headOffsets must be finite, three per head vertex',
    }),
  sourceSkin,
});
export type Likeness = z.infer<typeof likenessSchema>;
