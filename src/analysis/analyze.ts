import type { Catalog } from '../catalog/catalog';
import { defaultParams, type AvatarParams } from '../catalog/params';
import { buildLikeness, type LikenessDebug } from '../likeness/buildLikeness';
import { loadCorrespondence, type Correspondence } from '../likeness/correspondence';
import type { Likeness } from '../likeness/types';
import { strings } from '../ui/strings';
import { checkBodyGate, type BodyGate } from './body/gate';
import { headTopFactor, headTopY, measureBody, type BodyMeasurement } from './body/measure';
import { cropCanvas, cropFace, decodePhoto, DecodeError } from './image';
import { faceBox, headPose, toPixels } from './landmarks';
import { analyzeToParams, type AnalysisDebug } from './mapping';
import { hairRegion } from './mapping/hair';
import { dilateMask, expandBox, maskForCrop, restrictToBox } from './masks';
import { detectFaces, detectPoses, loadModels, segment, type ModelProgress } from './mediapipe';
import { faceFromCrop, headCropRect, noseInBox, pickPose } from './pose';
import {
  MASK,
  type Box,
  type CategoryMask,
  type FaceObservation,
  type Point2,
  type PoseObservation,
  type RgbaImage,
} from './types';

export type AnalysisErrorCode = 'models' | 'decode' | 'no_face' | 'face_too_small' | 'face_turned';

export class AnalysisError extends Error {
  code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

/**
 * Spec §6 gates on the chosen face. Hard gates: the face box ≥ `minFaceWidthPx` wide in the
 * full-resolution photo, |yaw| and |pitch| within their limits. The projection gate: the face box ≥
 * `minProjectionFaceWidthPx` wide in the full-resolution photo, below which the analysis keeps the
 * default face (no Likeness).
 */
export const GATES = {
  minFaceWidthPx: 120,
  maxYawDeg: 20,
  maxPitchDeg: 20,
  minProjectionFaceWidthPx: 256,
} as const;

/**
 * The full-resolution face crop the likeness is projected from: the face box grown `expand`× about its
 * centre. The segmenter's hair mask is coarse: the model runs at 256², so on a 12 MP photo one of its
 * cells spans ~16 full-resolution pixels and the mask's edge can sit ~8 px inside the hair. The crop's
 * hair mask is therefore dilated by `hairDilatePx` crop pixels (at the crop's usual scale of 1, ~half a
 * cell): hair left outside the mask would smear into the face, while skin masked by mistake is only
 * refilled from the skin around it.
 */
export const FACE_CROP = { expand: 1.6, hairDilatePx: 8 } as const;

export type Adapter = {
  loadModels: typeof loadModels;
  loadCorrespondence: typeof loadCorrespondence;
  detectFaces: typeof detectFaces;
  detectPoses: typeof detectPoses;
  segment: typeof segment;
};
const realAdapter: Adapter = { loadModels, loadCorrespondence, detectFaces, detectPoses, segment };

export type AnalyzeResult = {
  params: AvatarParams;
  debug: AnalysisDebug;
  face: FaceObservation;
  mask: CategoryMask;
  preview: HTMLCanvasElement;
  faceBox: Box;
  /** The pose whose nose lies in the chosen face's box (pickPose); null when none does. */
  pose: PoseObservation | null;
  /**
   * The body gate on `pose` (spec §6), and the body measured on the photo when it is 'ok'. Whatever the
   * gate, `params.body` is the default body (bodyParams).
   */
  body: { gate: BodyGate; measurement: BodyMeasurement | null };
  /** The photo face when likenessGate is 'ok'; otherwise null, and `params.face` is 'default'. */
  likeness: Likeness | null;
  /**
   * 'ok': the photo face was built. 'too_small': the face is below the projection gate
   * (GATES.minProjectionFaceWidthPx). 'failed': the face passed every gate, but building the photo face
   * failed (a head fit that is not finite, no 2-D canvas, no encoder).
   */
  likenessGate: 'ok' | 'too_small' | 'failed';
  likenessDebug: LikenessDebug | null;
};

export function pickLargest(faces: FaceObservation[]): FaceObservation | undefined {
  let best: FaceObservation | undefined;
  let bestArea = -1;
  for (const face of faces) {
    const box = faceBox(toPixels(face));
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      best = face;
    }
  }
  return best;
}

/**
 * Throws face_too_small / face_turned per GATES. `fullScale` is the full-resolution photo's width over
 * the analysed image's, which the face's landmarks are normalised by.
 */
export function applyGates(face: FaceObservation, fullScale: number): void {
  const width = faceBox(toPixels(face)).width * fullScale;
  if (width < GATES.minFaceWidthPx) {
    throw new AnalysisError('face_too_small', `face ${Math.round(width)} px wide`);
  }
  const pose = headPose(face.matrix);
  if (Math.abs(pose.yaw) > GATES.maxYawDeg || Math.abs(pose.pitch) > GATES.maxPitchDeg) {
    throw new AnalysisError(
      'face_turned',
      `yaw ${pose.yaw.toFixed(0)}°, pitch ${pose.pitch.toFixed(0)}°`,
    );
  }
}

/**
 * Photo → AvatarParams and the Likeness, entirely on the device: load models and correspondence →
 * decode → detect faces and poses (findFaces) → largest face → gates → its pose → segment → body gate
 * and measurement → map → (projection gate) → crop → likeness. Every expected failure is an
 * AnalysisError with a user-facing message (messageFor). A failure while building the likeness does
 * not reject: the params come back with the default face, `likeness: null` and `likenessGate:
 * 'failed'`. The full-resolution bitmap is closed whatever happens.
 */
export async function analyzePhoto(
  file: Blob,
  opts: {
    catalog: Catalog | null;
    current?: AvatarParams;
    /** The height the user entered (cm): `params.body.heightCm` (spec §6); else the current one. */
    heightCm?: number;
    onProgress?: ModelProgress;
    adapter?: Adapter;
  },
): Promise<AnalyzeResult> {
  const adapter = opts.adapter ?? realAdapter;
  let corr: Correspondence;
  try {
    [, corr] = await Promise.all([
      adapter.loadModels(opts.onProgress),
      adapter.loadCorrespondence(),
    ]);
  } catch (cause) {
    throw new AnalysisError('models', cause instanceof Error ? cause.message : String(cause));
  }
  let decoded: Awaited<ReturnType<typeof decodePhoto>>;
  try {
    decoded = await decodePhoto(file);
  } catch (cause) {
    if (cause instanceof DecodeError) throw new AnalysisError('decode', cause.message);
    throw cause;
  }
  try {
    const { faces, poses } = findFaces(adapter, decoded);
    const face = pickLargest(faces);
    if (!face) throw new AnalysisError('no_face');
    const fullScale = decoded.bitmap.width / decoded.image.width;
    applyGates(face, fullScale);
    const box = faceBox(toPixels(face));
    const pose = pickPose(poses, box);
    const mask = adapter.segment(decoded.canvas);
    const gate = checkBodyGate(pose);
    const measurement =
      pose && gate === 'ok'
        ? measureBody({
            pose,
            mask,
            faceBox: box,
            headTopY: headTopY(face, headTopFactor(corr)),
            width: decoded.image.width,
            height: decoded.image.height,
          })
        : null;
    const mapped = analyzeToParams(
      { face, mask, image: decoded.image, faceBox: box },
      {
        catalog: opts.catalog,
        current: opts.current,
      },
    );
    const params = { ...mapped.params, body: bodyParams(opts.current, opts.heightCm) };
    const result = {
      debug: mapped.debug,
      face,
      mask,
      preview: decoded.canvas,
      faceBox: box,
      pose,
      body: { gate, measurement },
    };
    if (box.width * fullScale < GATES.minProjectionFaceWidthPx) {
      return {
        ...result,
        params: { ...params, face: 'default' },
        likeness: null,
        likenessGate: 'too_small',
        likenessDebug: null,
      };
    }
    let built: Awaited<ReturnType<typeof buildLikeness>>;
    try {
      const crop = faceCrop(decoded.bitmap, decoded.image, face, box, mask);
      built = await buildLikeness({ face, crop, sourceSkin: params.skin }, corr);
    } catch {
      // Spec §3: the photo, the crop and the offsets stay out of logs, so the error is not printed.
      console.warn("analyzePhoto: couldn't build the photo face; using the default face");
      return {
        ...result,
        params: { ...params, face: 'default' },
        likeness: null,
        likenessGate: 'failed',
        likenessDebug: null,
      };
    }
    return {
      ...result,
      params: { ...params, face: 'photo' },
      likeness: built.likeness,
      likenessGate: 'ok',
      likenessDebug: built.debug,
    };
  } finally {
    decoded.bitmap.close();
  }
}

/**
 * The body the analysis returns (spec §6): every morph 0, the current gender (never inferred) and the
 * height entered, else the current height.
 */
function bodyParams(
  current: AvatarParams | undefined,
  heightCm: number | undefined,
): AvatarParams['body'] {
  const body = (current ?? defaultParams).body;
  return { ...defaultParams.body, gender: body.gender, heightCm: heightCm ?? body.heightCm };
}

/**
 * Every face and pose found on the photo (spec §6). FaceLandmarker and PoseLandmarker run on the
 * analysed copy; then, for each pose whose nose no face found so far covers, FaceLandmarker runs again on
 * its head crop of the full-resolution photo (HEAD_CROP), and the faces found there are mapped back into
 * the analysed image's coordinates.
 */
function findFaces(
  adapter: Adapter,
  decoded: { canvas: HTMLCanvasElement; image: RgbaImage; bitmap: ImageBitmap },
): { faces: FaceObservation[]; poses: PoseObservation[] } {
  const faces = [...adapter.detectFaces(decoded.canvas)];
  const poses = adapter.detectPoses(decoded.canvas);
  const full = { width: decoded.bitmap.width, height: decoded.bitmap.height };
  const analysed = { width: decoded.image.width, height: decoded.image.height };
  for (const pose of poses) {
    if (faces.some((f) => noseInBox(pose, faceBox(toPixels(f))))) continue;
    const rect = headCropRect(pose, full);
    for (const found of adapter.detectFaces(cropCanvas(decoded.bitmap, rect))) {
      faces.push(faceFromCrop(found, rect, full, analysed));
    }
  }
  return { faces, poses };
}

/**
 * The likeness's view of the photo: the full-resolution crop around the face (FACE_CROP), with the
 * landmarks and the hair mask in its pixels. `image` is the analysed (downscaled) copy that `box` and
 * `mask` are over. As in analyzeToParams, only hair within hairRegion counts.
 */
function faceCrop(
  bitmap: ImageBitmap,
  image: RgbaImage,
  face: FaceObservation,
  box: Box,
  mask: CategoryMask,
): { image: RgbaImage; landmarks: Point2[]; hair: Uint8Array } {
  const full = { width: bitmap.width, height: bitmap.height };
  const kx = full.width / image.width;
  const ky = full.height / image.height;
  const atFull = (b: Box): Box => ({
    x: b.x * kx,
    y: b.y * ky,
    width: b.width * kx,
    height: b.height * ky,
  });
  const rect = wholePixels(expandBox(atFull(box), FACE_CROP.expand, full.width, full.height), full);
  const crop = cropFace(bitmap, rect);
  const { width, height } = crop.image;
  const toCrop = (b: Box): Box => ({
    x: (b.x - rect.x) * crop.scale,
    y: (b.y - rect.y) * crop.scale,
    width: b.width * crop.scale,
    height: b.height * crop.scale,
  });
  const landmarks = face.landmarks.map((p) => ({
    x: (p.x * full.width - rect.x) * crop.scale,
    y: (p.y * full.height - rect.y) * crop.scale,
  }));
  const region = toCrop(atFull(hairRegion(box, image.width, image.height)));
  const hair = restrictToBox(
    maskForCrop(mask, MASK.hair, rect, crop.scale, full, crop.image),
    width,
    height,
    region,
  );
  return {
    image: crop.image,
    landmarks,
    hair: dilateMask(hair, width, height, FACE_CROP.hairDilatePx),
  };
}

/** The smallest box of whole pixels that holds `box`, within the image. */
function wholePixels(box: Box, image: { width: number; height: number }): Box {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const right = Math.min(image.width, Math.ceil(box.x + box.width));
  const bottom = Math.min(image.height, Math.ceil(box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function messageFor(code: AnalysisErrorCode): string {
  switch (code) {
    case 'models':
      return strings.analysis.modelsFailed;
    case 'decode':
      return strings.analysis.decodeFailed;
    case 'no_face':
      return strings.analysis.noFace;
    case 'face_too_small':
      return strings.analysis.faceTooSmall;
    case 'face_turned':
      return strings.analysis.faceTurned;
  }
}
