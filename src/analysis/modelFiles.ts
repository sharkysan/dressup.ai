/**
 * The MediaPipe model files the app self-hosts under `/models/` (fetched into the git-ignored
 * `public/models/` by `tools/fetch-models.sh`). Kept free of imports so Node-side tooling (the e2e
 * model check) can read the list without loading the MediaPipe runtime.
 */
export const MODEL_FILES = {
  faceLandmarker: 'face_landmarker.task',
  poseLandmarker: 'pose_landmarker_full.task',
  segmenter: 'selfie_multiclass_256x256.tflite',
} as const;
