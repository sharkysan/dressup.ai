import type { AvatarParams } from '../../catalog/params';
import type { Calibration } from '../calibration';
import { centreOf, dist, faceBox, headPose, LM, rollCorrected, toPixels } from '../landmarks';
import type { FaceObservation } from '../types';

export const RATIO_KEYS = [
  'faceAspect',
  'jawToCheek',
  'chinLength',
  'noseWidth',
  'noseLength',
  'eyeSpacing',
  'eyeAspect',
  'lipHeight',
] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];
export type Ratios = Record<RatioKey, number>;

export const RATIO_TO_PARAM: Record<RatioKey, keyof AvatarParams['faceShape']> = {
  faceAspect: 'faceWidth',
  jawToCheek: 'jawWidth',
  chinLength: 'chinLength',
  noseWidth: 'noseWidth',
  noseLength: 'noseLength',
  eyeSpacing: 'eyeSpacing',
  eyeAspect: 'eyeSize',
  lipHeight: 'lipFullness',
};

/** Spec §6: weights are z-scores clamped to −1..1 then ×0.8 so extremes stay stylised. */
export const WEIGHT_SCALE = 0.8;

/** Scale- and roll-invariant face proportions from the landmarks (spec §6 table). */
export function measureRatios(face: FaceObservation): Ratios {
  const raw = toPixels(face);
  const p = rollCorrected(raw, headPose(face.matrix).roll, centreOf(faceBox(raw)));
  const at = (i: number) => p[i]!;
  const faceW = dist(at(LM.cheekR), at(LM.cheekL));
  const faceH = dist(at(LM.faceTop), at(LM.chin));
  const eyeAspect = (eye: typeof LM.eyeR | typeof LM.eyeL) =>
    dist(at(eye.top), at(eye.bottom)) / dist(at(eye.outer), at(eye.inner));
  return {
    faceAspect: faceW / faceH,
    jawToCheek: dist(at(LM.jawR), at(LM.jawL)) / faceW,
    chinLength: dist(at(LM.lipBottom), at(LM.chin)) / faceH,
    noseWidth: dist(at(LM.nostrilR), at(LM.nostrilL)) / faceW,
    noseLength: dist(at(LM.noseBridge), at(LM.noseBottom)) / faceH,
    eyeSpacing: dist(at(LM.irisR[0]), at(LM.irisL[0])) / faceW,
    eyeAspect: (eyeAspect(LM.eyeR) + eyeAspect(LM.eyeL)) / 2,
    lipHeight: dist(at(LM.lipTop), at(LM.lipBottom)) / faceH,
  };
}

export function ratiosToFaceShape(
  ratios: Ratios,
  calibration: Calibration,
): { faceShape: AvatarParams['faceShape']; zScores: Ratios } {
  const zScores = {} as Ratios;
  const faceShape = {} as AvatarParams['faceShape'];
  for (const key of RATIO_KEYS) {
    const { mean, std } = calibration.stats[key];
    const z = std > 0 ? (ratios[key] - mean) / std : 0;
    zScores[key] = z;
    faceShape[RATIO_TO_PARAM[key]] = Math.max(-1, Math.min(1, z)) * WEIGHT_SCALE;
  }
  return { faceShape, zScores };
}
