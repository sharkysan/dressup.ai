import type { Catalog } from '../catalog/catalog';
import type { AvatarParams } from '../catalog/params';
import { strings } from '../ui/strings';
import { DEFAULT_CALIBRATION, type Calibration } from './calibration';
import { decodePhoto, DecodeError } from './image';
import { faceBox, headPose, toPixels } from './landmarks';
import { analyzeToParams, type AnalysisDebug } from './mapping';
import { detectFaces, loadModels, segment, type ModelProgress } from './mediapipe';
import type { Box, CategoryMask, FaceObservation } from './types';

export type AnalysisErrorCode = 'models' | 'decode' | 'no_face' | 'face_too_small' | 'face_turned';

export class AnalysisError extends Error {
  code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

/** Spec §6 gates on the downscaled image. */
export const GATES = { minFaceWidthPx: 120, maxYawDeg: 30, maxPitchDeg: 30 } as const;

export type Adapter = {
  loadModels: typeof loadModels;
  detectFaces: typeof detectFaces;
  segment: typeof segment;
};
const realAdapter: Adapter = { loadModels, detectFaces, segment };

export type AnalyzeResult = {
  params: AvatarParams;
  debug: AnalysisDebug;
  face: FaceObservation;
  mask: CategoryMask;
  preview: HTMLCanvasElement;
  faceBox: Box;
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

/** Throws face_too_small / face_turned per GATES. */
export function applyGates(face: FaceObservation): void {
  const box = faceBox(toPixels(face));
  if (box.width < GATES.minFaceWidthPx) {
    throw new AnalysisError('face_too_small', `face ${Math.round(box.width)} px wide`);
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
 * Photo → AvatarParams, entirely on the device: load models → decode → detect → largest face →
 * gates → segment → map. Every failure is an AnalysisError with a user-facing message (messageFor).
 */
export async function analyzePhoto(
  file: Blob,
  opts: {
    catalog: Catalog | null;
    base: 'a' | 'b';
    calibration?: Calibration;
    current?: AvatarParams;
    onProgress?: ModelProgress;
    adapter?: Adapter;
  },
): Promise<AnalyzeResult> {
  const adapter = opts.adapter ?? realAdapter;
  try {
    await adapter.loadModels(opts.onProgress);
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
  const faces = adapter.detectFaces(decoded.canvas);
  const face = pickLargest(faces);
  if (!face) throw new AnalysisError('no_face');
  applyGates(face);
  const mask = adapter.segment(decoded.canvas);
  const box = faceBox(toPixels(face));
  const { params, debug } = analyzeToParams(
    { face, mask, image: decoded.image, faceBox: box },
    {
      calibration: opts.calibration ?? DEFAULT_CALIBRATION,
      catalog: opts.catalog,
      base: opts.base,
      current: opts.current,
    },
  );
  return { params, debug, face, mask, preview: decoded.canvas, faceBox: box };
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
