import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { MODEL_FILES } from './modelFiles';
import type { CategoryMask, FaceObservation, PoseObservation } from './types';

/** Self-hosted model and wasm locations (spec §4/§6: nothing fetched from third parties at runtime). */
export const MODEL_URLS = {
  faceLandmarker: `/models/${MODEL_FILES.faceLandmarker}`,
  poseLandmarker: `/models/${MODEL_FILES.poseLandmarker}`,
  segmenter: `/models/${MODEL_FILES.segmenter}`,
  wasm: '/mediapipe/wasm',
} as const;

export type ModelProgress = (fraction: number) => void;

let landmarker: FaceLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;
let segmenter: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;

/** Downloads a model with progress reporting; MediaPipe then takes the bytes directly. */
async function fetchWithProgress(
  url: string,
  onChunk: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onChunk(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Loads the face landmarker, the pose landmarker and the multiclass segmenter once. Progress spans the
 * three downloads: the bytes loaded over their total, or the mean of each download's fraction while one
 * has no content-length. Tries the GPU delegate first and falls back to CPU (headless/CI, old devices).
 */
export function loadModels(onProgress?: ModelProgress): Promise<void> {
  if (modelsReady()) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const downloads = [0, 1, 2].map(() => ({ loaded: 0, total: 0 }));
    const report = () => {
      const known = downloads.every((d) => d.total > 0);
      const sum = (key: 'loaded' | 'total') => downloads.reduce((s, d) => s + d[key], 0);
      const fractions = downloads.reduce((s, d) => s + (d.total ? d.loaded / d.total : 0), 0);
      const mean = fractions / downloads.length;
      onProgress?.(known ? sum('loaded') / sum('total') : mean);
    };
    const fetchModel = (url: string, i: number) =>
      fetchWithProgress(url, (loaded, total) => {
        downloads[i] = { loaded, total };
        report();
      });
    const [vision, landmarkerBytes, poseBytes, segmenterBytes] = await Promise.all([
      FilesetResolver.forVisionTasks(MODEL_URLS.wasm),
      fetchModel(MODEL_URLS.faceLandmarker, 0),
      fetchModel(MODEL_URLS.poseLandmarker, 1),
      fetchModel(MODEL_URLS.segmenter, 2),
    ]);
    const create = async (delegate: 'GPU' | 'CPU') => {
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: landmarkerBytes, delegate },
        runningMode: 'IMAGE',
        numFaces: 4,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      const pose = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: poseBytes, delegate },
        runningMode: 'IMAGE',
        numPoses: 4,
        outputSegmentationMasks: false,
      });
      const seg = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: segmenterBytes, delegate },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      return { lm, pose, seg };
    };
    let created: { lm: FaceLandmarker; pose: PoseLandmarker; seg: ImageSegmenter };
    try {
      created = await create('GPU');
    } catch (gpuError) {
      console.warn('MediaPipe GPU delegate unavailable, using CPU:', gpuError);
      created = await create('CPU');
    }
    landmarker = created.lm;
    poseLandmarker = created.pose;
    segmenter = created.seg;
    onProgress?.(1);
  })();
  loading.catch(() => {
    loading = null; // allow a retry after a failed download
  });
  return loading;
}

export function modelsReady(): boolean {
  return Boolean(landmarker && poseLandmarker && segmenter);
}

/** All detected faces, largest face box first. Requires loadModels() to have resolved. */
export function detectFaces(canvas: HTMLCanvasElement): FaceObservation[] {
  if (!landmarker) throw new Error('models not loaded');
  const result = landmarker.detect(canvas);
  const faces = result.faceLandmarks.map((landmarks, i) => {
    const blendshapes: Record<string, number> = {};
    for (const c of result.faceBlendshapes[i]?.categories ?? [])
      blendshapes[c.categoryName] = c.score;
    return {
      landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      matrix: Array.from(result.facialTransformationMatrixes[i]?.data ?? identity()),
      blendshapes,
      imageWidth: canvas.width,
      imageHeight: canvas.height,
    } satisfies FaceObservation;
  });
  return faces.sort((a, b) => boxArea(b) - boxArea(a));
}

/** All detected poses (MediaPipe's order). Requires loadModels() to have resolved. */
export function detectPoses(canvas: HTMLCanvasElement): PoseObservation[] {
  if (!poseLandmarker) throw new Error('models not loaded');
  const result = poseLandmarker.detect(canvas);
  try {
    return result.landmarks.map((landmarks, i) => ({
      landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
      world: (result.worldLandmarks[i] ?? []).map((p) => ({ x: p.x, y: p.y, z: p.z })),
      imageWidth: canvas.width,
      imageHeight: canvas.height,
    }));
  } finally {
    result.close();
  }
}

/** Category mask (0..5) at the segmenter's working resolution. */
export function segment(canvas: HTMLCanvasElement): CategoryMask {
  if (!segmenter) throw new Error('models not loaded');
  const result = segmenter.segment(canvas);
  const mask = result.categoryMask;
  if (!mask) throw new Error('segmenter returned no category mask');
  try {
    return { width: mask.width, height: mask.height, data: mask.getAsUint8Array().slice() };
  } finally {
    result.close();
  }
}

export function resetModelsForTests(): void {
  landmarker?.close();
  poseLandmarker?.close();
  segmenter?.close();
  landmarker = null;
  poseLandmarker = null;
  segmenter = null;
  loading = null;
}

function boxArea(face: FaceObservation): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of face.landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return (maxX - minX) * (maxY - minY);
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
