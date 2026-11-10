import type { VRM } from '@pixiv/three-vrm';
import { act, render } from '@testing-library/react';
import { Group } from 'three';
import { applyParams } from '../../src/avatar/applyParams';
import { AvatarModel } from '../../src/avatar/AvatarModel';
import type { BaseMeta } from '../../src/avatar/baseContract';
import { useAppStore } from '../../src/store/useAppStore';

// AvatarModel's loads, textures and the R3F frame loop, stubbed: the test is about when params apply.
vi.mock('@react-three/fiber', () => ({ useFrame: () => undefined }));
vi.mock('../../src/avatar/loadVrm', () => ({ loadVrm: vi.fn() }));
vi.mock('../../src/avatar/HairModel', () => ({ HairModel: () => null }));
vi.mock('../../src/avatar/applyParams', () => ({ applyParams: vi.fn() }));
vi.mock('../../src/avatar/bodyTexture', () => ({
  loadImageData: () => Promise.resolve({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
  SkinTexture: class {
    dispose() {}
  },
}));
vi.mock('../../src/avatar/baseMaterials', () => ({
  standardMaterial: () => ({ map: { image: {}, dispose() {} }, roughness: 0.5 }),
  EyeTextures: class {
    dispose() {}
  },
}));

const { loadVrm } = await import('../../src/avatar/loadVrm');

const meta: BaseMeta = {
  version: 1,
  heightM: 1.65,
  minY: 0,
  morphHeightDelta: {},
  morphMinYDelta: {},
};

beforeEach(() => {
  useAppStore.getState().reset();
  vi.mocked(applyParams).mockClear();
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
