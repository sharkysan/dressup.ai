import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { CategoryMask, FaceObservation } from './types';

/** Self-hosted model and wasm locations (spec §4/§6: nothing fetched from third parties at runtime). */
export const MODEL_URLS = {
  faceLandmarker: '/models/face_landmarker.task',
  segmenter: '/models/selfie_multiclass_256x256.tflite',
  wasm: '/mediapipe/wasm',
} as const;

export type ModelProgress = (fraction: number) => void;

let landmarker: FaceLandmarker | null = null;
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
 * Loads the face landmarker and the multiclass segmenter once. Progress spans both downloads.
 * Tries the GPU delegate first and falls back to CPU (headless/CI, old devices).
 */
export function loadModels(onProgress?: ModelProgress): Promise<void> {
  if (landmarker && segmenter) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const progress = [0, 0];
    const report = () => onProgress?.((progress[0]! + progress[1]!) / 2);
    const [vision, landmarkerBytes, segmenterBytes] = await Promise.all([
      FilesetResolver.forVisionTasks(MODEL_URLS.wasm),
      fetchWithProgress(MODEL_URLS.faceLandmarker, (l, t) => {
        progress[0] = t ? l / t : 0;
        report();
      }),
      fetchWithProgress(MODEL_URLS.segmenter, (l, t) => {
        progress[1] = t ? l / t : 0;
        report();
      }),
    ]);
    const create = async (delegate: 'GPU' | 'CPU') => {
      const lm = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: landmarkerBytes, delegate },
        runningMode: 'IMAGE',
        numFaces: 4,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      const seg = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: segmenterBytes, delegate },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      return { lm, seg };
    };
    let created: { lm: FaceLandmarker; seg: ImageSegmenter };
    try {
      created = await create('GPU');
    } catch (gpuError) {
      console.warn('MediaPipe GPU delegate unavailable, using CPU:', gpuError);
      created = await create('CPU');
    }
    landmarker = created.lm;
    segmenter = created.seg;
    onProgress?.(1);
  })();
  loading.catch(() => {
    loading = null; // allow a retry after a failed download
  });
  return loading;
}

export function modelsReady(): boolean {
  return Boolean(landmarker && segmenter);
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
  segmenter?.close();
  landmarker = null;
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
