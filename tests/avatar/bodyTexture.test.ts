import { composeBodyAlbedo } from '../../src/avatar/bodyTexture';

/** A 2×1 RGBA image (no canvas needed: composeBodyAlbedo only reads data, width and height). */
const image = (a: number[], b: number[]) => ({
  data: new Uint8ClampedArray([...a, ...b]),
  width: 2,
  height: 1,
});
const skin = image([200, 100, 50, 255], [200, 100, 50, 255]);
const clear = image([0, 0, 0, 0], [0, 0, 0, 0]);
const pixel = (out: { data: Uint8ClampedArray }, i: number) => [
  ...out.data.slice(i * 4, i * 4 + 4),
];

test('a clear base layer under a white tint leaves the skin as it is, opaque', () => {
  const out = composeBodyAlbedo(skin, clear, '#ffffff');
  expect(pixel(out, 0)).toEqual([200, 100, 50, 255]);
  expect(pixel(out, 1)).toEqual([200, 100, 50, 255]);
});

test('the tint multiplies the skin', () => {
  const [r, g, b, a] = pixel(composeBodyAlbedo(skin, clear, '#808080'), 0);
  expect(Math.abs(r! - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(g! - 50)).toBeLessThanOrEqual(1);
  expect(Math.abs(b! - 25)).toBeLessThanOrEqual(1);
  expect(a).toBe(255);
});

test('an opaque base-layer texel shows exactly its own colour, whatever the tint', () => {
  const layer = image([233, 230, 225, 255], [0, 0, 0, 0]);
  for (const tint of ['#ffffff', '#5a3a24', '#000000']) {
    const out = composeBodyAlbedo(skin, layer, tint);
    expect(pixel(out, 0), tint).toEqual([233, 230, 225, 255]);
  }
  expect(pixel(composeBodyAlbedo(skin, layer, '#000000'), 1)).toEqual([0, 0, 0, 255]);
});

test('a half-transparent base-layer texel lands halfway between the tinted skin and itself', () => {
  const layer = image([0, 200, 250, 128], [0, 0, 0, 0]);
  const [r, g, b, a] = pixel(composeBodyAlbedo(skin, layer, '#ffffff'), 0);
  expect(Math.abs(r! - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(g! - 150)).toBeLessThanOrEqual(1);
  expect(Math.abs(b! - 150)).toBeLessThanOrEqual(1);
  expect(a).toBe(255);
});

test('writes into a given output and leaves the inputs untouched', () => {
  const layer = image([233, 230, 225, 255], [0, 0, 0, 0]);
  const out = image([1, 2, 3, 4], [5, 6, 7, 8]);
  expect(composeBodyAlbedo(skin, layer, '#808080', out)).toBe(out);
  expect(pixel(out, 0)).toEqual([233, 230, 225, 255]);
  expect(pixel(skin, 0)).toEqual([200, 100, 50, 255]);
  expect(pixel(layer, 0)).toEqual([233, 230, 225, 255]);
});

test('rejects images of different sizes', () => {
  const wide = { data: new Uint8ClampedArray(16), width: 4, height: 1 };
  expect(() => composeBodyAlbedo(skin, wide, '#ffffff')).toThrow(/size/);
});
