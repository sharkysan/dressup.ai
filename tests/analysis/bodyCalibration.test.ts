import { describe, expect, it } from 'vitest';
import calibrationJson from '../../src/analysis/body-calibration.json';
import {
  bodyCalibrationSchema,
  CALIBRATED_MORPHS,
  estimateMorphs,
  type BodyCalibration,
  type CalibratedMorph,
} from '../../src/analysis/body/estimate';
import { BODY_FEATURES, type BodyFeatures } from '../../src/analysis/body/measure';
import { outlineError, OUTLINE_TOLERANCE } from '../../tools/calibration/outline';
import holdout from '../fixtures/body-holdout.json';

/**
 * Each held-out render: its gender, its features, the morphs it was rendered with, the shipped
 * calibration's estimate, and the features of the estimate's render.
 */
const samples = holdout.samples as {
  gender: number;
  features: BodyFeatures;
  truth: Record<CalibratedMorph, number>;
  estimate: Record<CalibratedMorph, number>;
  reprojected: BodyFeatures;
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

  it('the shipped coefficients give the fixture’s estimates', () => {
    samples.forEach((s, i) => {
      const estimate = estimateMorphs(s.features, s.gender, cal);
      for (const m of CALIBRATED_MORPHS) {
        expect(Math.abs(estimate[m] - s.estimate[m]), `sample ${i} ${m}`).toBeLessThanOrEqual(1e-9);
      }
    });
  });

  it('records the held-out outline error', () => {
    const error = outlineError(samples);
    for (const f of BODY_FEATURES) {
      expect(Math.abs(error[f] - cal.holdout.outlineError[f]), f).toBeLessThanOrEqual(1e-9);
    }
  });

  it('reproduces every ratio of the held-out renders within half its spread', () => {
    const error = outlineError(samples);
    const over = BODY_FEATURES.filter((f) => !(error[f] <= OUTLINE_TOLERANCE)).map(
      (f) => `${f}: ${error[f].toFixed(3)}`,
    );
    expect(over).toEqual([]);
  });
});
