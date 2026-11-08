import { computeExportSize } from '../../src/export/exportSize';

test('doubles CSS size by default', () => {
  expect(computeExportSize(390, 844)).toEqual({ width: 780, height: 1688 });
});

test('caps the long edge at 2048 keeping aspect', () => {
  expect(computeExportSize(1600, 900)).toEqual({ width: 2048, height: 1152 });
});

test('caps a portrait long edge', () => {
  expect(computeExportSize(900, 1600)).toEqual({ width: 1152, height: 2048 });
});

test('respects custom scale and cap', () => {
  expect(computeExportSize(100, 50, { scale: 3, maxLongEdge: 240 })).toEqual({
    width: 240,
    height: 120,
  });
});

test('rounds to integers', () => {
  expect(computeExportSize(333, 111)).toEqual({ width: 666, height: 222 });
});
