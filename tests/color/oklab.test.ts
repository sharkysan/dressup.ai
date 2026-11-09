import { hexToOklab, oklabToHex, shadeFor } from '../../src/color/oklab';

function channels(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

test('round-trips a colour within ±1 per channel', () => {
  const back = oklabToHex(hexToOklab('#c68642'));
  const a = channels('#c68642');
  const b = channels(back);
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(1);
});

test('shadeFor is darker by ~0.18 L and a valid lowercase hex', () => {
  const shade = shadeFor('#c68642');
  expect(shade).toMatch(/^#[0-9a-f]{6}$/);
  expect(hexToOklab('#c68642').L - hexToOklab(shade).L).toBeCloseTo(0.18, 1);
});

test('oklabToHex clamps out-of-gamut values', () => {
  expect(oklabToHex({ L: 1.5, a: 0.5, b: -0.5 })).toMatch(/^#[0-9a-f]{6}$/);
  expect(oklabToHex({ L: -1, a: 0, b: 0 })).toBe('#000000');
});
