import { extractBrows } from '../../src/analysis/mapping/brows';
import { toPixels } from '../../src/analysis/landmarks';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

test('canonical brows give a valid shape and thickness in range', () => {
  const b = extractBrows(toPixels(synthFace().face));
  expect(['straight', 'arched', 'soft', 'angled']).toContain(b.shape);
  expect(b.thickness).toBeGreaterThanOrEqual(0);
  expect(b.thickness).toBeLessThanOrEqual(1);
});

test('lifting the middle of the brow makes it arched', () => {
  expect(extractBrows(toPixels(synthFace({ browLift: { amount: 0.2 } }).face)).shape).toBe(
    'arched',
  );
});

test('lifting only the outer point makes it angled', () => {
  expect(
    extractBrows(toPixels(synthFace({ browLift: { amount: 0.12, outerOnly: true } }).face)).shape,
  ).toBe('angled');
});
