import { describe, expect, it } from 'vitest';
import calibrationJson from '../../src/analysis/body-calibration.json';
import {
  bodyCalibrationSchema,
  CALIBRATED_MORPHS,
  estimateMorphs,
  type BodyCalibration,
} from '../../src/analysis/body/estimate';
import type { BodyFeatures } from '../../src/analysis/body/measure';
import holdout from '../fixtures/body-holdout.json';

const samples = holdout.samples as {
  gender: number;
  features: BodyFeatures;
  truth: Record<(typeof CALIBRATED_MORPHS)[number], number>;
}[];

describe('the shipped body calibration (spec §6, §15)', () => {
  const parsed = bodyCalibrationSchema.safeParse(calibrationJson);
  const cal = parsed.data as BodyCalibration;

  it('parses', () => {
    expect(parsed.error).toBeUndefined();
    expect(cal.holdout.n).toBe(samples.length);
    expect(samples.length).toBeGreaterThan(0);
  });

  it('records the held-out maximum error of each morph', () => {
    const max = Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, 0]));
    for (const s of samples) {
      const estimate = estimateMorphs(s.features, s.gender, cal);
      for (const m of CALIBRATED_MORPHS) {
        max[m] = Math.max(max[m]!, Math.abs(estimate[m] - s.truth[m]));
      }
    }
    for (const m of CALIBRATED_MORPHS) {
      expect(Math.abs(max[m]! - cal.holdout.maxAbsError[m]), m).toBeLessThanOrEqual(1e-9);
    }
  });
});
