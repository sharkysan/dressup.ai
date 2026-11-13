import type { FaceObservation } from '../analysis/types';
import { FACE_LANDMARKS, type Correspondence } from './correspondence';
import { applySimilarity, umeyama, type Vec3 } from './similarity';

/**
 * The head fit's constants. Depth residuals count at `depthGain` (MediaPipe's depth is the least sure
 * axis). A landmark's residual is clamped to `maxResidualM`. The RBF is a Gaussian of width `sigmaM`,
 * with `lambda` on the diagonal so it smooths rather than interpolates.
 */
export const HEAD_FIT = {
  depthGain: 0.5,
  maxResidualM: 0.015,
  sigmaM: 0.02,
  lambda: 0.01,
} as const;

export type HeadFit = {
  /** x y z per entry of `corr.head.vertices`, metres, in the base's bind space. */
  headOffsets: Float32Array;
  debug: {
    /** RMS length of the landmark residuals in base space, before the clamp. */
    residualRmsMm: number;
    /** The longest head offset. */
    maxOffsetMm: number;
    /** The observed landmarks 0..467 aligned to the canonical model: x y z each, cm. */
    aligned: Float32Array;
  };
};

/**
 * How the head should move to match a face. The observed landmarks 0..467 (the iris is ignored) are
 * aligned to the canonical model by a similarity; what the similarity leaves over is the face's own
 * shape. Those residuals, in base space and clamped, are spread over the head by a Gaussian RBF centred
 * on the landmarks' base positions, held at zero at the `zero` points, and scaled by the head weights.
 */
export function fitHead(face: FaceObservation, corr: Correspondence): HeadFit {
  const { residuals, residualRmsMm, aligned } = landmarkResiduals(face, corr);

  // Centres: the landmarks, valued at their residuals; then the zero points, valued at 0.
  const n = FACE_LANDMARKS + corr.zero.length;
  const centres = new Float64Array(3 * n);
  const values = new Float64Array(3 * n);
  corr.landmarks.forEach((l, i) => centres.set(l.position, 3 * i));
  values.set(residuals);
  corr.zero.forEach((v, k) =>
    centres.set(corr.head.positions.slice(3 * v, 3 * v + 3), 3 * (FACE_LANDMARKS + k)),
  );
  const alpha = solveRbf(centres, values, n);

  const { positions, weights } = corr.head;
  const headOffsets = new Float32Array(3 * weights.length);
  const inverseSigma2 = 1 / HEAD_FIT.sigmaM ** 2;
  let maxOffset = 0;
  for (let v = 0; v < weights.length; v++) {
    const [px, py, pz] = [positions[3 * v]!, positions[3 * v + 1]!, positions[3 * v + 2]!];
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let j = 0; j < n; j++) {
      const dx = px - centres[3 * j]!;
      const dy = py - centres[3 * j + 1]!;
      const dz = pz - centres[3 * j + 2]!;
      const phi = Math.exp(-(dx * dx + dy * dy + dz * dz) * inverseSigma2);
      fx += alpha[3 * j]! * phi;
      fy += alpha[3 * j + 1]! * phi;
      fz += alpha[3 * j + 2]! * phi;
    }
    const w = weights[v]!;
    headOffsets[3 * v] = fx * w;
    headOffsets[3 * v + 1] = fy * w;
    headOffsets[3 * v + 2] = fz * w;
    maxOffset = Math.max(maxOffset, w * Math.hypot(fx, fy, fz));
  }
  return { headOffsets, debug: { residualRmsMm, maxOffsetMm: 1000 * maxOffset, aligned } };
}

/**
 * Per landmark 0..467, the residual of the observation's similarity fit to the canonical model, as an
 * offset in base space (m): depth at `depthGain`, clamped to `maxResidualM`.
 */
function landmarkResiduals(face: FaceObservation, corr: Correspondence) {
  const { imageWidth: W, imageHeight: H } = face;
  const observed: Vec3[] = [];
  const canonical: Vec3[] = [];
  for (let i = 0; i < FACE_LANDMARKS; i++) {
    const { x, y, z } = face.landmarks[i]!;
    observed.push([x * W, -y * H, -z * W]); // pixels, +y up, +z toward the viewer: a similarity image
    canonical.push([
      corr.canonical[3 * i]!,
      corr.canonical[3 * i + 1]!,
      corr.canonical[3 * i + 2]!,
    ]);
  }
  const toCanonical = umeyama(observed, canonical);
  const { scale, rotation: R } = corr.canonicalToBase;
  const residuals = new Float64Array(3 * FACE_LANDMARKS);
  const aligned = new Float32Array(3 * FACE_LANDMARKS);
  let sumSquares = 0;
  for (let i = 0; i < FACE_LANDMARKS; i++) {
    const a = applySimilarity(toCanonical, observed[i]!);
    aligned.set(a, 3 * i);
    const c = canonical[i]!;
    const r: Vec3 = [a[0] - c[0], a[1] - c[1], HEAD_FIT.depthGain * (a[2] - c[2])];
    const d = [0, 1, 2].map(
      (row) => scale * (R[3 * row]! * r[0] + R[3 * row + 1]! * r[1] + R[3 * row + 2]! * r[2]),
    );
    const length = Math.hypot(...d);
    sumSquares += length * length;
    const clamp = length > HEAD_FIT.maxResidualM ? HEAD_FIT.maxResidualM / length : 1;
    for (let k = 0; k < 3; k++) residuals[3 * i + k] = d[k]! * clamp;
  }
  return { residuals, residualRmsMm: 1000 * Math.sqrt(sumSquares / FACE_LANDMARKS), aligned };
}

/**
 * The weights α of the Gaussian RBF through `values` (x y z per centre) at `centres` (n of them): the
 * solution of (K + λI)·α = values, K_ij = φ(|c_i − c_j|), φ(r) = exp(−r²/σ²). K + λI is symmetric
 * positive definite, so one Cholesky factorisation solves all three columns.
 */
function solveRbf(centres: Float64Array, values: Float64Array, n: number): Float64Array {
  const inverseSigma2 = 1 / HEAD_FIT.sigmaM ** 2;
  // The lower triangle of K + λI, row-major; factorised in place to L, K + λI = L·Lᵀ.
  const a = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const dx = centres[3 * i]! - centres[3 * j]!;
      const dy = centres[3 * i + 1]! - centres[3 * j + 1]!;
      const dz = centres[3 * i + 2]! - centres[3 * j + 2]!;
      a[i * n + j] = Math.exp(-(dx * dx + dy * dy + dz * dz) * inverseSigma2);
    }
    a[i * n + i] = 1 + HEAD_FIT.lambda;
  }
  cholesky(a, n);
  return choleskySolve(a, n, values);
}

/** Cholesky–Banachiewicz, in place: the lower triangle of the n×n row-major `a` becomes L. */
function cholesky(a: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const rowI = i * n;
    for (let j = 0; j <= i; j++) {
      const rowJ = j * n;
      let sum = a[rowI + j]!;
      for (let k = 0; k < j; k++) sum -= a[rowI + k]! * a[rowJ + k]!;
      if (j < i) {
        a[rowI + j] = sum / a[rowJ + j]!;
      } else {
        if (!(sum > 0)) throw new Error(`cholesky: the matrix is not positive definite (row ${i})`);
        a[rowI + i] = Math.sqrt(sum);
      }
    }
  }
}

/** Solves L·Lᵀ·x = b for b of three columns (x y z per row), from the factor `l` of `cholesky`. */
function choleskySolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  const x = Float64Array.from(b);
  // L·y = b, forward.
  for (let i = 0; i < n; i++) {
    const row = i * n;
    for (let c = 0; c < 3; c++) {
      let sum = x[3 * i + c]!;
      for (let k = 0; k < i; k++) sum -= l[row + k]! * x[3 * k + c]!;
      x[3 * i + c] = sum / l[row + i]!;
    }
  }
  // Lᵀ·x = y, backward: as each x_i is final, take its column of Lᵀ (row i of L) out of the rows above.
  for (let i = n - 1; i >= 0; i--) {
    const row = i * n;
    for (let c = 0; c < 3; c++) x[3 * i + c] = x[3 * i + c]! / l[row + i]!;
    for (let k = 0; k < i; k++) {
      for (let c = 0; c < 3; c++) x[3 * k + c] = x[3 * k + c]! - l[row + k]! * x[3 * i + c]!;
    }
  }
  return x;
}
