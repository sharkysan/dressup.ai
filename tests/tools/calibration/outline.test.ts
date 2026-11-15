import { describe, expect, it } from 'vitest';
import { BODY_FEATURES, type BodyFeatures } from '../../../src/analysis/body/measure';
import { outlineError, OUTLINE_TOLERANCE, spread } from '../../../tools/calibration/outline';
import { mulberry32 } from '../../../tools/calibration/ridge';

/** `n` feature sets, each ratio uniform in 0.1..0.3. */
function featureSets(n: number, seed: number): BodyFeatures[] {
  const rand = mulberry32(seed);
  return Array.from(
    { length: n },
    () => Object.fromEntries(BODY_FEATURES.map((f) => [f, 0.1 + 0.2 * rand()])) as BodyFeatures,
  );
}

const features = featureSets(12, 7);

describe('spread', () => {
  it('is the population standard deviation (÷ n) of each ratio', () => {
    const sd = spread([
      { ...features[0]!, waistWidth: 0.1 },
      { ...features[1]!, waistWidth: 0.3 },
    ]);
    expect(sd.waistWidth).toBeCloseTo(0.1, 15);
    expect(Object.keys(sd)).toEqual([...BODY_FEATURES]);
  });

  it('throws on no samples, and names a ratio that does not vary', () => {
    expect(() => spread([])).toThrow(/no samples/);
    expect(() => spread(features.map((f) => ({ ...f, calfWidth: 0.05 })))).toThrow(/calfWidth/);
  });
});

describe('outlineError', () => {
  const sd = spread(features);
  const mean = Object.fromEntries(
    BODY_FEATURES.map((f) => [f, features.reduce((s, x) => s + x[f], 0) / features.length]),
  ) as BodyFeatures;

  it('the tolerance is half the spread', () => {
    expect(OUTLINE_TOLERANCE).toBe(0.5);
  });

  it('is 0 for every ratio when the re-render measures as the original', () => {
    const error = outlineError(features.map((f) => ({ features: f, reprojected: { ...f } })));
    for (const f of BODY_FEATURES) expect(error[f], f).toBe(0);
  });

  it('is 1 for every ratio when every re-render measures as the held-out mean', () => {
    const error = outlineError(features.map((f) => ({ features: f, reprojected: mean })));
    for (const f of BODY_FEATURES) expect(Math.abs(error[f] - 1), f).toBeLessThanOrEqual(1e-12);
  });

  it('is 0.5 for a ratio off by half its spread, and 0 for the rest', () => {
    const error = outlineError(
      features.map((f) => ({
        features: f,
        reprojected: { ...f, hipWidth: f.hipWidth + 0.5 * sd.hipWidth },
      })),
    );
    for (const f of BODY_FEATURES) {
      expect(Math.abs(error[f] - (f === 'hipWidth' ? 0.5 : 0)), f).toBeLessThanOrEqual(1e-12);
    }
  });

  it('throws when a ratio of the originals has no spread', () => {
    const flat = features.map((f) => ({ ...f, armLength: 0.4 }));
    expect(() => outlineError(flat.map((f) => ({ features: f, reprojected: f })))).toThrow(
      /armLength/,
    );
  });
});
