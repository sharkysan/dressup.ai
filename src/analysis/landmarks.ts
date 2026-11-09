import type { Box, FaceObservation, Point2, Point3 } from './types';

/** MediaPipe Face Landmarker indices used by the analysis (spec §6). R/L are the subject's right/left. */
export const LM = {
  faceTop: 10,
  chin: 152,
  cheekR: 234,
  cheekL: 454,
  jawR: 172,
  jawL: 397,
  noseBridge: 168,
  noseBottom: 2,
  nostrilR: 48,
  nostrilL: 278,
  eyeR: { outer: 33, inner: 133, top: 159, bottom: 145 },
  eyeL: { inner: 362, outer: 263, top: 386, bottom: 374 },
  irisR: [468, 469, 470, 471, 472],
  irisL: [473, 474, 475, 476, 477],
  lipTop: 0,
  lipBottom: 17,
  mouthR: 61,
  mouthL: 291,
  outerLips: [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
  ],
  browR: { upper: [70, 63, 105, 66, 107], lower: [46, 53, 52, 65, 55] },
  browL: { upper: [300, 293, 334, 296, 336], lower: [276, 283, 282, 295, 285] },
  faceOval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
    148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
  cheekPatchR: [50, 101, 118, 117, 123, 187, 205, 36],
  cheekPatchL: [280, 330, 347, 346, 352, 411, 425, 266],
  foreheadPatch: [10, 338, 297, 332, 333, 299, 337, 151, 108, 69, 104, 103, 67, 109],
} as const;

export function toPixels(face: FaceObservation): Point2[] {
  return face.landmarks.map((p) => ({ x: p.x * face.imageWidth, y: p.y * face.imageHeight }));
}

export function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Head pose in degrees from a column-major 4×4 transform whose rotation is Ry(yaw)·Rx(pitch)·Rz(roll)
 * in a y-up, z-toward-viewer frame (MediaPipe's facial transformation matrix convention).
 */
export function headPose(matrix: number[]): { yaw: number; pitch: number; roll: number } {
  const r = (row: number, col: number) => matrix[col * 4 + row]!;
  const deg = (v: number) => (v * 180) / Math.PI;
  const yaw = Math.atan2(r(0, 2), r(2, 2));
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r(1, 2))));
  const roll = Math.atan2(r(1, 0), r(1, 1));
  return { yaw: round(deg(yaw)), pitch: round(deg(pitch)), roll: round(deg(roll)) };
}

function round(v: number): number {
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/**
 * Pose-normalised landmarks: projects the 3-D landmarks onto the face's own plane, spanned by the
 * cheek-to-cheek axis and the chin-to-forehead axis (Gram–Schmidt). Removes yaw, pitch and roll
 * together without depending on the transformation matrix's sign convention; distances along the
 * face are preserved, so ratios measured here are pose-invariant. y grows downward, like pixels.
 * MediaPipe's z shares x's scale (normalised by image width), hence z·imageWidth.
 */
export function faceAligned(face: FaceObservation): Point2[] {
  const W = face.imageWidth;
  const H = face.imageHeight;
  const pts: Point3[] = face.landmarks.map((p) => ({ x: p.x * W, y: p.y * H, z: p.z * W }));
  const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const unit = (a: Point3): Point3 => {
    const n = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / n, y: a.y / n, z: a.z / n };
  };
  const u = unit(sub(pts[LM.cheekL]!, pts[LM.cheekR]!));
  const v0 = sub(pts[LM.chin]!, pts[LM.faceTop]!);
  const along = dot(v0, u);
  const v = unit({ x: v0.x - along * u.x, y: v0.y - along * u.y, z: v0.z - along * u.z });
  return pts.map((p) => ({ x: dot(p, u), y: dot(p, v) }));
}

/** Bounding box of the face oval landmarks, in pixels. */
export function faceBox(points: Point2[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of LM.faceOval) {
    const p = points[i]!;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Scanline-fills the polygon given by `indices` into a width×height 0/1 mask. */
export function polygonMask(
  points: Point2[],
  indices: readonly number[],
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const poly = indices.map((i) => points[i]!);
  const n = poly.length;
  if (n < 3) return mask;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.ceil(minY));
  const y1 = Math.min(height - 1, Math.floor(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y <= sy !== b.y <= sy) xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const xb = Math.min(width - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}
