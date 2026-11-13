import {
  AnalysisError,
  analyzePhoto,
  applyGates,
  FACE_CROP,
  GATES,
  messageFor,
  pickLargest,
} from '../../src/analysis/analyze';
import { DecodeError } from '../../src/analysis/image';
import { faceBox, toPixels } from '../../src/analysis/landmarks';
import { dilateMask, expandBox, maskForCrop } from '../../src/analysis/masks';
import { MASK, type Box, type FaceObservation } from '../../src/analysis/types';
import { avatarParamsSchema } from '../../src/catalog/params';
import type { Correspondence } from '../../src/likeness/correspondence';
import type { Likeness } from '../../src/likeness/types';
import { strings } from '../../src/ui/strings';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

vi.mock('../../src/analysis/image', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/analysis/image')>();
  return { ...mod, decodePhoto: vi.fn(), cropFace: vi.fn() };
});
vi.mock('../../src/likeness/buildLikeness', () => ({ buildLikeness: vi.fn() }));
import { cropFace, decodePhoto } from '../../src/analysis/image';
import { buildLikeness } from '../../src/likeness/buildLikeness';

const fx = synthFace();
const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
/** The synthetic face's width in the analysed image (≈ 184 px). */
const ANALYSED_WIDTH = faceBox(toPixels(fx.face)).width;
/** Stands in for the correspondence: analyzePhoto only hands it on to buildLikeness (mocked). */
const CORR = { version: 1 } as unknown as Correspondence;
const LIKENESS: Likeness = {
  version: 1,
  faceTexture: new Blob([new Uint8Array([1])], { type: 'image/webp' }),
  headOffsets: new Float32Array(3),
  sourceSkin: '#c68642',
};
const LIKENESS_DEBUG = {
  residualRmsMm: 1,
  maxOffsetMm: 2,
  aligned: new Float32Array(3),
  ms: { fit: 1, project: 2, encode: 3 },
};

function adapter(
  faces: FaceObservation[] = fx.faces,
  overrides: Partial<Parameters<typeof analyzePhoto>[1]['adapter'] & object> = {},
) {
  return {
    loadModels: vi.fn().mockResolvedValue(undefined),
    loadCorrespondence: vi.fn().mockResolvedValue(CORR),
    detectFaces: vi.fn().mockReturnValue(faces),
    segment: vi.fn().mockReturnValue(fx.mask),
    ...overrides,
  };
}

/**
 * decodePhoto's result for fx's 640×800 analysed image, from a full-resolution photo `k` times its size,
 * so the face is k × ANALYSED_WIDTH wide at full resolution.
 */
function decodedAt(k: number) {
  const bitmap = {
    width: Math.round(fx.image.width * k),
    height: Math.round(fx.image.height * k),
    close: vi.fn(),
  };
  vi.mocked(decodePhoto).mockResolvedValue({
    canvas: document.createElement('canvas'),
    image: fx.image,
    bitmap: bitmap as unknown as ImageBitmap,
  });
  return bitmap;
}

/** cropFace as it would crop: the rect (integers) at `scale`, blank pixels. */
function cropAt(scale = 1) {
  vi.mocked(cropFace).mockImplementation((_bitmap, rect) => {
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    return { image: { width, height, data: new Uint8ClampedArray(4 * width * height) }, scale };
  });
}

beforeEach(() => {
  decodedAt(1);
  cropAt(1);
  vi.mocked(buildLikeness).mockReset();
  vi.mocked(buildLikeness).mockResolvedValue({ likeness: LIKENESS, debug: LIKENESS_DEBUG });
});

test('happy path returns schema-valid params and segments once', async () => {
  const a = adapter();
  const result = await analyzePhoto(blob, { catalog: null, adapter: a });
  expect(avatarParamsSchema.safeParse(result.params).success).toBe(true);
  expect(a.segment).toHaveBeenCalledTimes(1);
  expect(result.faceBox.width).toBeGreaterThan(GATES.minFaceWidthPx);
});

test('pickLargest picks the biggest face', () => {
  const two = synthFace({ secondFace: { scale: 3, centre: { x: 600, y: 720 } } });
  expect(pickLargest(two.faces)).toBe(two.faces[0]);
  expect(pickLargest([two.faces[1]!, two.faces[0]!])).toBe(two.faces[0]);
  expect(pickLargest([])).toBeUndefined();
});

test('no faces → no_face', async () => {
  await expect(analyzePhoto(blob, { catalog: null, adapter: adapter([]) })).rejects.toMatchObject({
    code: 'no_face',
  });
});

test('a 60 px face → face_too_small', () => {
  const small = synthFace({ scale: 60 / 15.3 }).face; // face width ≈ 60 px
  expect(() => applyGates(small)).toThrow(AnalysisError);
  try {
    applyGates(small);
  } catch (e) {
    expect((e as AnalysisError).code).toBe('face_too_small');
  }
});

test('a 40° yaw → face_turned', () => {
  const turned = synthFace({ yawDeg: 40 }).face;
  expect(() => applyGates(turned)).toThrow(/turned/);
});

test('a 25° yaw or pitch → face_turned (the gate is 20°)', () => {
  expect(GATES.maxYawDeg).toBe(20);
  expect(GATES.maxPitchDeg).toBe(20);
  for (const turned of [synthFace({ yawDeg: 25 }).face, synthFace({ pitchDeg: 25 }).face]) {
    expect(() => applyGates(turned)).toThrow(expect.objectContaining({ code: 'face_turned' }));
  }
  expect(() => applyGates(synthFace({ yawDeg: 15 }).face)).not.toThrow();
});

test('a face 200 px wide at full resolution → params with the default face and no likeness', async () => {
  decodedAt(200 / ANALYSED_WIDTH);
  const a = adapter();
  const result = await analyzePhoto(blob, { catalog: null, adapter: a });
  expect(result.likeness).toBeNull();
  expect(result.likenessGate).toBe('too_small');
  expect(result.likenessDebug).toBeNull();
  expect(result.params.face).toBe('default');
  expect(avatarParamsSchema.safeParse(result.params).success).toBe(true);
  expect(cropFace).not.toHaveBeenCalled();
  expect(buildLikeness).not.toHaveBeenCalled();
});

test('a face 300 px wide at full resolution → a likeness and the photo face', async () => {
  decodedAt(300 / ANALYSED_WIDTH);
  const a = adapter();
  const result = await analyzePhoto(blob, { catalog: null, adapter: a });
  expect(GATES.minProjectionFaceWidthPx).toBe(256);
  expect(result.likeness).toBe(LIKENESS);
  expect(result.likenessGate).toBe('ok');
  expect(result.likenessDebug).toBe(LIKENESS_DEBUG);
  expect(result.params.face).toBe('photo');
  expect(avatarParamsSchema.safeParse(result.params).success).toBe(true);
  expect(a.loadCorrespondence).toHaveBeenCalledTimes(1);
  const [input, corr] = vi.mocked(buildLikeness).mock.calls[0]!;
  expect(corr).toBe(CORR);
  expect(input.face).toBe(fx.face);
  expect(input.sourceSkin).toBe(result.params.skin);
});

test('the crop is the full-resolution face box grown 1.6×, and the landmarks and hair map into it', async () => {
  const k = 2;
  const bitmap = decodedAt(k);
  cropAt(0.5);
  await analyzePhoto(blob, { catalog: null, adapter: adapter() });

  const [croppedFrom, rect] = vi.mocked(cropFace).mock.calls[0]!;
  expect(croppedFrom).toBe(bitmap);
  const box = faceBox(toPixels(fx.face));
  const grown: Box = expandBox(
    { x: box.x * k, y: box.y * k, width: box.width * k, height: box.height * k },
    FACE_CROP.expand,
    bitmap.width,
    bitmap.height,
  );
  // Whole pixels, covering the grown box and less than a pixel larger on each side.
  for (const v of [rect.x, rect.y, rect.width, rect.height]) expect(Number.isInteger(v)).toBe(true);
  expect(rect.x).toBeLessThanOrEqual(grown.x);
  expect(rect.x).toBeGreaterThan(grown.x - 1);
  expect(rect.y).toBeLessThanOrEqual(grown.y);
  expect(rect.y).toBeGreaterThan(grown.y - 1);
  expect(rect.x + rect.width).toBeGreaterThanOrEqual(grown.x + grown.width);
  expect(rect.x + rect.width).toBeLessThan(grown.x + grown.width + 1);
  expect(rect.y + rect.height).toBeGreaterThanOrEqual(grown.y + grown.height);
  expect(rect.y + rect.height).toBeLessThan(grown.y + grown.height + 1);

  const { crop } = vi.mocked(buildLikeness).mock.calls[0]![0];
  const size = { width: Math.round(rect.width * 0.5), height: Math.round(rect.height * 0.5) };
  expect([crop.image.width, crop.image.height]).toEqual([size.width, size.height]);
  expect(crop.landmarks).toHaveLength(fx.face.landmarks.length);
  for (const i of [4, 152, 468]) {
    const l = fx.face.landmarks[i]!;
    expect(crop.landmarks[i]!.x).toBeCloseTo((l.x * bitmap.width - rect.x) * 0.5, 9);
    expect(crop.landmarks[i]!.y).toBeCloseTo((l.y * bitmap.height - rect.y) * 0.5, 9);
  }
  // The segmenter's hair, sampled into the crop, then dilated against its coarse edges.
  const full = { width: bitmap.width, height: bitmap.height };
  const sampled = maskForCrop(fx.mask, MASK.hair, rect, 0.5, full, size);
  expect(sampled.some((v) => v === 1)).toBe(true);
  expect(FACE_CROP.hairDilatePx).toBeGreaterThan(0);
  expect(crop.hair).toEqual(dilateMask(sampled, size.width, size.height, FACE_CROP.hairDilatePx));
});

test.each([
  ['a likeness', 300, adapter],
  ['the default face', 200, adapter],
  ['no_face', 300, () => adapter([])],
  ['face_too_small', 300, () => adapter([synthFace({ scale: 60 / 15.3 }).face])],
  ['face_turned', 300, () => adapter([synthFace({ yawDeg: 25 }).face])],
  [
    'a segmenter failure',
    300,
    () =>
      adapter(fx.faces, {
        segment: vi.fn().mockImplementation(() => {
          throw new Error('seg');
        }),
      }),
  ],
] as const)('the full-resolution bitmap is closed once: %s', async (_, width, make) => {
  const bitmap = decodedAt(width / ANALYSED_WIDTH);
  await analyzePhoto(blob, { catalog: null, adapter: make() }).catch(() => undefined);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

test.each([
  [
    'a head fit that is not finite',
    () =>
      vi
        .mocked(buildLikeness)
        .mockRejectedValue(new Error('buildLikeness: the head fit is not finite')),
  ],
  [
    'a crop with no 2-D context',
    () =>
      vi.mocked(cropFace).mockImplementation(() => {
        throw new Error('cropFace: no 2D context');
      }),
  ],
] as const)(
  'a likeness that fails to build (%s) → likenessGate failed, the default face, no likeness',
  async (_, fail) => {
    const bitmap = decodedAt(300 / ANALYSED_WIDTH);
    fail();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await analyzePhoto(blob, { catalog: null, adapter: adapter() });
      expect(result.likenessGate).toBe('failed');
      expect(result.likeness).toBeNull();
      expect(result.likenessDebug).toBeNull();
      expect(result.params.face).toBe('default');
      expect(avatarParamsSchema.safeParse(result.params).success).toBe(true);
      expect(bitmap.close).toHaveBeenCalledTimes(1);
      // One fixed line, which carries nothing from the photo or the error.
      expect(warn.mock.calls).toEqual([
        ["analyzePhoto: couldn't build the photo face; using the default face"],
      ]);
    } finally {
      warn.mockRestore();
    }
  },
);

test('model load failure → models', async () => {
  const a = adapter(fx.faces, { loadModels: vi.fn().mockRejectedValue(new Error('offline')) });
  await expect(analyzePhoto(blob, { catalog: null, adapter: a })).rejects.toMatchObject({
    code: 'models',
  });
});

test('a failed correspondence load → models, before the photo is decoded', async () => {
  const a = adapter(fx.faces, {
    loadCorrespondence: vi.fn().mockRejectedValue(new Error('/assets/base/correspondence.json')),
  });
  vi.mocked(decodePhoto).mockClear();
  await expect(analyzePhoto(blob, { catalog: null, adapter: a })).rejects.toMatchObject({
    code: 'models',
  });
  expect(decodePhoto).not.toHaveBeenCalled();
});

test('decode failure → decode', async () => {
  vi.mocked(decodePhoto).mockRejectedValueOnce(new DecodeError('bad'));
  await expect(analyzePhoto(blob, { catalog: null, adapter: adapter() })).rejects.toMatchObject({
    code: 'decode',
  });
});

test('messageFor maps every code to a user-facing string', () => {
  expect(messageFor('no_face')).toBe(strings.analysis.noFace);
  expect(messageFor('face_too_small')).toBe(strings.analysis.faceTooSmall);
  expect(messageFor('face_turned')).toBe(strings.analysis.faceTurned);
  expect(messageFor('decode')).toBe(strings.analysis.decodeFailed);
  expect(messageFor('models')).toBe(strings.analysis.modelsFailed);
});
