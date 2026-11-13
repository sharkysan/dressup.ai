export type Vec3 = [number, number, number];

/** p ↦ scale · rotation · p + translation. `rotation` is 3×3, row-major, a proper rotation (det +1). */
export type Similarity = { scale: number; rotation: number[]; translation: Vec3 };

export function applySimilarity(s: Similarity, p: Vec3): Vec3 {
  const r = s.rotation;
  return [0, 1, 2].map(
    (i) =>
      s.scale * (r[3 * i]! * p[0] + r[3 * i + 1]! * p[1] + r[3 * i + 2]! * p[2]) +
      s.translation[i]!,
  ) as Vec3;
}

/**
 * Umeyama's least-squares similarity (with scale): the s, R, t that minimise Σ |dst_i − (s·R·src_i + t)|²,
 * R a proper rotation even where a reflection would fit better. R is found as Horn's unit quaternion, the
 * top eigenvector of the 4×4 matrix built from the centred cross-covariance, which is that same optimal
 * proper rotation without an SVD and its reflection fix-up; then s = Σ dst'·R·src' / Σ |src'|².
 */
export function umeyama(src: Vec3[], dst: Vec3[]): Similarity {
  if (src.length !== dst.length) {
    throw new Error(`umeyama: ${src.length} source points but ${dst.length} target points`);
  }
  if (src.length < 3) throw new Error(`umeyama: needs at least 3 point pairs, got ${src.length}`);
  const srcMean = mean(src);
  const dstMean = mean(dst);
  // S[a][b] = Σ src'_a · dst'_b over the centred points; and Σ |src'|².
  const S = [0, 1, 2].map(() => [0, 0, 0]);
  let srcVariance = 0;
  for (let i = 0; i < src.length; i++) {
    const a = sub(src[i]!, srcMean);
    const b = sub(dst[i]!, dstMean);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r]![c]! += a[r]! * b[c]!;
    srcVariance += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  }
  if (srcVariance === 0) throw new Error('umeyama: the source points coincide');
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S as [Vec3, Vec3, Vec3];
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = topEigenvector(N);
  const rotation = [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
  // Σ dst'·R·src' = Σ_rc R[r][c] · S[c][r].
  let fit = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) fit += rotation[3 * r + c]! * S[c]![r]!;
  const scale = fit / srcVariance;
  const moved = applySimilarity({ scale, rotation, translation: [0, 0, 0] }, srcMean);
  return { scale, rotation, translation: sub(dstMean, moved) };
}

function mean(points: Vec3[]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const p of points) for (let c = 0; c < 3; c++) sum[c]! += p[c]!;
  return sum.map((v) => v / points.length) as Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The unit eigenvector of a symmetric 4×4 matrix's largest eigenvalue, by cyclic Jacobi rotations. */
function topEigenvector(matrix: number[][]): [number, number, number, number] {
  const a = matrix.map((row) => [...row]);
  const v = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j): number => (i === j ? 1 : 0)));
  const norm = a.flat().reduce((sum, x) => sum + x * x, 0);
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p]![q]! ** 2;
    if (off <= 1e-28 * norm) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        const apq = a[p]![q]!;
        if (apq === 0) continue;
        // The rotation by θ that zeroes a[p][q]: t = tan θ, the smaller root of t² + 2τt − 1 = 0.
        const tau = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let top = 0;
  for (let i = 1; i < 4; i++) if (a[i]![i]! > a[top]![top]!) top = i;
  const e = [0, 1, 2, 3].map((k) => v[k]![top]!);
  const n = Math.hypot(...e);
  return e.map((x) => x / n) as [number, number, number, number];
}
