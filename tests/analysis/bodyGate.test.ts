import { BODY_GATE, checkBodyGate } from '../../src/analysis/body/gate';
import { POSE } from '../../src/analysis/pose';
import type { PoseObservation } from '../../src/analysis/types';
import { synthBody } from '../../tools/test-fixtures/body';

const standing = () => synthBody().pose;

/** The pose with landmark `i` at `visibility`. */
function withVisibility(pose: PoseObservation, i: number, visibility: number): PoseObservation {
  const landmarks = pose.landmarks.map((p, j) => (j === i ? { ...p, visibility } : p));
  return { ...pose, landmarks };
}

/** The pose with its world shoulders turned `deg` about the vertical, about their midpoint. */
function turned(pose: PoseObservation, deg: number): PoseObservation {
  const l = pose.world[POSE.shoulderL]!;
  const r = pose.world[POSE.shoulderR]!;
  const half = Math.hypot(l.x - r.x, l.z - r.z) / 2;
  const mx = (l.x + r.x) / 2;
  const mz = (l.z + r.z) / 2;
  const a = (deg * Math.PI) / 180;
  const world = pose.world.map((p, j) => {
    if (j === POSE.shoulderL)
      return { ...p, x: mx + half * Math.cos(a), z: mz - half * Math.sin(a) };
    if (j === POSE.shoulderR)
      return { ...p, x: mx - half * Math.cos(a), z: mz + half * Math.sin(a) };
    return p;
  });
  return { ...pose, world };
}

const GATED = [
  POSE.shoulderL,
  POSE.shoulderR,
  POSE.hipL,
  POSE.hipR,
  POSE.kneeL,
  POSE.kneeR,
  POSE.ankleL,
  POSE.ankleR,
];

test('the gate’s limits', () => {
  expect(BODY_GATE).toEqual({ minVisibility: 0.5, maxShoulderTurnDeg: 25 });
});

test('no pose → no_pose; a visible pose facing the camera → ok', () => {
  expect(checkBodyGate(null)).toBe('no_pose');
  expect(checkBodyGate(standing())).toBe('ok');
});

test('one ankle at visibility 0.49 → not_visible, 0.5 passes', () => {
  expect(checkBodyGate(withVisibility(standing(), POSE.ankleL, 0.49))).toBe('not_visible');
  expect(checkBodyGate(withVisibility(standing(), POSE.ankleL, 0.5))).toBe('ok');
});

test.each(GATED)('landmark %i is gated on its visibility', (i) => {
  expect(checkBodyGate(withVisibility(standing(), i, 0.2))).toBe('not_visible');
});

test('a hidden wrist or nose does not fail the gate', () => {
  for (const i of [POSE.wristL, POSE.nose]) {
    expect(checkBodyGate(withVisibility(standing(), i, 0))).toBe('ok');
  }
});

test('world shoulders turned 30° → turned; 20° → ok', () => {
  expect(checkBodyGate(turned(standing(), 30))).toBe('turned');
  expect(checkBodyGate(turned(standing(), -30))).toBe('turned');
  expect(checkBodyGate(turned(standing(), 20))).toBe('ok');
});

test('a pose that fails both checks reports not_visible', () => {
  const both = withVisibility(turned(standing(), 40), POSE.kneeR, 0.1);
  expect(checkBodyGate(both)).toBe('not_visible');
});

/**
 * The pose with its wrists' image landmarks at `left` and `right` px from the midline (x 300 of the
 * 1000 px image; + is the subject's left, on the image's right); the world landmarks are unchanged.
 */
function withWrists(pose: PoseObservation, left: number, right: number): PoseObservation {
  const x = (offset: number) => (300 + offset) / pose.imageWidth;
  const landmarks = pose.landmarks.map((p, j) =>
    j === POSE.wristL ? { ...p, x: x(left) } : j === POSE.wristR ? { ...p, x: x(-right) } : p,
  );
  return { ...pose, landmarks };
}

describe('the wrists and the hips', () => {
  /** The hips' landmarks lie 46 px either side of the midline; the clear figure's wrists far outside. */
  const hipOffset = () => {
    const pose = standing();
    return (pose.landmarks[POSE.hipL]!.x - pose.landmarks[POSE.hipR]!.x) * pose.imageWidth * 0.5;
  };

  test('both wrists between the hips (hands clasped in front, or behind the back) → not_visible', () => {
    expect(hipOffset()).toBeCloseTo(46, 9);
    expect(checkBodyGate(withWrists(standing(), 8, 8))).toBe('not_visible');
    expect(checkBodyGate(withWrists(standing(), 45, -30))).toBe('not_visible');
  });

  test('one wrist between the hips → ok: the touching arm’s rule mirrors the other side', () => {
    expect(checkBodyGate(withWrists(standing(), 8, 130))).toBe('ok');
    expect(checkBodyGate(withWrists(standing(), 130, 8))).toBe('ok');
  });

  test('both wrists outside the hips → ok, and a wrist on a hip’s line is not between them', () => {
    const pose = standing();
    for (const i of [POSE.wristL, POSE.wristR]) {
      expect(Math.abs(pose.landmarks[i]!.x * pose.imageWidth - 300)).toBeGreaterThan(hipOffset());
    }
    expect(checkBodyGate(pose)).toBe('ok');
    expect(checkBodyGate(withWrists(standing(), 60, 60))).toBe('ok');
    expect(checkBodyGate(withWrists(standing(), 46, 46))).toBe('ok'); // strictly between
  });

  test('the wrists are checked after the visibility and the turn', () => {
    const inside = withWrists(standing(), 8, 8);
    expect(checkBodyGate(turned(inside, 30))).toBe('turned');
    expect(checkBodyGate(withVisibility(inside, POSE.ankleL, 0.2))).toBe('not_visible');
  });
});
