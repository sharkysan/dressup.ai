import type { Box, FaceObservation, Point2, PoseObservation } from './types';

/** MediaPipe PoseLandmarker indices used by the analysis (spec §6). L/R are the subject's left/right. */
export const POSE = {
  nose: 0,
  /** The nose, the eyes and ears (1–8) and the mouth's corners (9, 10). */
  head: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  earL: 7,
  earR: 8,
  shoulderL: 11,
  shoulderR: 12,
  elbowL: 13,
  elbowR: 14,
  wristL: 15,
  wristR: 16,
  hipL: 23,
  hipR: 24,
  kneeL: 25,
  kneeR: 26,
  ankleL: 27,
  ankleR: 28,
} as const;

/**
 * The head crop (spec §6). FaceLandmarker misses a face as small as a full-length photo's on the 1024 px
 * copy, so for each pose whose nose no detected face covers it runs again on a square of the
 * full-resolution photo: centred on the head landmarks (POSE.head), `earMultiple` × the ear-to-ear
 * distance on a side and at least `minSidePx`, drawn at most `maxEdge` px on a side.
 */
export const HEAD_CROP = { earMultiple: 3, minSidePx: 96, maxEdge: 1024 } as const;

/** The pose's landmarks in pixels of the analysed image it was detected on. */
export function posePixels(pose: PoseObservation): Point2[] {
  return pose.landmarks.map((p) => ({ x: p.x * pose.imageWidth, y: p.y * pose.imageHeight }));
}

/** Whether the pose's nose lies inside `box` (analysed pixels, edges included). */
export function noseInBox(pose: PoseObservation, box: Box): boolean {
  const nose = posePixels(pose)[POSE.nose]!;
  return (
    nose.x >= box.x &&
    nose.x <= box.x + box.width &&
    nose.y >= box.y &&
    nose.y <= box.y + box.height
  );
}

/**
 * The pose of the person whose face box is `faceBox` (analysed pixels): the pose whose nose lies inside
 * it, the one nearest its centre when several do; null when none does.
 */
export function pickPose(poses: PoseObservation[], faceBox: Box): PoseObservation | null {
  const cx = faceBox.x + faceBox.width / 2;
  const cy = faceBox.y + faceBox.height / 2;
  let best: PoseObservation | null = null;
  let bestDistance = Infinity;
  for (const pose of poses) {
    if (!noseInBox(pose, faceBox)) continue;
    const nose = posePixels(pose)[POSE.nose]!;
    const distance = Math.hypot(nose.x - cx, nose.y - cy);
    if (distance < bestDistance) {
      best = pose;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The head crop of `pose` (HEAD_CROP), in full-resolution pixels of a photo of size `full`. A crop that
 * would pass the photo's edge is shifted inside it, keeping its side (at most the photo's shorter edge).
 */
export function headCropRect(pose: PoseObservation, full: { width: number; height: number }): Box {
  const at = (i: number): Point2 => {
    const p = pose.landmarks[i]!;
    return { x: p.x * full.width, y: p.y * full.height };
  };
  let cx = 0;
  let cy = 0;
  for (const i of POSE.head) {
    const p = at(i);
    cx += p.x;
    cy += p.y;
  }
  cx /= POSE.head.length;
  cy /= POSE.head.length;
  const earL = at(POSE.earL);
  const earR = at(POSE.earR);
  const ears = Math.hypot(earL.x - earR.x, earL.y - earR.y);
  const side = Math.min(
    Math.max(HEAD_CROP.minSidePx, HEAD_CROP.earMultiple * ears),
    full.width,
    full.height,
  );
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: clamp(cx - side / 2, full.width - side),
    y: clamp(cy - side / 2, full.height - side),
    width: side,
    height: side,
  };
}

/**
 * A face FaceLandmarker found on the crop `rect` (full-resolution pixels) of a photo of size `full`, as
 * if found on the analysed copy of size `analysed`: its landmarks normalised by the photo instead of the
 * crop. z shares x's scale (normalised by the image width), so it scales by the crop's width over the
 * photo's. The matrix and blendshapes do not depend on the crop.
 */
export function faceFromCrop(
  face: FaceObservation,
  rect: Box,
  full: { width: number; height: number },
  analysed: { width: number; height: number },
): FaceObservation {
  const kz = rect.width / full.width;
  return {
    ...face,
    landmarks: face.landmarks.map((p) => ({
      x: (rect.x + p.x * rect.width) / full.width,
      y: (rect.y + p.y * rect.height) / full.height,
      z: p.z * kz,
    })),
    imageWidth: analysed.width,
    imageHeight: analysed.height,
  };
}
