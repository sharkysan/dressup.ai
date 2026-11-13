import {
  andMasks,
  categoryEquals,
  countOnes,
  coverage,
  dilateMask,
  expandBox,
  lowestRow,
  maskForCrop,
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

test('maskForCrop maps a hair quadrant to the matching quadrant of the crop', () => {
  // A 4×4 mask over a 400×400 photo, hair (1) in its top-right quadrant, the rest face skin (3).
  const data = new Uint8Array(16).fill(3);
  for (const i of [2, 3, 6, 7]) data[i] = 1;
  const mask = { width: 4, height: 4, data };
  // The crop is the photo's centre 200×200 at half scale: the mask's middle 2×2 cells, one hair.
  const crop = { width: 100, height: 100 };
  const rect = { x: 100, y: 100, width: 200, height: 200 };
  const out = maskForCrop(mask, 1, rect, 0.5, { width: 400, height: 400 }, crop);
  expect(out).toHaveLength(crop.width * crop.height);
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      expect(out[y * crop.width + x], `(${x}, ${y})`).toBe(x >= 50 && y < 50 ? 1 : 0);
    }
  }
});

test('maskForCrop samples nearest and clamps at the photo edge', () => {
  // One column of hair at the mask's right edge; the crop reaches it only in its last column.
  const mask = { width: 4, height: 1, data: new Uint8Array([0, 0, 0, 1]) };
  const out = maskForCrop(
    mask,
    1,
    { x: 280, y: 0, width: 120, height: 10 },
    1,
    { width: 400, height: 10 },
    { width: 120, height: 10 },
  );
  // Crop columns 0..19 are photo x 280..299 (mask cell 2), 20..119 are 300..399 (cell 3).
  expect(Array.from(out.subarray(0, 120)).indexOf(1)).toBe(20);
  expect(out.subarray(0, 120).every((v, x) => v === (x >= 20 ? 1 : 0))).toBe(true);
});

test('dilateMask grows each set pixel into a square of side 2r + 1, clipped to the image', () => {
  const width = 9;
  const height = 7;
  const mask = new Uint8Array(width * height);
  mask[3 * width + 4] = 1; // (4, 3)
  mask[0] = 1; // (0, 0)
  const out = dilateMask(mask, width, height, 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const near = (Math.abs(x - 4) <= 2 && Math.abs(y - 3) <= 2) || (x <= 2 && y <= 2);
      expect(out[y * width + x], `(${x}, ${y})`).toBe(near ? 1 : 0);
    }
  }
  expect(mask[1]).toBe(0); // the input is left alone
  expect(dilateMask(mask, width, height, 0)).toEqual(mask);
});
