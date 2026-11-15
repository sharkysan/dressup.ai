/** Shared analysis types (spec §6). Everything after MediaPipe detection is pure functions over these. */

/** Normalised image coordinates (0..1); z is MediaPipe's relative depth. */
export type Point3 = { x: number; y: number; z: number };
/** Pixel coordinates in the analysed (downscaled) image. */
export type Point2 = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export type FaceObservation = {
  /** 478 landmarks: 468 face mesh + 10 iris points. */
  landmarks: Point3[];
  /** 4×4 facial transformation matrix, column-major (MediaPipe). */
  matrix: number[];
  blendshapes: Record<string, number>;
  imageWidth: number;
  imageHeight: number;
};

/** A pose landmark: normalised like a face landmark, with MediaPipe's visibility (0..1). */
export type PoseLandmark = Point3 & { visibility: number };

/**
 * One person's pose from PoseLandmarker: 33 `landmarks` normalised like the face's (z shares x's scale),
 * and the same 33 points in `world`, MediaPipe's metric frame centred between the hips.
 */
export type PoseObservation = {
  landmarks: PoseLandmark[];
  world: Point3[];
  imageWidth: number;
  imageHeight: number;
};

/** MediaPipe multiclass selfie segmentation categories. */
export const MASK = {
  background: 0,
  hair: 1,
  bodySkin: 2,
  faceSkin: 3,
  clothes: 4,
  others: 5,
} as const;

export type CategoryMask = { width: number; height: number; data: Uint8Array };

export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export type Analysis = {
  face: FaceObservation;
  mask: CategoryMask;
  image: RgbaImage;
  faceBox: Box;
};
