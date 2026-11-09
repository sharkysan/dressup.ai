import {
  andMasks,
  categoryEquals,
  countOnes,
  coverage,
  expandBox,
  lowestRow,
  resampleMask,
  restrictToBox,
} from '../../src/analysis/masks';

test('categoryEquals picks one class', () => {
  const out = categoryEquals({ width: 2, height: 2, data: new Uint8Array([0, 1, 3, 1]) }, 1);
  expect(Array.from(out)).toEqual([0, 1, 0, 1]);
});

test('resampleMask keeps quadrants when upscaling a 2×2 checker to 4×4', () => {
  const out = resampleMask(new Uint8Array([1, 0, 0, 1]), 2, 2, 4, 4);
  expect(Array.from(out)).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
});

test('restrictToBox zeroes everything outside the box', () => {
  const out = restrictToBox(new Uint8Array(16).fill(1), 4, 4, { x: 1, y: 1, width: 2, height: 2 });
  expect(countOnes(out)).toBe(4);
  expect(out[5]).toBe(1);
  expect(out[0]).toBe(0);
});

test('andMasks and countOnes', () => {
  expect(countOnes(andMasks(new Uint8Array([1, 1, 0]), new Uint8Array([1, 0, 0])))).toBe(1);
});

test('lowestRow returns the bottom-most set row, -1 when empty', () => {
  expect(lowestRow(new Uint8Array([0, 0, 1, 0, 0, 0, 0, 0, 0]), 3, 3)).toBe(0);
  expect(lowestRow(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 1]), 3, 3)).toBe(2);
  expect(lowestRow(new Uint8Array(9), 3, 3)).toBe(-1);
});

test('coverage of a half-filled box is 0.5', () => {
  const m = new Uint8Array(16);
  for (let i = 0; i < 8; i++) m[i] = 1; // top two rows
  expect(coverage(m, 4, 4, { x: 0, y: 0, width: 4, height: 4 })).toBeCloseTo(0.5);
});

test('expandBox grows about the centre and clamps to the image', () => {
  const b = expandBox({ x: 40, y: 40, width: 20, height: 20 }, 2, 100, 100);
  expect(b).toEqual({ x: 30, y: 30, width: 40, height: 40 });
  const c = expandBox({ x: 0, y: 0, width: 20, height: 20 }, 3, 100, 100);
  expect(c.x).toBe(0);
  expect(c.y).toBe(0);
});
