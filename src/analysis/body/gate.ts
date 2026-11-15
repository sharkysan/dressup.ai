import { POSE } from '../pose';
import type { PoseObservation } from '../types';

/**
 * The body gate (spec §6), on the chosen pose: the shoulders, hips, knees and ankles each at
 * visibility ≥ `minVisibility`, the shoulder line within `maxShoulderTurnDeg` of facing the camera, and
 * the wrists not both between the hips.
 */
export const BODY_GATE = { minVisibility: 0.5, maxShoulderTurnDeg: 25 } as const;

/**
 * 'ok': the body is measured. 'no_pose': no pose under the chosen face. 'not_visible': a gated landmark
 * is hidden, or both wrists lie between the hips (the hands in front of or behind the body hide the
 * hips' outline); analyzePhoto also reports it when the pose passes but measureBody finds no body to
 * measure. 'turned': the shoulders are turned too far.
 */
export type BodyGate = 'ok' | 'no_pose' | 'not_visible' | 'turned';

const GATED = [
  POSE.shoulderL,
  POSE.shoulderR,
  POSE.hipL,
  POSE.hipR,
  POSE.kneeL,
  POSE.kneeR,
  POSE.ankleL,
  POSE.ankleR,
] as const;

/**
 * The checks run in the order no_pose, not_visible, turned, then the wrists (not_visible); the first
 * that fails decides. The turn is the shoulder line's angle out of the image plane, from the world
 * landmarks' depth: atan2(|zL − zR|, |xL − xR|). The wrists fail when both (15, 16) lie strictly between
 * the hips (23, 24) in x, in the image: then both forearms cross the torso, and its sides are read from
 * them. One wrist between the hips passes, since measureBody mirrors the other side.
 */
export function checkBodyGate(pose: PoseObservation | null): BodyGate {
  if (!pose) return 'no_pose';
  if (GATED.some((i) => pose.landmarks[i]!.visibility < BODY_GATE.minVisibility)) {
    return 'not_visible';
  }
  const l = pose.world[POSE.shoulderL]!;
  const r = pose.world[POSE.shoulderR]!;
  const turnDeg = (Math.atan2(Math.abs(l.z - r.z), Math.abs(l.x - r.x)) * 180) / Math.PI;
  if (turnDeg > BODY_GATE.maxShoulderTurnDeg) return 'turned';
  return wristsBetweenHips(pose) ? 'not_visible' : 'ok';
}

/** Both wrists strictly between the two hip landmarks in x, in the image. */
function wristsBetweenHips(pose: PoseObservation): boolean {
  const a = pose.landmarks[POSE.hipL]!.x;
  const b = pose.landmarks[POSE.hipR]!.x;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return [POSE.wristL, POSE.wristR].every((i) => {
    const x = pose.landmarks[i]!.x;
    return x > lo && x < hi;
  });
}
