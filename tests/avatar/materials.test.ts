import { mixHex } from '../../src/avatar/materials';

test('mixHex interpolates in OKLab and returns hex', () => {
  expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
  expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  const mid = mixHex('#000000', '#ffffff', 0.5);
  expect(mid).toMatch(/^#[0-9a-f]{6}$/);
});
