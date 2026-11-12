import type { VRM } from '@pixiv/three-vrm';
import { act, render } from '@testing-library/react';
import { Group } from 'three';
import { applyParams } from '../../src/avatar/applyParams';
import { AvatarModel } from '../../src/avatar/AvatarModel';
import type { BaseMeta } from '../../src/avatar/baseContract';
import { decodeImageData, type FaceComposite } from '../../src/avatar/bodyTexture';
import { HairModel } from '../../src/avatar/HairModel';
import type { Correspondence } from '../../src/likeness/correspondence';
import { applyLikeness } from '../../src/likeness/likenessMorph';
import type { Likeness } from '../../src/likeness/types';
import { useAppStore } from '../../src/store/useAppStore';

// AvatarModel's loads, textures and the R3F frame loop, stubbed: the test is about when params apply.
vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined }));
vi.mock('../../src/avatar/loadVrm', () => ({ loadVrm: vi.fn() }));
vi.mock('../../src/avatar/HairModel', () => ({ HairModel: vi.fn(() => null) }));
vi.mock('../../src/avatar/applyParams', () => ({ applyParams: vi.fn() }));
vi.mock('../../src/avatar/bodyTexture', () => ({
  loadImageData: () => Promise.resolve({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
  decodeImageData: vi.fn(),
  SkinTexture: class {
    dispose() {}
  },
}));
vi.mock('../../src/likeness/correspondence', () => ({
  loadCorrespondence: vi.fn(() => Promise.resolve(CORR)),
}));
vi.mock('../../src/likeness/likenessMorph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/likeness/likenessMorph')>()),
  applyLikeness: vi.fn(),
}));
vi.mock('../../src/avatar/baseMaterials', () => ({
  standardMaterial: () => ({ map: { image: {}, dispose() {} }, roughness: 0.5 }),
  EyeTextures: class {
    dispose() {}
  },
}));

const { loadVrm } = await import('../../src/avatar/loadVrm');

/** A 3-vertex Body whose head is vertices 0 and 2. Only what AvatarModel reads is filled in. */
const CORR = {
  bodyVertexCount: 3,
  head: { vertices: [0, 2], weights: [1, 1], positions: [0, 0, 0, 0, 0, 0] },
  faceUvRect: { u: 0.7, v: 0.3, size: 0.25 },
} as unknown as Correspondence;

const likenessA: Likeness = {
  version: 1,
  faceTexture: new Blob([new Uint8Array([1])], { type: 'image/webp' }),
  headOffsets: new Float32Array([1, 2, 3, 4, 5, 6]),
  sourceSkin: '#aa7755',
};
const likenessB: Likeness = {
  version: 1,
  faceTexture: new Blob([new Uint8Array([2])], { type: 'image/png' }),
  headOffsets: new Float32Array([-1, -2, -3, -4, -5, -6]),
  sourceSkin: '#886644',
};
/** Each likeness's headOffsets at its Body vertices (0 and 2) of 3. */
const FULL_A = new Float32Array([1, 2, 3, 0, 0, 0, 4, 5, 6]);
const FULL_B = new Float32Array([-1, -2, -3, 0, 0, 0, -4, -5, -6]);
const pixelsOf = (likeness: Likeness) =>
  ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([likeness === likenessA ? 1 : 2, 0, 0, 255]),
  }) as ImageData;

/** The ctx.face of each applyParams call, at the time of the call (the ctx object is reused). */
let faces: (FaceComposite | null)[] = [];

const lastApplied = () => vi.mocked(applyLikeness).mock.calls.at(-1);
const hairOffsets = () => vi.mocked(HairModel).mock.calls.at(-1)?.[0].likenessOffsets;

function expectShowing(likeness: Likeness | null, full: Float32Array | null) {
  expect(lastApplied()?.[1] ?? null).toEqual(full);
  expect(faces.at(-1)).toEqual(
    likeness && {
      pixels: pixelsOf(likeness),
      sourceSkin: likeness.sourceSkin,
      rect: CORR.faceUvRect,
    },
  );
  expect(hairOffsets() ?? null).toEqual(full);
}

const meta: BaseMeta = {
  version: 1,
  heightM: 1.65,
  minY: 0,
  morphHeightDelta: {},
  morphMinYDelta: {},
};

beforeEach(() => {
  useAppStore.getState().reset();
  faces = [];
  vi.mocked(applyParams).mockReset();
  vi.mocked(applyParams).mockImplementation((_vrm, _params, ctx) => void faces.push(ctx.face));
  vi.mocked(applyLikeness).mockReset();
  vi.mocked(HairModel).mockClear();
  vi.mocked(decodeImageData).mockReset();
  vi.mocked(decodeImageData).mockImplementation((blob) =>
    Promise.resolve(pixelsOf(blob === likenessA.faceTexture ? likenessA : likenessB)),
  );
  vi.mocked(loadVrm).mockResolvedValue({
    scene: new Group(),
    humanoid: null,
    update: () => undefined,
  } as unknown as VRM);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(meta)))),
  );
  // React DOM does not know R3F's <primitive>; the warning is noise here.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('params set as the avatar becomes ready, before the store subscription exists, are applied', async () => {
  // As an e2e case or an analysis result does: set params the moment the status turns ready. That is
  // after prepare() applied the params it read and before the effect that subscribes to the store runs.
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.avatarStatus === 'ready' && previous.avatarStatus !== 'ready') {
      state.setParams({ skin: '#123456' });
    }
  });
  try {
    await act(async () => {
      render(<AvatarModel url="/base.vrm" />);
    });
  } finally {
    unsubscribe();
  }

  expect(useAppStore.getState().avatarStatus).toBe('ready');
  const applied = vi.mocked(applyParams).mock.calls.map(([, params]) => params.skin);
  expect(applied.at(-1)).toBe('#123456');
});

test('later changes apply once each, and an unchanged store applies nothing again', async () => {
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  expect(applyParams).toHaveBeenCalledTimes(1); // prepare()

  act(() => useAppStore.getState().setParams({ skin: '#222222' }));
  act(() => useAppStore.getState().setAvatarMetrics(null));

  const applied = vi.mocked(applyParams).mock.calls.map(([, params]) => params.skin);
  expect(applied).toEqual([useAppStore.getInitialState().params.skin, '#222222']);
});

test('a likeness set before load is shown once the avatar is ready', async () => {
  act(() => useAppStore.getState().setLikeness(likenessA));
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  expect(applyLikeness).toHaveBeenCalledTimes(1);
  expect(lastApplied()![0]).toBe(vi.mocked(applyParams).mock.calls[0]![0].scene);
  expectShowing(likenessA, FULL_A);
});

test('a likeness set after load is shown: offsets, face composite and the hair', async () => {
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  expect(applyLikeness).not.toHaveBeenCalled();
  expect(faces).toEqual([null]);
  await act(async () => useAppStore.getState().setLikeness(likenessA));
  expectShowing(likenessA, FULL_A);
  expect(vi.mocked(applyParams).mock.calls.at(-1)![1]).toBe(useAppStore.getState().params);
});

test('a newer likeness replacing one mid-decode wins', async () => {
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  let finishA!: () => void;
  vi.mocked(decodeImageData).mockImplementationOnce(
    () => new Promise((resolve) => (finishA = () => resolve(pixelsOf(likenessA)))),
  );
  await act(async () => useAppStore.getState().setLikeness(likenessA));
  await act(async () => useAppStore.getState().setLikeness(likenessB));
  expectShowing(likenessB, FULL_B);
  await act(async () => finishA());
  expectShowing(likenessB, FULL_B);
  expect(vi.mocked(applyLikeness).mock.calls.map(([, full]) => full)).toEqual([FULL_B]);
});

test('clearing the likeness during a decode shows the default face', async () => {
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  await act(async () => useAppStore.getState().setLikeness(likenessA));
  let finishB!: () => void;
  vi.mocked(decodeImageData).mockImplementationOnce(
    () => new Promise((resolve) => (finishB = () => resolve(pixelsOf(likenessB)))),
  );
  await act(async () => useAppStore.getState().setLikeness(likenessB));
  await act(async () => useAppStore.getState().setLikeness(null));
  await act(async () => finishB());
  expectShowing(null, null);
  expect(useAppStore.getState().params.face).toBe('default');
});

test('params changes reuse the one face composite of a likeness', async () => {
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  await act(async () => useAppStore.getState().setLikeness(likenessA));
  const face = faces.at(-1);
  act(() => useAppStore.getState().setParams({ skin: '#222222' }));
  act(() => useAppStore.getState().setParams({ skin: '#333333' }));
  expect(faces.slice(-3)).toEqual([face, face, face]);
  expect(faces.at(-1)).toBe(face);
  expect(faces.at(-2)).toBe(face);
});

test('a likeness that does not fit the base warns and shows the default face', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await act(async () => {
    render(<AvatarModel url="/base.vrm" />);
  });
  await act(async () => useAppStore.getState().setLikeness(likenessA));
  const wrong = { ...likenessB, headOffsets: new Float32Array(9) };
  await act(async () => useAppStore.getState().setLikeness(wrong));
  expectShowing(null, null);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]![0])).toMatch(/default face/);
});
