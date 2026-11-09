import { medianColorTrimmed, nearestEyeColor } from '../../src/analysis/color';
import type { RgbaImage } from '../../src/analysis/types';

function patch(
  w: number,
  h: number,
  rgb: [number, number, number],
): { image: RgbaImage; mask: Uint8Array } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { image: { width: w, height: h, data }, mask: new Uint8Array(w * h).fill(1) };
}

test('trimmed median of a uniform patch returns that colour', () => {
  const { image, mask } = patch(10, 10, [198, 134, 66]);
  expect(medianColorTrimmed(image, mask)).toBe('#c68642');
});

test('specular highlights are trimmed away', () => {
  const { image, mask } = patch(10, 10, [198, 134, 66]);
  for (let i = 0; i < 15; i++) image.data.set([255, 255, 255, 255], i * 4);
  expect(medianColorTrimmed(image, mask)).toBe('#c68642');
});

test('returns null for fewer than 20 pixels', () => {
  const { image, mask } = patch(4, 4, [1, 2, 3]);
  expect(medianColorTrimmed(image, mask)).toBeNull();
});

test('nearestEyeColor snaps to the presets', () => {
  expect(nearestEyeColor('#4a76b0')).toBe('blue');
  expect(nearestEyeColor('#3b2314')).toBe('darkBrown');
  expect(nearestEyeColor('#5e8a50')).toBe('green');
});
