import { defaultParams } from '../../src/catalog/params';
import type { Likeness } from '../../src/likeness/types';
import { useAppStore } from '../../src/store/useAppStore';

const likeness: Likeness = {
  version: 1,
  faceTexture: new Blob([new Uint8Array([1])], { type: 'image/webp' }),
  headOffsets: new Float32Array(6),
  sourceSkin: '#c68642',
};

beforeEach(() => {
  useAppStore.getState().reset();
});

test('starts with defaultParams and loading status', () => {
  const s = useAppStore.getState();
  expect(s.params).toEqual(defaultParams);
  expect(s.avatarStatus).toBe('loading');
  expect(s.avatarError).toBeNull();
});

test('setParams merges a patch', () => {
  useAppStore.getState().setParams({ skin: '#112233' });
  expect(useAppStore.getState().params.skin).toBe('#112233');
  expect(useAppStore.getState().params.hairColor).toBe(defaultParams.hairColor);
});

test('setting full removes top and bottom (spec §5)', () => {
  const s = useAppStore.getState();
  s.setOutfitItem('top', { id: 'tee_01' });
  s.setOutfitItem('bottom', { id: 'jeans_01' });
  s.setOutfitItem('full', { id: 'dress_01' });
  expect(useAppStore.getState().params.outfit).toEqual({ full: { id: 'dress_01' } });
});

test('setting top or bottom removes full', () => {
  const s = useAppStore.getState();
  s.setOutfitItem('full', { id: 'dress_01' });
  s.setOutfitItem('top', { id: 'tee_01' });
  expect(useAppStore.getState().params.outfit).toEqual({ top: { id: 'tee_01' } });
});

test('setOutfitItem with null clears the slot', () => {
  const s = useAppStore.getState();
  s.setOutfitItem('shoes', { id: 'sneaker_01' });
  s.setOutfitItem('shoes', null);
  expect(useAppStore.getState().params.outfit.shoes).toBeUndefined();
});

test('setAvatarStatus error stores the message; ready clears it', () => {
  const s = useAppStore.getState();
  s.setAvatarStatus('error', 'boom');
  expect(useAppStore.getState().avatarError).toBe('boom');
  s.setAvatarStatus('ready');
  expect(useAppStore.getState().avatarError).toBeNull();
});

test('clearing an empty exclusive slot leaves the worn counterpart alone', () => {
  const s = useAppStore.getState();
  s.setOutfitItem('full', { id: 'dress_01' });
  s.setOutfitItem('top', null);
  expect(useAppStore.getState().params.outfit).toEqual({ full: { id: 'dress_01' } });
});

test('setAvatarMetrics stores head height and overall height; reset clears them', () => {
  useAppStore.getState().setAvatarMetrics({ headY: 1.42, height: 1.6 });
  expect(useAppStore.getState().avatarMetrics).toEqual({ headY: 1.42, height: 1.6 });
  useAppStore.getState().reset();
  expect(useAppStore.getState().avatarMetrics).toBeNull();
});

test('starts without a likeness', () => {
  expect(useAppStore.getState().likeness).toBeNull();
});

test('setLikeness sets the likeness and the photo face; null the default face', () => {
  useAppStore.getState().setParams({ skin: '#112233' });
  useAppStore.getState().setLikeness(likeness);
  expect(useAppStore.getState().likeness).toBe(likeness);
  expect(useAppStore.getState().params.face).toBe('photo');
  expect(useAppStore.getState().params.skin).toBe('#112233');
  useAppStore.getState().setLikeness(null);
  expect(useAppStore.getState().likeness).toBeNull();
  expect(useAppStore.getState().params.face).toBe('default');
});

test('reset clears the likeness', () => {
  useAppStore.getState().setLikeness(likeness);
  useAppStore.getState().reset();
  expect(useAppStore.getState().likeness).toBeNull();
  expect(useAppStore.getState().params.face).toBe('default');
});
