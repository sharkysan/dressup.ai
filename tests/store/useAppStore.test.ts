import { defaultParams } from '../../src/catalog/params';
import { useAppStore } from '../../src/store/useAppStore';

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
