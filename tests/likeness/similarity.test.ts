import { applySimilarity, umeyama, type Similarity } from '../../src/likeness/similarity';

type Vec3 = [number, number, number];

const POINTS: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 2, 0],
  [0, 0, 3],
  [1, 1, 1],
  [-2, 0.5, 1],
];

/** Row-major rotation by `angle` radians about `axis` (Rodrigues). */
function axisAngle(axis: Vec3, angle: number): number[] {
  const n = Math.hypot(...axis);
  const [x, y, z] = axis.map((a) => a / n) as Vec3;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

const det3 = (r: number[]) =>
  r[0]! * (r[4]! * r[8]! - r[5]! * r[7]!) -
  r[1]! * (r[3]! * r[8]! - r[5]! * r[6]!) +
  r[2]! * (r[3]! * r[7]! - r[4]! * r[6]!);

function expectOrthonormal(r: number[]): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot =
        r[3 * i]! * r[3 * j]! + r[3 * i + 1]! * r[3 * j + 1]! + r[3 * i + 2]! * r[3 * j + 2]!;
      expect(dot).toBeCloseTo(i === j ? 1 : 0, 9);
    }
  }
}

function expectSimilarity(actual: Similarity, expected: Similarity): void {
  expect(actual.scale).toBeCloseTo(expected.scale, 9);
  actual.rotation.forEach((r, i) => expect(r).toBeCloseTo(expected.rotation[i]!, 9));
  actual.translation.forEach((t, i) => expect(t).toBeCloseTo(expected.translation[i]!, 9));
}

test('applySimilarity scales, then rotates, then translates', () => {
  // 90° about z: x → y.
  const s: Similarity = {
    scale: 2,
    rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
    translation: [1, 2, 3],
  };
  const [x, y, z] = applySimilarity(s, [1, 0, 0.5]);
  expect(x).toBeCloseTo(1, 12);
  expect(y).toBeCloseTo(4, 12);
  expect(z).toBeCloseTo(4, 12);
});

test('umeyama recovers a known similarity', () => {
  const truth: Similarity = {
    scale: 0.0123,
    rotation: axisAngle([1, 2, 3], 2.5),
    translation: [0.1, 1.5, -0.2],
  };
  const fit = umeyama(
    POINTS,
    POINTS.map((p) => applySimilarity(truth, p)),
  );
  expectSimilarity(fit, truth);
});

test('three points determine it', () => {
  const truth: Similarity = {
    scale: 1.7,
    rotation: axisAngle([0, 1, 0], -0.4),
    translation: [-3, 0, 2],
  };
  const three = POINTS.slice(1, 4);
  expectSimilarity(
    umeyama(
      three,
      three.map((p) => applySimilarity(truth, p)),
    ),
    truth,
  );
});

test('a mirror image still gives a proper rotation', () => {
  // No rotation maps the points onto their mirror image; the plain SVD solution would be a reflection.
  const fit = umeyama(
    POINTS,
    POINTS.map(([x, y, z]) => [-x, y, z]),
  );
  expectOrthonormal(fit.rotation);
  expect(det3(fit.rotation)).toBeCloseTo(1, 9);
  expect(fit.scale).toBeGreaterThan(0);
});

test('mismatched or too few points throw', () => {
  expect(() => umeyama(POINTS, POINTS.slice(1))).toThrow();
  expect(() => umeyama(POINTS.slice(0, 2), POINTS.slice(0, 2))).toThrow();
});
