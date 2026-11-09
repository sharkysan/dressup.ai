import { DEFAULT_CALIBRATION } from '../../src/analysis/calibration';
import {
  measureRatios,
  RATIO_KEYS,
  RATIO_TO_PARAM,
  ratiosToFaceShape,
} from '../../src/analysis/mapping/faceShape';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

test('ratios are finite and in a sane range', () => {
  const r = measureRatios(synthFace().face);
  for (const k of RATIO_KEYS) {
    expect(Number.isFinite(r[k])).toBe(true);
    expect(r[k]).toBeGreaterThan(0);
    expect(r[k]).toBeLessThan(2);
  }
});

test('a 20° roll gives the same ratios as upright (within 1%)', () => {
  const upright = measureRatios(synthFace().face);
  const rolled = measureRatios(synthFace({ rollDeg: 20 }).face);
  for (const k of RATIO_KEYS)
    expect(Math.abs(rolled[k] - upright[k]) / upright[k]).toBeLessThan(0.01);
});

test('a 25° yaw gives the same ratios as upright (within 1%) — pose normalisation', () => {
  const upright = measureRatios(synthFace().face);
  const yawed = measureRatios(synthFace({ yawDeg: 25 }).face);
  for (const k of RATIO_KEYS)
    expect(Math.abs(yawed[k] - upright[k]) / upright[k]).toBeLessThan(0.01);
});

test('a 20° pitch gives the same ratios as upright (within 1%)', () => {
  const upright = measureRatios(synthFace().face);
  const pitched = measureRatios(synthFace({ pitchDeg: 20 }).face);
  for (const k of RATIO_KEYS)
    expect(Math.abs(pitched[k] - upright[k]) / upright[k]).toBeLessThan(0.01);
});

test('combined yaw, pitch and roll still give upright ratios', () => {
  const upright = measureRatios(synthFace().face);
  const turned = measureRatios(synthFace({ yawDeg: -20, pitchDeg: 15, rollDeg: 12 }).face);
  for (const k of RATIO_KEYS)
    expect(Math.abs(turned[k] - upright[k]) / upright[k]).toBeLessThan(0.01);
});

test('ratios are scale invariant', () => {
  const a = measureRatios(synthFace({ scale: 3 }).face);
  const b = measureRatios(synthFace({ scale: 6 }).face);
  for (const k of RATIO_KEYS) expect(b[k]).toBeCloseTo(a[k], 6);
});

test('the canonical face maps to a zero faceShape under the default calibration', () => {
  const { faceShape } = ratiosToFaceShape(measureRatios(synthFace().face), DEFAULT_CALIBRATION);
  for (const v of Object.values(faceShape)) expect(Math.abs(v)).toBeLessThan(1e-6);
});

test('a +3σ ratio saturates its weight at 0.8 and -1σ gives -0.8·(1/1)', () => {
  const r = measureRatios(synthFace().face);
  const s = DEFAULT_CALIBRATION.stats.faceAspect;
  const wide = ratiosToFaceShape({ ...r, faceAspect: s.mean + 3 * s.std }, DEFAULT_CALIBRATION);
  expect(wide.faceShape.faceWidth).toBeCloseTo(0.8);
  expect(wide.zScores.faceAspect).toBeCloseTo(3);
  const narrow = ratiosToFaceShape({ ...r, faceAspect: s.mean - 0.5 * s.std }, DEFAULT_CALIBRATION);
  expect(narrow.faceShape.faceWidth).toBeCloseTo(-0.4);
});

test('RATIO_TO_PARAM covers every ratio and every faceShape key once', () => {
  expect(Object.keys(RATIO_TO_PARAM).sort()).toEqual([...RATIO_KEYS].sort());
  expect(new Set(Object.values(RATIO_TO_PARAM)).size).toBe(8);
});
