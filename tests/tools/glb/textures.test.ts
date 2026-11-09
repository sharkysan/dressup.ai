// @vitest-environment node
import { getImage, neutralizeImage, replaceImage, resizeImage } from '../../../tools/glb/textures';
import { decodePng, makeGlb, solidPng } from '../../../tools/test-fixtures/makeGlb';

test('divideByMedian lifts a skin texture to a neutral tone and keeps alpha', () => {
  const out = decodePng(neutralizeImage(solidPng(8, 8, [200, 150, 130, 255]), 'divideByMedian'));
  expect(out.data[0]).toBeCloseTo(0.85 * 255, -1);
  expect(out.data[1]).toBeCloseTo(0.85 * 255, -1);
  expect(out.data[2]).toBeCloseTo(0.85 * 255, -1);
  expect(out.data[3]).toBe(255);
});

test('luminance produces grey pixels with the median at 0.75', () => {
  const out = decodePng(neutralizeImage(solidPng(4, 4, [120, 60, 30, 255]), 'luminance'));
  expect(out.data[0]).toBe(out.data[1]);
  expect(out.data[1]).toBe(out.data[2]);
  expect(out.data[0]).toBeCloseTo(0.75 * 255, -1);
});

test('resizeImage caps the long edge and leaves small images alone', () => {
  const big = decodePng(resizeImage(solidPng(2048, 1024, [1, 2, 3, 255]), 1024));
  expect([big.width, big.height]).toEqual([1024, 512]);
  const small = solidPng(16, 8, [1, 2, 3, 255]);
  expect(resizeImage(small, 1024)).toBe(small);
});

test('replaceImage swaps bytes for a named image', () => {
  const doc = makeGlb();
  const png = solidPng(2, 2, [9, 9, 9, 255]);
  replaceImage(doc, 'Body_00', png);
  expect(Buffer.from(getImage(doc, 'Body_00')).equals(Buffer.from(png))).toBe(true);
  expect(() => getImage(doc, 'Nope')).toThrow(/Nope/);
});
