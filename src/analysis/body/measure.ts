import type { Correspondence } from '../../likeness/correspondence';
import { LM, toPixels } from '../landmarks';
import { expandBox, resampleMask } from '../masks';
import { POSE, posePixels } from '../pose';
import {
  MASK,
  type Box,
  type CategoryMask,
  type FaceObservation,
  type Point2,
  type PoseObservation,
} from '../types';

/** The body's widths: the trunk's and the limbs' (spec §6). */
export const WIDTH_FEATURES = [
  'shoulderWidth',
  'bustWidth',
  'waistWidth',
  'hipWidth',
  'thighWidth',
  'calfWidth',
  'upperArmWidth',
] as const;
/**
 * The ten ratios measured on the photo (spec §6): the widths and lengths ÷ heightPx, the area ÷
 * heightPx².
 */
export const BODY_FEATURES = [...WIDTH_FEATURES, 'legLength', 'armLength', 'area'] as const;
export type BodyFeature = (typeof BODY_FEATURES)[number];
export type BodyFeatures = Record<BodyFeature, number>;

export const MEASURE = {
  regionFaceExpand: 2.5, // the person region: this face box multiple ∪ the pose landmarks' box …
  regionMargin: 0.1, // … grown by this fraction of that box's height on every side (§6)
  gapFraction: 0.01, // of heightPx: background gaps a torso span bridges
  // t = 0 at the shoulder line, 1 at the hip line (mean y of 11/12, of 23/24)
  bands: { shoulder: [-0.05, 0.1], bust: [0.3, 0.4], waist: [0.55, 0.85], hip: [0.9, 1.1] },
  limbAt: { upperArm: 0.5, thigh: 1 / 3, calf: 1 / 3 }, // along shoulder→elbow, hip→knee, knee→ankle
} as const;

/** The head weight from which a vertex is the head's own (the neck's are lower). */
const FULL_HEAD_WEIGHT = 0.999;
/** The step (analysed px) of the walk across a limb. */
const LIMB_STEP = 0.125;

export type BodyMeasurement = {
  features: BodyFeatures;
  /** From the head top to the ankle line, in analysed pixels. */
  heightPx: number;
  headTopY: number;
  /** The mean y of the ankles (27, 28). */
  ankleY: number;
  /** The person region the silhouette is restricted to (personRegion). */
  region: Box;
  /** The subject's sides whose arm touched the torso in a row of the bust, waist or hip band. */
  armsTouching: { left: boolean; right: boolean };
  /**
   * Where each width was measured, for the overlay: the band's row a torso width came from, and the
   * perpendicular across the limb on each side.
   */
  lines: { feature: BodyFeature; a: Point2; b: Point2 }[];
};

/**
 * The head top's height above landmark 10 as a multiple of the distance from 152 to 10, in the base's
 * proportion (spec §6): (skullTop − y₁₀) / (y₁₀ − y₁₅₂), where skullTop is the highest of the head's
 * full-weight vertices and y₁₀, y₁₅₂ the landmarks' base positions.
 */
export function headTopFactor(corr: Correspondence): number {
  const { weights, positions } = corr.head;
  let skullTop = -Infinity;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i]! >= FULL_HEAD_WEIGHT) skullTop = Math.max(skullTop, positions[3 * i + 1]!);
  }
  const y10 = corr.landmarks[LM.faceTop]!.position[1];
  const y152 = corr.landmarks[LM.chin]!.position[1];
  return (skullTop - y10) / (y10 - y152);
}

/**
 * The top of the head (analysed pixels): landmark 10 raised by `factor` × its distance from 152. Taken
 * from the face, not the silhouette, so hair never changes the measured height (spec §6).
 */
export function headTopY(face: FaceObservation, factor: number): number {
  const px = toPixels(face);
  const top = px[LM.faceTop]!;
  const chin = px[LM.chin]!;
  return top.y - factor * Math.hypot(top.x - chin.x, top.y - chin.y);
}

/**
 * The chosen person's region (spec §6): the face box grown `regionFaceExpand`× ∪ the box of the pose's
 * landmarks, grown by `regionMargin` × that box's height on every side, within the image.
 */
export function personRegion(
  pose: PoseObservation,
  faceBox: Box,
  width: number,
  height: number,
): Box {
  const face = expandBox(faceBox, MEASURE.regionFaceExpand, width, height);
  let [x0, y0, x1, y1] = [face.x, face.y, face.x + face.width, face.y + face.height];
  for (const p of posePixels(pose)) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const margin = MEASURE.regionMargin * (y1 - y0);
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(width, x1 + margin);
  y1 = Math.min(height, y1 + margin);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The body silhouette and the hair, 0/1 at the analysed size, each restricted to the person region. */
type Silhouette = { body: Uint8Array; hair: Uint8Array; width: number; height: number };

/** A torso width measured on one row: the half-widths about the midline, as a segment. */
type RowWidth = { width: number; a: Point2; b: Point2 };

type Arm = { side: 'left' | 'right'; shoulder: Point2; elbow: Point2; wrist: Point2 };

/**
 * The body's features from the pose landmarks and the segmenter's mask (spec §6), in analysed pixels,
 * left and right averaged. `width` × `height` is the analysed image, which the pose's landmarks and
 * `faceBox` are over; the mask is resampled to it.
 *
 * - Height: the ankle line (mean y of 27, 28) − `headTopY`.
 * - Silhouette: bodySkin ∪ faceSkin ∪ clothes, the hair kept apart, both within personRegion.
 * - Torso width at a row: the span of body ∪ hair through the midline (the line through the mid-shoulder
 *   and mid-hip points), or through the nearest set pixel within `gapFraction` × heightPx of it, bridging
 *   background gaps up to that long; then the hair is trimmed off both ends. In the bust, waist and hip
 *   bands a side whose arm axis (shoulder→elbow, or elbow→wrist below the elbow) lies inside the span
 *   touches: it takes the other side's half-width, or, when both touch, each side ends at its axis less
 *   half the upper arm's width. Per band: the shoulder's widest row, the bust's median, the waist's
 *   narrowest, the hip's widest.
 * - Limb width: across the limb at `limbAt` along it, walking the perpendicular over the body (no hair)
 *   both ways to the background: twice the shorter half, so a hand on the thigh or touching legs never
 *   widen it.
 * - Lengths: hip→knee→ankle and shoulder→elbow→wrist. Area: the body's pixels from the shoulder line to
 *   the ankle line.
 * - Widths and lengths ÷ heightPx; the area ÷ heightPx².
 */
export function measureBody(input: {
  pose: PoseObservation;
  mask: CategoryMask;
  faceBox: Box;
  headTopY: number;
  width: number;
  height: number;
}): BodyMeasurement {
  const { pose, width, height } = input;
  const points = posePixels(pose);
  const at = (i: number) => points[i]!;
  const region = personRegion(pose, input.faceBox, width, height);
  const sil = silhouette(input.mask, region, width, height);
  const ankleY = (at(POSE.ankleL).y + at(POSE.ankleR).y) / 2;
  const heightPx = ankleY - input.headTopY;

  const limb = (feature: BodyFeature, segments: [number, number][], along: number) => {
    const measured = segments.map(([a, b]) => limbWidth(sil, at(a), at(b), along));
    return {
      width: mean(measured.map((m) => m.width)),
      lines: measured.map(({ a, b }) => ({ feature, a, b })),
    };
  };
  const { limbAt } = MEASURE;
  const thigh = limb(
    'thighWidth',
    [
      [POSE.hipL, POSE.kneeL],
      [POSE.hipR, POSE.kneeR],
    ],
    limbAt.thigh,
  );
  const calf = limb(
    'calfWidth',
    [
      [POSE.kneeL, POSE.ankleL],
      [POSE.kneeR, POSE.ankleR],
    ],
    limbAt.calf,
  );
  const upperArm = limb(
    'upperArmWidth',
    [
      [POSE.shoulderL, POSE.elbowL],
      [POSE.shoulderR, POSE.elbowR],
    ],
    limbAt.upperArm,
  );
  const torso = torsoWidths(sil, at, heightPx, upperArm.width);

  const dist = (i: number, j: number) => Math.hypot(at(i).x - at(j).x, at(i).y - at(j).y);
  const legLength = mean([
    dist(POSE.hipL, POSE.kneeL) + dist(POSE.kneeL, POSE.ankleL),
    dist(POSE.hipR, POSE.kneeR) + dist(POSE.kneeR, POSE.ankleR),
  ]);
  const armLength = mean([
    dist(POSE.shoulderL, POSE.elbowL) + dist(POSE.elbowL, POSE.wristL),
    dist(POSE.shoulderR, POSE.elbowR) + dist(POSE.elbowR, POSE.wristR),
  ]);
  const shoulderY = (at(POSE.shoulderL).y + at(POSE.shoulderR).y) / 2;
  const area = bodyArea(sil, shoulderY, ankleY);

  const ratio = (px: number) => px / heightPx;
  return {
    features: {
      shoulderWidth: ratio(torso.widths.shoulder),
      bustWidth: ratio(torso.widths.bust),
      waistWidth: ratio(torso.widths.waist),
      hipWidth: ratio(torso.widths.hip),
      thighWidth: ratio(thigh.width),
      calfWidth: ratio(calf.width),
      upperArmWidth: ratio(upperArm.width),
      legLength: ratio(legLength),
      armLength: ratio(armLength),
      area: area / heightPx ** 2,
    },
    heightPx,
    headTopY: input.headTopY,
    ankleY,
    region,
    armsTouching: torso.armsTouching,
    lines: [...torso.lines, ...thigh.lines, ...calf.lines, ...upperArm.lines],
  };
}

function silhouette(mask: CategoryMask, region: Box, width: number, height: number): Silhouette {
  const categories = resampleMask(mask.data, mask.width, mask.height, width, height);
  const body = new Uint8Array(width * height);
  const hair = new Uint8Array(width * height);
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const c = categories[i];
      if (c === MASK.hair) hair[i] = 1;
      else if (c === MASK.bodySkin || c === MASK.faceSkin || c === MASK.clothes) body[i] = 1;
    }
  }
  return { body, hair, width, height };
}

/** The four torso widths (px) by MEASURE.bands, with the rows they came from and the touching arms. */
function torsoWidths(
  sil: Silhouette,
  at: (i: number) => Point2,
  heightPx: number,
  upperArmWidth: number,
): {
  widths: { shoulder: number; bust: number; waist: number; hip: number };
  armsTouching: { left: boolean; right: boolean };
  lines: BodyMeasurement['lines'];
} {
  const midpoint = (a: Point2, b: Point2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const shoulder = midpoint(at(POSE.shoulderL), at(POSE.shoulderR));
  const hip = midpoint(at(POSE.hipL), at(POSE.hipR));
  const length = hip.y - shoulder.y;
  const gapPx = MEASURE.gapFraction * heightPx;
  const arms: Arm[] = [
    { side: 'left', shoulder: at(POSE.shoulderL), elbow: at(POSE.elbowL), wrist: at(POSE.wristL) },
    { side: 'right', shoulder: at(POSE.shoulderR), elbow: at(POSE.elbowR), wrist: at(POSE.wristR) },
  ];
  const armsTouching = { left: false, right: false };

  /** The rows whose centres lie in the band (t → shoulder.y + t × length). */
  const rows = ([t0, t1]: readonly [number, number]): number[] => {
    if (!(length > 0)) return [];
    const out: number[] = [];
    const first = Math.max(0, Math.ceil(shoulder.y + t0 * length - 0.5));
    const last = Math.min(sil.height - 1, Math.floor(shoulder.y + t1 * length - 0.5));
    for (let y = first; y <= last; y++) out.push(y);
    return out;
  };

  const measureRow = (y: number, armRule: boolean): RowWidth | null => {
    const yc = y + 0.5;
    const mid = shoulder.x + ((yc - shoulder.y) / length) * (hip.x - shoulder.x);
    const span = torsoSpan(sil, y, mid, gapPx);
    if (!span) return null;
    // Half-widths on the image's left (lo) and right (hi) of the midline.
    let lo = mid - span.left;
    let hi = span.right + 1 - mid;
    if (armRule) {
      let axisLo: number | null = null;
      let axisHi: number | null = null;
      for (const arm of arms) {
        const x = axisX(arm, yc);
        if (x === null || x < span.left || x > span.right + 1) continue;
        armsTouching[arm.side] = true;
        if (x < mid) axisLo ??= x;
        else axisHi ??= x;
      }
      if (axisLo !== null && axisHi !== null) {
        lo = Math.max(0, mid - (axisLo + upperArmWidth / 2));
        hi = Math.max(0, axisHi - upperArmWidth / 2 - mid);
      } else if (axisLo !== null) {
        lo = hi;
      } else if (axisHi !== null) {
        hi = lo;
      }
    }
    return { width: lo + hi, a: { x: mid - lo, y: yc }, b: { x: mid + hi, y: yc } };
  };

  const band = (feature: BodyFeature, t: readonly [number, number], reduce: Reducer) => {
    const armRule = feature !== 'shoulderWidth';
    const measured = rows(t)
      .map((y) => measureRow(y, armRule))
      .filter((r): r is RowWidth => r !== null);
    return { feature, ...reduce(measured) };
  };
  const { bands } = MEASURE;
  const results = [
    band('shoulderWidth', bands.shoulder, widest),
    band('bustWidth', bands.bust, median),
    band('waistWidth', bands.waist, narrowest),
    band('hipWidth', bands.hip, widest),
  ];
  const [s, b, w, h] = results.map((r) => r.width) as [number, number, number, number];
  return {
    widths: { shoulder: s, bust: b, waist: w, hip: h },
    armsTouching,
    lines: results.flatMap(({ feature, row }) => (row ? [{ feature, a: row.a, b: row.b }] : [])),
  };
}

/**
 * The span (inclusive columns) of body ∪ hair on row `y` through `mid`, or through the nearest set pixel
 * within `gapPx` of it, bridging background gaps up to `gapPx` long; then the hair (and any gap it
 * bridged) trimmed off both ends. Null when nothing of the body remains.
 */
function torsoSpan(
  sil: Silhouette,
  y: number,
  mid: number,
  gapPx: number,
): { left: number; right: number } | null {
  const { body, hair, width } = sil;
  const row = y * width;
  const set = (x: number) => x >= 0 && x < width && (body[row + x]! | hair[row + x]!) === 1;
  let seed = Math.floor(mid);
  if (!set(seed)) {
    let found: number | null = null;
    for (let d = 1; d <= gapPx && found === null; d++) {
      if (set(seed - d)) found = seed - d;
      else if (set(seed + d)) found = seed + d;
    }
    if (found === null) return null;
    seed = found;
  }
  const reach = (step: 1 | -1) => {
    let last = seed;
    for (let x = seed + step; x >= 0 && x < width; x += step) {
      if (set(x)) last = x;
      else if (Math.abs(x - last) > gapPx) break;
    }
    return last;
  };
  let left = reach(-1);
  let right = reach(1);
  while (left <= right && !body[row + left]) left++;
  while (right >= left && !body[row + right]) right--;
  return left <= right ? { left, right } : null;
}

/** The arm's axis at height `y`: shoulder→elbow above the elbow, elbow→wrist below it; null if level. */
function axisX(arm: Arm, y: number): number | null {
  const [a, b] = y < arm.elbow.y ? [arm.shoulder, arm.elbow] : [arm.elbow, arm.wrist];
  const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  return Number.isFinite(x) ? x : null;
}

/**
 * The limb's width at `along` from `a` to `b`: twice the shorter of the two walks along the
 * perpendicular over the body, and that segment.
 */
function limbWidth(
  sil: Silhouette,
  a: Point2,
  b: Point2,
  along: number,
): { width: number; a: Point2; b: Point2 } {
  const c = { x: a.x + along * (b.x - a.x), y: a.y + along * (b.y - a.y) };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return { width: 0, a: c, b: c };
  const n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const half = Math.min(walk(sil, c, n), walk(sil, c, { x: -n.x, y: -n.y }));
  return {
    width: 2 * half,
    a: { x: c.x - half * n.x, y: c.y - half * n.y },
    b: { x: c.x + half * n.x, y: c.y + half * n.y },
  };
}

/** How far the body runs from `from` along the unit `dir` (px): half a step short of the first gap. */
function walk(sil: Silhouette, from: Point2, dir: Point2): number {
  const inBody = (x: number, y: number) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    return (
      px >= 0 && py >= 0 && px < sil.width && py < sil.height && sil.body[py * sil.width + px] === 1
    );
  };
  if (!inBody(from.x, from.y)) return 0;
  for (let k = 1; ; k++) {
    const d = k * LIMB_STEP;
    if (!inBody(from.x + d * dir.x, from.y + d * dir.y)) return d - LIMB_STEP / 2;
  }
}

/** The body's pixels on the rows whose centres lie from `fromY` to `toY`. */
function bodyArea(sil: Silhouette, fromY: number, toY: number): number {
  const first = Math.max(0, Math.ceil(fromY - 0.5));
  const last = Math.min(sil.height - 1, Math.floor(toY - 0.5));
  let n = 0;
  for (let y = first; y <= last; y++) {
    for (let x = 0; x < sil.width; x++) n += sil.body[y * sil.width + x]!;
  }
  return n;
}

type Reducer = (rows: RowWidth[]) => { width: number; row: RowWidth | null };

const widest: Reducer = (rows) => extreme(rows, (a, b) => a > b);
const narrowest: Reducer = (rows) => extreme(rows, (a, b) => a < b);

function extreme(rows: RowWidth[], better: (a: number, b: number) => boolean) {
  let row: RowWidth | null = null;
  for (const r of rows) if (!row || better(r.width, row.width)) row = r;
  return { width: row?.width ?? 0, row };
}

/** The median width (the mean of the middle two of an even count), and the lower middle row. */
const median: Reducer = (rows) => {
  if (rows.length === 0) return { width: 0, row: null };
  const sorted = [...rows].sort((a, b) => a.width - b.width);
  const m = (sorted.length - 1) / 2;
  const lower = sorted[Math.floor(m)]!;
  return { width: (lower.width + sorted[Math.ceil(m)]!.width) / 2, row: lower };
};

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
