import { z } from 'zod';

/** MediaPipe's face landmarks on the head surface: the 478 less the 10 iris points. */
export const FACE_LANDMARKS = 468;

const index = z.number().int().nonnegative();
const vec2 = z.tuple([z.number(), z.number()]);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * How MediaPipe's face maps onto the base (spec §12), built with the base by tools/base/correspondence.ts.
 * Base space is the Body's bind space: metres, +Y up, facing +Z, +X the subject's left. Vertex indices
 * are glTF vertex indices of the Body primitive of the shipped base.vrm; uvs are glTF's (v down).
 */
export const correspondenceSchema = z
  .object({
    version: z.literal(1),
    /** The Body primitive's vertex count, against a correspondence built for another base. */
    bodyVertexCount: index,
    /** MediaPipe's canonical landmarks 0..467, x y z each, in cm. */
    canonical: z.array(z.number()).length(3 * FACE_LANDMARKS),
    /** Canonical (cm) → base (m). */
    canonicalToBase: z.object({
      scale: z.number().positive(),
      rotation: z.array(z.number()).length(9),
      translation: vec3,
    }),
    /** Per landmark (index = landmark): its closest point on the face, on a Body triangle. */
    landmarks: z
      .array(
        z.object({
          triangle: z.tuple([index, index, index]),
          bary: vec3,
          uv: vec2,
          position: vec3,
        }),
      )
      .length(FACE_LANDMARKS),
    /** MediaPipe's face-mesh triangles over landmarks 0..467. */
    triangles: z.array(z.tuple([index, index, index])),
    /** The square of the Skin texture the face texture covers: (u, v) its least corner, then its side. */
    faceUvRect: z
      .object({ u: z.number(), v: z.number(), size: z.number().positive() })
      .refine((r) => r.u >= 0 && r.v >= 0 && r.u + r.size <= 1 && r.v + r.size <= 1, {
        message: 'faceUvRect must lie inside [0,1]²',
      }),
    /** The Body vertices with a head weight (head + ½ neck), in index order, with their bind positions (m). */
    head: z.object({
      vertices: z.array(index),
      weights: z.array(z.number()),
      positions: z.array(z.number()),
    }),
    /** Indices into head.vertices: points the head fit holds still (behind the ears). */
    zero: z.array(index),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const { vertices, weights, positions } = c.head;
    if (weights.length !== vertices.length || positions.length !== 3 * vertices.length) {
      issue('head needs one weight and three position values per vertex');
    }
    if (c.landmarks.some((l) => l.triangle.some((v) => v >= c.bodyVertexCount))) {
      issue('a landmark triangle indexes past bodyVertexCount');
    }
    if (c.triangles.some((t) => t.some((i) => i >= FACE_LANDMARKS))) {
      issue(`triangles index past landmark ${FACE_LANDMARKS - 1}`);
    }
    if (c.zero.some((i) => i >= vertices.length)) issue('zero indexes past head.vertices');
  });
export type Correspondence = z.infer<typeof correspondenceSchema>;

export const CORRESPONDENCE_URL = '/assets/base/correspondence.json';

let loading: Promise<Correspondence> | null = null;

/** Fetches and validates the correspondence once per page. Rejects with an Error naming the URL. */
export function loadCorrespondence(): Promise<Correspondence> {
  loading ??= fetchCorrespondence().catch((error: unknown) => {
    loading = null; // a later call tries again
    throw error;
  });
  return loading;
}

async function fetchCorrespondence(): Promise<Correspondence> {
  try {
    const response = await fetch(CORRESPONDENCE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return correspondenceSchema.parse(await response.json());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${CORRESPONDENCE_URL}: ${reason}`, { cause: error });
  }
}
