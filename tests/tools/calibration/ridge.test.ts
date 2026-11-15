import { describe, expect, it } from 'vitest';
import { chooseLambda, fitRidge, LAMBDAS, standardize } from '../../../tools/calibration/ridge';

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
function gaussianX(n: number, d: number, seed: number): number[][] {
  const r = rng(seed);
  return Array.from({ length: n }, () => Array.from({ length: d }, () => r() * 2 - 1));
}

describe('standardize', () => {
  it('gives the population mean and std, and 1 for a constant column', () => {
    const { mean, scale } = standardize([
      [1, 5],
      [3, 5],
    ]);
    expect(mean).toEqual([2, 5]);
    expect(scale[0]).toBeCloseTo(1, 12);
    expect(scale[1]).toBe(1);
  });
});

describe('LAMBDAS', () => {
  it('spans 1e-4 to 1e2 in half decades', () => {
    expect(LAMBDAS).toHaveLength(13);
    expect(LAMBDAS[0]).toBeCloseTo(1e-4, 12);
    expect(LAMBDAS[12]).toBeCloseTo(100, 9);
  });
});

describe('fitRidge', () => {
  const X = gaussianX(60, 2, 7);
  const y = X.map(([a, b]) => 0.3 + 2 * a! - b!);

  it('recovers noiseless coefficients', () => {
    const w = fitRidge(X, y, 1e-8);
    [0.3, 2, -1].forEach((v, i) => expect(w[i]!).toBeCloseTo(v, 6));
  });

  it('shrinks slopes but keeps the intercept at mean(y) with a large lambda', () => {
    const { mean, scale } = standardize(X);
    const Xs = X.map((r) => r.map((v, j) => (v - mean[j]!) / scale[j]!));
    const w = fitRidge(Xs, y, 100);
    const ybar = y.reduce((a, b) => a + b, 0) / y.length;
    const w0 = fitRidge(Xs, y, 1e-8);
    expect(w[0]).toBeCloseTo(ybar, 9);
    expect(Math.abs(w[1]!)).toBeLessThan(Math.abs(w0[1]!));
    expect(Math.abs(w[2]!)).toBeLessThan(Math.abs(w0[2]!));
  });
});

describe('chooseLambda', () => {
  it('picks a small lambda on noiseless data', () => {
    const X = gaussianX(80, 3, 11);
    const y = X.map(([a, b]) => 0.3 + 2 * a! - b!);
    expect(chooseLambda(X, y)).toBeLessThanOrEqual(1e-3);
  });

  it('picks a large lambda when y is noise', () => {
    const X = gaussianX(80, 5, 13);
    const r = rng(99);
    const y = X.map(() => r() * 2 - 1);
    expect(chooseLambda(X, y)).toBeGreaterThanOrEqual(10);
  });
});
