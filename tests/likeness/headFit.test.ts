import fs from 'node:fs';
import { LM } from '../../src/analysis/landmarks';
import type { FaceObservation } from '../../src/analysis/types';
import {
  FACE_LANDMARKS,
  correspondenceSchema,
  type Correspondence,
} from '../../src/likeness/correspondence';
import { HEAD_FIT, fitHead } from '../../src/likeness/headFit';
import type { Vec3 } from '../../src/likeness/similarity';
import { CANONICAL_FACE_OBJ, readCanonicalFace } from '../../tools/base/canonicalFace';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

const CANONICAL = readCanonicalFace(CANONICAL_FACE_OBJ).positions.slice(0, FACE_LANDMARKS);
const NOSE_TIP = 4;
/** In the synthetic correspondence: the head vertex that duplicates landmark 152 at weight ½. */
const NECK = FACE_LANDMARKS;
/** In the synthetic correspondence: the head vertices of the 60 back-of-head points (zero). */
const BACK = Array.from({ length: 60 }, (_, k) => FACE_LANDMARKS + 1 + k);

/**
 * A correspondence built from the canonical model itself: canonical cm → base m is ×0.01. The head is the
 * 468 landmark positions, one weight-½ copy of the chin (152), then 60 back-of-head points at z = −6 cm,
 * which are the zero points.
 */
function synthCorrespondence(): Correspondence {
  const landmarks = CANONICAL.map((p) => p.map((v) => v * 0.01) as Vec3);
  const back = BACK.map((_, k): Vec3 => [
    -0.0675 + 0.015 * (k % 10),
    -0.08 + 0.03 * Math.floor(k / 10),
    -0.06,
  ]);
  const head = [...landmarks, landmarks[LM.chin]!, ...back];
  return {
    version: 1,
    bodyVertexCount: head.length,
    canonical: CANONICAL.flat(),
    canonicalToBase: { scale: 0.01, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] },
    landmarks: landmarks.map((position) => ({
      triangle: [0, 0, 0],
      bary: [1, 0, 0],
      uv: [0, 0],
      position,
    })),
    triangles: [],
    faceUvRect: { u: 0, v: 0, size: 1 },
    head: {
      vertices: head.map((_, v) => v),
      weights: head.map((_, v) => (v === NECK ? 0.5 : 1)),
      positions: head.flat(),
    },
    zero: BACK,
  };
}

const CORR = synthCorrespondence();
const POSE = { yawDeg: 15, rollDeg: 5, scale: 9, centre: { x: 300, y: 380 } };

/**
 * `face` (from synthFace at POSE) with canonical landmarks moved by `delta(i, C_i)` cm: synthFace's
 * projection is affine in the canonical point, so a canonical change adds the rotated, scaled change.
 */
function reshaped(
  face: FaceObservation,
  delta: (i: number, c: Vec3) => Vec3 | null,
): FaceObservation {
  const r = (row: number, col: number) => face.matrix[col * 4 + row]!;
  const { imageWidth: W, imageHeight: H } = face;
  const landmarks = face.landmarks.map((l, i) => {
    const d = i < FACE_LANDMARKS ? delta(i, CANONICAL[i]!) : null;
    if (!d) return { ...l };
    const [dx, dy, dz] = [0, 1, 2].map(
      (row) => r(row, 0) * d[0] + r(row, 1) * d[1] + r(row, 2) * d[2],
    ) as Vec3;
    return {
      x: l.x + (dx * POSE.scale) / W,
      y: l.y - (dy * POSE.scale) / H,
      z: l.z - (dz * POSE.scale) / W,
    };
  });
  return { ...face, landmarks };
}

const posed = () => synthFace(POSE).face;
const offsetOf = (offsets: Float32Array, v: number): Vec3 => [
  offsets[3 * v]!,
  offsets[3 * v + 1]!,
  offsets[3 * v + 2]!,
];
const lengthOf = (p: Vec3) => Math.hypot(...p);
function maxLength(offsets: Float32Array): number {
  let max = 0;
  for (let v = 0; 3 * v < offsets.length; v++) max = Math.max(max, lengthOf(offsetOf(offsets, v)));
  return max;
}

/** Canonical x × 1.10 below y = −4 cm: a wider jaw. */
const widerJaw = (_: number, [x, y]: Vec3): Vec3 | null => (y < -4 ? [0.1 * x, 0, 0] : null);

test('the canonical face itself, turned, gives no offsets', () => {
  const { headOffsets, debug } = fitHead(posed(), CORR);
  expect(maxLength(headOffsets)).toBeLessThan(0.0005);
  expect(debug.residualRmsMm).toBeLessThan(0.01);
  expect(debug.maxOffsetMm).toBeCloseTo(1000 * maxLength(headOffsets), 6);
  // aligned is the observation in canonical cm: the canonical model.
  expect(debug.aligned).toHaveLength(3 * FACE_LANDMARKS);
  debug.aligned.forEach((v, k) => expect(v).toBeCloseTo(CORR.canonical[k]!, 3));
});

test('a wider jaw moves the jaw out, and not the nose tip or the zero points', () => {
  const { headOffsets } = fitHead(reshaped(posed(), widerJaw), CORR);
  const jawR = offsetOf(headOffsets, LM.jawR);
  const jawL = offsetOf(headOffsets, LM.jawL);
  expect(-jawR[0]).toBeGreaterThan(0.002);
  expect(-jawR[0]).toBeLessThan(0.008);
  expect(jawL[0]).toBeGreaterThan(0.002);
  expect(jawL[0]).toBeLessThan(0.008);
  expect(lengthOf(offsetOf(headOffsets, NOSE_TIP))).toBeLessThan(0.001);
  for (const v of BACK) expect(lengthOf(offsetOf(headOffsets, v))).toBeLessThan(0.0005);
});

test('depth residuals count at depthGain', () => {
  expect(HEAD_FIT.depthGain).toBe(0.5);
  // The nose pushed 1 cm toward the viewer, falling off over 1 cm around the tip. (One landmark alone is
  // narrower than the RBF passes: λ smooths a one-landmark spike to under half its height.)
  const tip = CANONICAL[NOSE_TIP]!;
  const face = reshaped(posed(), (_, c) => [
    0,
    0,
    Math.exp(-((c[0] - tip[0]) ** 2 + (c[1] - tip[1]) ** 2 + (c[2] - tip[2]) ** 2)),
  ]);
  const { headOffsets, debug } = fitHead(face, CORR);
  // The residual at the tip is ≈ 10 mm of pure depth...
  const residualMm = [0, 1, 2].map(
    (c) => 10 * (debug.aligned[3 * NOSE_TIP + c]! - CORR.canonical[3 * NOSE_TIP + c]!),
  );
  expect(Math.abs(residualMm[0]!)).toBeLessThan(0.1);
  expect(Math.abs(residualMm[1]!)).toBeLessThan(0.1);
  expect(residualMm[2]).toBeGreaterThan(9.5);
  expect(residualMm[2]).toBeLessThan(10);
  // ...and the offset there is half of it.
  const nose = offsetOf(headOffsets, NOSE_TIP);
  expect(nose[2]).toBeGreaterThan(0.004);
  expect(nose[2]).toBeLessThan(0.006);
});

/** The subject's right cheek 5 cm further out: 50 mm of residual, clamped to 15 mm. */
const cheekOut = () => reshaped(posed(), (i) => (i === LM.cheekR ? [-5, 0, 0] : null));

test('a residual past maxResidualM is clamped', () => {
  const { headOffsets, debug } = fitHead(cheekOut(), CORR);
  expect(maxLength(headOffsets)).toBeLessThanOrEqual(0.018);
  // The RMS is of the residuals before the clamp: ≈ 50 mm / √468.
  expect(debug.residualRmsMm).toBeGreaterThan(40 / Math.sqrt(FACE_LANDMARKS));
});

test('the zero points hold the back of the head still', () => {
  // The cheek is among the landmarks nearest the back-of-head points: without those as RBF centres,
  // they move 0.66 mm here.
  const { headOffsets } = fitHead(cheekOut(), CORR);
  for (const v of BACK) expect(lengthOf(offsetOf(headOffsets, v))).toBeLessThan(0.0001);
});

test('a neck vertex gets its weight of the offset', () => {
  const { headOffsets } = fitHead(reshaped(posed(), widerJaw), CORR);
  const chin = offsetOf(headOffsets, LM.chin);
  const neck = offsetOf(headOffsets, NECK);
  expect(lengthOf(chin)).toBeGreaterThan(0.0001); // the jaw change reaches the chin
  for (let c = 0; c < 3; c++) expect(Math.abs(neck[c]! - chin[c]! / 2)).toBeLessThan(1e-6);
});

test('one offset per head vertex, and the same every time', () => {
  const face = reshaped(posed(), widerJaw);
  const first = fitHead(face, CORR);
  expect(first.headOffsets).toHaveLength(3 * CORR.head.vertices.length);
  const second = fitHead(face, CORR);
  expect(second.headOffsets).toEqual(first.headOffsets);
  expect(second.debug).toEqual(first.debug);
});

const BUILT = 'public/assets/base/correspondence.json';

describe.skipIf(!fs.existsSync(BUILT))('the built correspondence', () => {
  const corr = fs.existsSync(BUILT)
    ? correspondenceSchema.parse(JSON.parse(fs.readFileSync(BUILT, 'utf8')))
    : null!;

  test('the canonical face, turned, gives no offsets, quickly', () => {
    const face = posed();
    const start = performance.now();
    const { headOffsets } = fitHead(face, corr);
    const ms = performance.now() - start;
    expect(headOffsets).toHaveLength(3 * corr.head.vertices.length);
    expect(maxLength(headOffsets)).toBeLessThan(0.0005);
    // The 250 ms budget is defined on the dev machine; shared CI runners are too noisy to assert it.
    if (!process.env.CI) expect(ms).toBeLessThan(250);
  });
});
