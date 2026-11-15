import { describe, expect, it } from 'vitest';
import {
  bodyCalibrationSchema,
  CALIBRATED_MORPHS,
  designLength,
  designRow,
  estimateMorphs,
  type BodyCalibration,
} from '../../src/analysis/body/estimate';
import { BODY_FEATURES, type BodyFeatures } from '../../src/analysis/body/measure';

const features = Object.fromEntries(
  BODY_FEATURES.map((f, i) => [f, 0.1 * (i + 1)]),
) as BodyFeatures;
const zeroAllowance = {
  shoulderWidth: 0,
  bustWidth: 0,
  waistWidth: 0,
  hipWidth: 0,
  thighWidth: 0,
  calfWidth: 0,
  upperArmWidth: 0,
};

function calibration(degree: 1 | 2, intercept = 0): BodyCalibration {
  const len = 1 + designLength(degree);
  return {
    version: 1,
    degree,
    features: [...BODY_FEATURES],
    allowance: { ...zeroAllowance },
    mean: new Array(11).fill(0),
    scale: new Array(11).fill(1),
    coefficients: Object.fromEntries(
      CALIBRATED_MORPHS.map((m) => [m, [intercept, ...new Array(len - 1).fill(0)]]),
    ) as BodyCalibration['coefficients'],
    holdout: {
      n: 1,
      maxAbsError: Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, 0])) as never,
    },
    setup: { train: 1, holdout: 1, seed: 1, armDownDeg: 10, render: [512, 512] },
  };
}

const raw = [...BODY_FEATURES.map((f) => features[f]), 0.5];

describe('CALIBRATED_MORPHS', () => {
  it('is the body morphs without gender', () => {
    expect(CALIBRATED_MORPHS).toHaveLength(8);
    expect(CALIBRATED_MORPHS).not.toContain('gender');
  });
});

describe('designRow', () => {
  it('returns the standardised 11 inputs at degree 1', () => {
    const cal = { ...calibration(1), mean: raw.map((x) => x - 1), scale: raw.map(() => 2) };
    const row = designRow(features, 0.5, cal);
    expect(row).toHaveLength(11);
    row.forEach((v) => expect(v).toBeCloseTo(0.5, 12));
  });

  it('appends the products i <= j in row-major order at degree 2', () => {
    const cal = calibration(2);
    const row = designRow(features, 0.5, cal);
    expect(row).toHaveLength(77);
    expect(row[11]).toBeCloseTo(raw[0]! ** 2, 12);
    expect(row[12]).toBeCloseTo(raw[0]! * raw[1]!, 12);
    expect(row[76]).toBeCloseTo(raw[10]! ** 2, 12);
  });

  it('divides only the allowed width by 1 + allowance', () => {
    const cal = calibration(1);
    cal.allowance.waistWidth = 0.25;
    const row = designRow(features, 0.5, cal);
    const waist = BODY_FEATURES.indexOf('waistWidth');
    row.forEach((v, i) => expect(v).toBeCloseTo(i === waist ? raw[i]! / 1.25 : raw[i]!, 12));
  });
});

describe('estimateMorphs', () => {
  it('returns the intercepts when the slopes are zero', () => {
    const out = estimateMorphs(features, 0.5, calibration(1, 0.3));
    for (const m of CALIBRATED_MORPHS) expect(out[m]).toBeCloseTo(0.3, 12);
  });

  it('clamps to -1..1', () => {
    expect(estimateMorphs(features, 0.5, calibration(1, 1.7)).weight).toBe(1);
    expect(estimateMorphs(features, 0.5, calibration(1, -1.7)).weight).toBe(-1);
  });
});

describe('bodyCalibrationSchema', () => {
  it('accepts a valid calibration', () => {
    expect(bodyCalibrationSchema.safeParse(calibration(2)).success).toBe(true);
  });

  it('rejects reordered features', () => {
    const cal = calibration(1);
    [cal.features[0], cal.features[1]] = [cal.features[1]!, cal.features[0]!];
    expect(bodyCalibrationSchema.safeParse(cal).success).toBe(false);
  });

  it('rejects a coefficient array one too short', () => {
    const cal = calibration(1);
    cal.coefficients.weight = cal.coefficients.weight.slice(1);
    expect(bodyCalibrationSchema.safeParse(cal).success).toBe(false);
  });

  it('rejects a negative allowance and a non-positive scale', () => {
    const a = calibration(1);
    a.allowance.hipWidth = -0.1;
    expect(bodyCalibrationSchema.safeParse(a).success).toBe(false);
    const s = calibration(1);
    s.scale[3] = 0;
    expect(bodyCalibrationSchema.safeParse(s).success).toBe(false);
  });
});
