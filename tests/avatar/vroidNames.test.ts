import {
  isBrowMaterial,
  isHairMaterial,
  isIrisMaterial,
  isMouthMaterial,
  isSkinMaterial,
} from '../../src/avatar/vroidNames';

test('matches clean VRoid names', () => {
  expect(isSkinMaterial('Body_00_SKIN')).toBe(true);
  expect(isSkinMaterial('Face_00_SKIN')).toBe(true);
  expect(isIrisMaterial('EyeIris_00_EYE')).toBe(true);
  expect(isMouthMaterial('FaceMouth_00_FACE')).toBe(true);
  expect(isBrowMaterial('FaceBrow_00_FACE')).toBe(true);
  expect(isHairMaterial('Hair_00_HAIR')).toBe(true);
  expect(isHairMaterial('HairBack_00_HAIR')).toBe(true);
});

test('matches prefixed/suffixed VRoid Studio export names', () => {
  expect(isSkinMaterial('N00_000_00_Body_00_SKIN (Instance)')).toBe(true);
  expect(isIrisMaterial('N00_000_00_EyeIris_00_EYE (Instance)')).toBe(true);
  expect(isMouthMaterial('N00_000_00_FaceMouth_00_FACE (Instance)')).toBe(true);
  expect(isHairMaterial('N00_000_Hair_00_HAIR_01 (Instance)')).toBe(true);
});

test('matches non-VRoid hair naming and rejects look-alikes', () => {
  expect(isHairMaterial('hair')).toBe(true);
  expect(isHairMaterial('hair_tail')).toBe(true);
  expect(isHairMaterial('Tops_01_CLOTH')).toBe(false);
  expect(isSkinMaterial('Body_00_SKINNY')).toBe(false);
  expect(isIrisMaterial('EyeWhite_00_EYE')).toBe(false);
});
