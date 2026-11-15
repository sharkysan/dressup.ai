/** Ridge regression for the body calibration (Node side; nothing here ships to the browser). */

/** Per-column population mean and std; a column with std < 1e-12 gets scale 1. */
export function standardize(rows: number[][]): { mean: number[]; scale: number[] } {
  const n = rows.length;
  const d = rows[0]?.length ?? 0;
  const mean = new Array<number>(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j]! += r[j]! / n;
  const scale = new Array<number>(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) scale[j]! += (r[j]! - mean[j]!) ** 2 / n;
  return { mean, scale: scale.map((v) => (Math.sqrt(v) < 1e-12 ? 1 : Math.sqrt(v))) };
}

/** Solves A x = b for symmetric positive-definite A by Cholesky (A is overwritten). */
function choleskySolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k++) s -= A[i]![k]! * A[j]![k]!;
      if (i === j) {
        if (s <= 0) throw new Error('matrix is not positive definite');
        A[i]![i]! = Math.sqrt(s);
      } else {
        A[i]![j]! = s / A[j]![j]!;
      }
    }
  }
  const z = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= A[i]![k]! * z[k]!;
    z[i]! = s / A[i]![i]!;
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let k = i + 1; k < n; k++) s -= A[k]![i]! * x[k]!;
    x[i]! = s / A[i]![i]!;
  }
  return x;
}

/**
 * Fits y ≈ b + X·w for an already standardised X; returns [b, ...w]. The intercept is not
 * penalised: y and X are centred, (XᵀX + λI) w = Xᵀy is solved, and b = mean(y) − mean(X)·w.
 */
export function fitRidge(X: number[][], y: number[], lambda: number): number[] {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const xm = new Array<number>(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) xm[j]! += r[j]! / n;
  const ym = y.reduce((a, b) => a + b, 0) / n;
  const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const b = new Array<number>(d).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const xj = X[i]![j]! - xm[j]!;
      b[j]! += xj * (y[i]! - ym);
      for (let k = 0; k <= j; k++) A[j]![k]! += xj * (X[i]![k]! - xm[k]!);
    }
  }
  for (let j = 0; j < d; j++) {
    A[j]![j]! += lambda;
    for (let k = j + 1; k < d; k++) A[j]![k]! = A[k]![j]!;
  }
  const w = choleskySolve(A, b);
  return [ym - w.reduce((s, v, j) => s + v * xm[j]!, 0), ...w];
}

/** 10^k for k = −4, −3.5, …, 2. */
export const LAMBDAS: number[] = Array.from({ length: 13 }, (_, i) => 10 ** (-4 + i / 2));

/** A seeded PRNG: uniform floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The lambda with the least mean squared error over seeded k-fold splits (ties: the smaller). */
export function chooseLambda(
  X: number[][],
  y: number[],
  lambdas: number[] = LAMBDAS,
  folds = 5,
  seed = 1,
): number {
  const n = X.length;
  const order = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i]!, order[j]!] = [order[j]!, order[i]!];
  }
  let best = lambdas[0]!;
  let bestErr = Infinity;
  for (const lambda of lambdas) {
    let err = 0;
    for (let f = 0; f < folds; f++) {
      const test = order.filter((_, p) => p % folds === f);
      const train = order.filter((_, p) => p % folds !== f);
      const w = fitRidge(
        train.map((i) => X[i]!),
        train.map((i) => y[i]!),
        lambda,
      );
      for (const i of test) {
        let p = w[0]!;
        for (let j = 0; j < X[i]!.length; j++) p += w[j + 1]! * X[i]![j]!;
        err += (p - y[i]!) ** 2;
      }
    }
    if (err / n < bestErr) {
      bestErr = err / n;
      best = lambda;
    }
  }
  return best;
}
