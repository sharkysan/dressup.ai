import {
  AnalysisError,
  analyzePhoto,
  applyGates,
  GATES,
  messageFor,
  pickLargest,
} from '../../src/analysis/analyze';
import { DecodeError } from '../../src/analysis/image';
import type { FaceObservation } from '../../src/analysis/types';
import { avatarParamsSchema } from '../../src/catalog/params';
import { strings } from '../../src/ui/strings';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

vi.mock('../../src/analysis/image', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/analysis/image')>();
  return { ...mod, decodePhoto: vi.fn() };
});
import { decodePhoto } from '../../src/analysis/image';

const fx = synthFace();
const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

function adapter(
  faces: FaceObservation[] = fx.faces,
  overrides: Partial<Parameters<typeof analyzePhoto>[1]['adapter'] & object> = {},
) {
  return {
    loadModels: vi.fn().mockResolvedValue(undefined),
    detectFaces: vi.fn().mockReturnValue(faces),
    segment: vi.fn().mockReturnValue(fx.mask),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(decodePhoto).mockResolvedValue({
    canvas: document.createElement('canvas'),
    image: fx.image,
  });
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

test('model load failure → models', async () => {
  const a = adapter(fx.faces, { loadModels: vi.fn().mockRejectedValue(new Error('offline')) });
  await expect(analyzePhoto(blob, { catalog: null, adapter: a })).rejects.toMatchObject({
    code: 'models',
  });
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
