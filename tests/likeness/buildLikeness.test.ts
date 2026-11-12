import fs from 'node:fs';
import { toPixels } from '../../src/analysis/landmarks';
import { categoryEquals, resampleMask } from '../../src/analysis/masks';
import { MASK, type FaceObservation } from '../../src/analysis/types';
import { buildLikeness } from '../../src/likeness/buildLikeness';
import {
  FACE_LANDMARKS,
  correspondenceSchema,
  type Correspondence,
} from '../../src/likeness/correspondence';
import { FACE_TEXTURE_SIZE } from '../../src/likeness/faceTexture';
import { likenessSchema } from '../../src/likeness/types';
import { CANONICAL_FACE_OBJ, readCanonicalFace } from '../../tools/base/canonicalFace';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

const CANON = readCanonicalFace(CANONICAL_FACE_OBJ);

/**
 * The canonical face as a correspondence for both steps (canonical cm → base m is ×0.01): the head is the
 * 468 landmark positions and 60 back-of-head points held still; each landmark's uv is its OBJ uv
 * flipped to glTF, the face square the whole texture.
 */
function synthCorrespondence(): Correspondence {
  const positions = CANON.positions.slice(0, FACE_LANDMARKS);
  const landmarks = positions.map((p) => p.map((v) => v * 0.01) as [number, number, number]);
  const back = Array.from({ length: 60 }, (_, k): [number, number, number] => [
    -0.0675 + 0.015 * (k % 10),
    -0.08 + 0.03 * Math.floor(k / 10),
    -0.06,
  ]);
  const head = [...landmarks, ...back];
  return correspondenceSchema.parse({
    version: 1,
    bodyVertexCount: head.length,
    canonical: positions.flat(),
    canonicalToBase: { scale: 0.01, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] },
    landmarks: landmarks.map((position, i) => ({
      triangle: [0, 0, 0],
      bary: [1, 0, 0],
      uv: [CANON.uvs[i]![0], 1 - CANON.uvs[i]![1]],
      position,
    })),
    triangles: CANON.triangles.filter((t) => t.every((i) => i < FACE_LANDMARKS)),
    faceUvRect: { u: 0, v: 0, size: 1 },
    head: {
      vertices: head.map((_, v) => v),
      weights: head.map(() => 1),
      positions: head.flat(),
    },
    zero: back.map((_, k) => FACE_LANDMARKS + k),
  });
}

const CORR = synthCorrespondence();

/** buildLikeness's input for a synthetic photo, the crop being the whole photo. */
function input(face?: FaceObservation) {
  const fx = synthFace({ width: 640, height: 800, scale: 24, yawDeg: 10 });
  const { width, height } = fx.image;
  const hair = resampleMask(
    categoryEquals(fx.mask, MASK.hair),
    fx.mask.width,
    fx.mask.height,
    width,
    height,
  );
  return {
    face: face ?? fx.face,
    crop: { image: fx.image, landmarks: toPixels(fx.face), hair },
    sourceSkin: '#c68642',
  };
}

/**
 * Stubs the canvas the face texture is encoded on (jsdom has none): records what is put on it and
 * which type toBlob is asked for, and answers with a Blob of type `answer` (null: no blob).
 */
function stubEncoder(answer: string | null = 'image/webp') {
  const put: ImageData[] = [];
  const context = {
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(4 * width * height),
    }),
    putImageData: (image: ImageData) => put.push(image),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
  ) {
    callback(answer === null ? null : new Blob([new Uint8Array([1, 2, 3])], { type: answer }));
  });
  return { put, toBlob };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('the likeness parses, with head offsets and a face texture of the stated shape', async () => {
  const { put, toBlob } = stubEncoder();
  const { likeness, debug } = await buildLikeness(input(), CORR);

  expect(likenessSchema.safeParse(likeness).success).toBe(true);
  expect(likeness.version).toBe(1);
  expect(likeness.sourceSkin).toBe('#c68642');
  expect(likeness.headOffsets).toBeInstanceOf(Float32Array);
  expect(likeness.headOffsets).toHaveLength(3 * CORR.head.vertices.length);
  expect(likeness.headOffsets.every(Number.isFinite)).toBe(true);
  expect(likeness.faceTexture).toBeInstanceOf(Blob);
  expect(likeness.faceTexture.type).toBe('image/webp');

  // Encoded from a FACE_TEXTURE_SIZE² canvas holding the projected face, at WebP quality 0.92.
  expect(toBlob).toHaveBeenCalledTimes(1);
  const [, type, quality] = toBlob.mock.calls[0]!;
  expect([type, quality]).toEqual(['image/webp', 0.92]);
  const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
  expect([canvas.width, canvas.height]).toEqual([FACE_TEXTURE_SIZE, FACE_TEXTURE_SIZE]);
  expect(put).toHaveLength(1);
  expect([put[0]!.width, put[0]!.height]).toEqual([FACE_TEXTURE_SIZE, FACE_TEXTURE_SIZE]);
  expect(put[0]!.data.some((v) => v !== 0)).toBe(true);

  expect(Number.isFinite(debug.residualRmsMm)).toBe(true);
  expect(Number.isFinite(debug.maxOffsetMm)).toBe(true);
  expect(debug.aligned).toHaveLength(3 * FACE_LANDMARKS);
  for (const ms of Object.values(debug.ms)) expect(ms).toBeGreaterThanOrEqual(0);
  expect(Object.keys(debug.ms).sort()).toEqual(['encode', 'fit', 'project']);
});

test('where the browser cannot encode WebP, the PNG it gives back is accepted', async () => {
  stubEncoder('image/png');
  const { likeness } = await buildLikeness(input(), CORR);
  expect(likeness.faceTexture.type).toBe('image/png');
  expect(likenessSchema.safeParse(likeness).success).toBe(true);
});

test('no blob, or another type, is an error', async () => {
  stubEncoder(null);
  await expect(buildLikeness(input(), CORR)).rejects.toThrow(/face texture/);
  vi.restoreAllMocks();
  stubEncoder('image/jpeg');
  await expect(buildLikeness(input(), CORR)).rejects.toThrow(/image\/jpeg/);
});

test('a head fit that is not finite is rejected', async () => {
  const { toBlob } = stubEncoder();
  const face = input().face;
  const broken = {
    ...face,
    landmarks: face.landmarks.map((p, i) => (i === 1 ? { ...p, x: NaN } : p)),
  };
  await expect(buildLikeness(input(broken), CORR)).rejects.toThrow(/not finite/);
  expect(toBlob).not.toHaveBeenCalled();
});

test('a sourceSkin channel of 0 is raised to 1/255, so the face layer never divides by 0', async () => {
  stubEncoder();
  const { likeness } = await buildLikeness({ ...input(), sourceSkin: '#00A0FF' }, CORR);
  expect(likeness.sourceSkin).toBe('#01a0ff');
  expect(likenessSchema.safeParse(likeness).success).toBe(true);
});

const BUILT = 'public/assets/base/correspondence.json';

describe.skipIf(!fs.existsSync(BUILT))('the built correspondence', () => {
  const corr = fs.existsSync(BUILT)
    ? correspondenceSchema.parse(JSON.parse(fs.readFileSync(BUILT, 'utf8')))
    : CORR;

  test('headOffsets has three values per head vertex', async () => {
    stubEncoder();
    const { likeness } = await buildLikeness(input(), corr);
    expect(likeness.headOffsets).toHaveLength(3 * corr.head.vertices.length);
  });

  // R17: wall-clock budgets are asserted only on request (KISS_PERF=1), on an otherwise idle machine.
  test.skipIf(!process.env.KISS_PERF)('fitHead + projectFace take under 400 ms', async () => {
    stubEncoder();
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const { debug } = await buildLikeness(input(), corr);
      runs.push(debug.ms.fit + debug.ms.project);
    }
    expect(Math.min(...runs)).toBeLessThan(400);
  });
});
