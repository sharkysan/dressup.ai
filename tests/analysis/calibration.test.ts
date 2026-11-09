import calibrationJson from '../../src/analysis/calibration.json';
import { accumulateCalibration, calibrationSchema } from '../../src/analysis/calibration';
import type { Ratios } from '../../src/analysis/mapping/faceShape';

const base: Ratios = {
  faceAspect: 0.8,
  jawToCheek: 0.7,
  chinLength: 0.2,
  noseWidth: 0.3,
  noseLength: 0.35,
  eyeSpacing: 0.45,
  eyeAspect: 0.3,
  lipHeight: 0.15,
};

test('accumulateCalibration computes population mean and std', () => {
  const c = accumulateCalibration([base, { ...base, faceAspect: 1.0 }]);
  expect(c.samples).toBe(2);
  expect(c.stats.faceAspect.mean).toBeCloseTo(0.9);
  expect(c.stats.faceAspect.std).toBeCloseTo(0.1);
});

test('std is floored at 5% of the mean for identical samples', () => {
  const c = accumulateCalibration([base, base, base]);
  expect(c.stats.noseWidth.std).toBeCloseTo(0.015);
});

test('throws with fewer than 2 samples', () => {
  expect(() => accumulateCalibration([base])).toThrow(/2/);
});

test('the shipped calibration.json is schema-valid', () => {
  expect(calibrationSchema.safeParse(calibrationJson).success).toBe(true);
});
