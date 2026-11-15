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
export type WidthFeature = (typeof WIDTH_FEATURES)[number];
export type BodyFeature = (typeof BODY_FEATURES)[number];
export type BodyFeatures = Record<BodyFeature, number>;

export const MEASURE = {
  regionFaceExpand: 2.5, // the person region: this face box multiple ∪ the pose landmarks' box …
  regionMargin: 0.1, // … grown by this fraction of that box's height on every side (§6)
  gapFraction: 0.01, // of heightPx: background gaps a torso span bridges
  // × the upper arm's width: how far from an arm's axis the gap between arm and torso may start; a hole
  // farther in is the torso's own (a strap, a speckle). On the avatar's renders it starts ≤ 1.19×.
  armGapReach: 1.5,
  // The least a side ending at the gap to its arm may reach, × the other side's half-width and × the
  // half-width from its own arm (to the axis, less half the upper arm's width); one that comes shorter
  // ends at a hole in the torso. On the avatar's renders such a side reaches ≥ 0.775× and ≥ 0.74×.
  sideAgreement: 0.75,
  axisAgreement: 0.7,
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

/**
 * The body silhouette and the hair, 0/1 at the analysed size, each restricted to the person region;
 * `clothes` marks the body's clothes (the rest of it is skin).
 */
type Silhouette = {
  body: Uint8Array;
  hair: Uint8Array;
  clothes: Uint8Array;
  width: number;
  height: number;
};

/**
 * A torso width measured on one row: the half-widths about the midline, as a segment. `fromAxes`: both
 * arms touched, so both sides were taken from the arm axes rather than seen.
 */
type RowWidth = { width: number; a: Point2; b: Point2; fromAxes: boolean };

type Arm = { side: 'left' | 'right'; shoulder: Point2; elbow: Point2; wrist: Point2 };

/**
 * The body's features from the pose landmarks and the segmenter's mask (spec §6), in analysed pixels,
 * left and right averaged. `width` × `height` is the analysed image, which the pose's landmarks and
 * `faceBox` are over; the mask is resampled to it.
 *
 * - Height: the ankle line (mean y of 27, 28) − `headTopY`.
 * - Silhouette: bodySkin ∪ faceSkin ∪ clothes, the hair kept apart, both within personRegion.
 * - Torso width at a row: the span of body ∪ hair through the midline (the line through the mid-shoulder
 *   and mid-hip points), bridging background gaps up to `gapFraction` × heightPx long, one at the
 *   midline too; then the hair is trimmed off both ends. A row whose span does not hold the midline is
 *   skipped. In the bust, waist and hip bands a side whose arm axis (shoulder→elbow, or elbow→wrist
 *   below the elbow) lies inside the span ends at the background between arm and torso, when the span
 *   bridged some that starts within `armGapReach` × the upper arm's width of the axis, before the walk
 *   from the axis passes from the arm's label (skin, or a sleeve's clothes) to the other (torsoEdge),
 *   and the side then reaches `sideAgreement` × the other side's half-width and `axisAgreement` × the
 *   half-width from its own arm (a hole farther in is the torso's own). Otherwise its arm touches: the
 *   side takes the other side's half-width, or, when both touch, each side ends at its axis less half
 *   the upper arm's width, and the row counts only in a band with no other row. Per band: the
 *   shoulder's widest row, the bust's median, the waist's narrowest, the hip's widest.
 * - Limb width: across the limb at `limbAt` along it, walking the perpendicular over the body (no hair)
 *   both ways to the background: twice the shorter half, so a hand on the thigh or touching legs never
 *   widen it. A side whose point is not the body (hair or an accessory over it) measures 0 and is left
 *   out of the mean; the torso's arm rules use the same upper-arm width.
 * - Lengths: hip→knee→ankle and shoulder→elbow→wrist. Area: the body's pixels from the shoulder line to
 *   the ankle line.
 * - Widths and lengths ÷ heightPx; the area ÷ heightPx².
 *
 * Null when there is no body to measure: heightPx ≤ 0, the hip line not below the shoulder line, or a
 * torso band with no row left (analyzePhoto then reports the body gate as 'not_visible').
 */
export function measureBody(input: {
  pose: PoseObservation;
  mask: CategoryMask;
  faceBox: Box;
  headTopY: number;
  width: number;
  height: number;
}): BodyMeasurement | null {
  const { pose, width, height } = input;
  const points = posePixels(pose);
  const at = (i: number) => points[i]!;
  const ankleY = (at(POSE.ankleL).y + at(POSE.ankleR).y) / 2;
  const heightPx = ankleY - input.headTopY;
  const shoulderY = (at(POSE.shoulderL).y + at(POSE.shoulderR).y) / 2;
  const hipY = (at(POSE.hipL).y + at(POSE.hipR).y) / 2;
  if (!(heightPx > 0) || !(hipY > shoulderY)) return null;
  const region = personRegion(pose, input.faceBox, width, height);
  const sil = silhouette(input.mask, region, width, height);

  const limb = (feature: BodyFeature, segments: [number, number][], along: number) => {
    const measured = segments.map(([a, b]) => limbWidth(sil, at(a), at(b), along));
    // A side whose point isn't the body's (hair or an accessory over it) measures 0 and is left out;
    // with neither side measured the width is 0, which analyzePhoto reports as not visible.
    const widths = measured.map((m) => m.width).filter((w) => w > 0);
    return {
      width: widths.length > 0 ? mean(widths) : 0,
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
  if (!torso) return null;

  const dist = (i: number, j: number) => Math.hypot(at(i).x - at(j).x, at(i).y - at(j).y);
  const legLength = mean([
    dist(POSE.hipL, POSE.kneeL) + dist(POSE.kneeL, POSE.ankleL),
    dist(POSE.hipR, POSE.kneeR) + dist(POSE.kneeR, POSE.ankleR),
  ]);
  const armLength = mean([
    dist(POSE.shoulderL, POSE.elbowL) + dist(POSE.elbowL, POSE.wristL),
    dist(POSE.shoulderR, POSE.elbowR) + dist(POSE.elbowR, POSE.wristR),
  ]);
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
  const clothes = new Uint8Array(width * height);
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
      if (c === MASK.clothes) clothes[i] = 1;
    }
  }
  return { body, hair, clothes, width, height };
}

/**
 * The four torso widths (px) by MEASURE.bands, with the rows they came from and the touching arms; null
 * when a band has no row (its rows are off the image, or every one is skipped: torsoSpan).
 */
function torsoWidths(
  sil: Silhouette,
  at: (i: number) => Point2,
  heightPx: number,
  upperArmWidth: number,
): {
  widths: { shoulder: number; bust: number; waist: number; hip: number };
  armsTouching: { left: boolean; right: boolean };
  lines: BodyMeasurement['lines'];
} | null {
  const midpoint = (a: Point2, b: Point2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const shoulder = midpoint(at(POSE.shoulderL), at(POSE.shoulderR));
  const hip = midpoint(at(POSE.hipL), at(POSE.hipR));
  const length = hip.y - shoulder.y;
  const gapPx = MEASURE.gapFraction * heightPx;
  const armReach = MEASURE.armGapReach * upperArmWidth;
  const arms: Arm[] = [
    { side: 'left', shoulder: at(POSE.shoulderL), elbow: at(POSE.elbowL), wrist: at(POSE.wristL) },
    { side: 'right', shoulder: at(POSE.shoulderR), elbow: at(POSE.elbowR), wrist: at(POSE.wristR) },
  ];
  const armsTouching = { left: false, right: false };

  /** The rows whose centres lie in the band (t → shoulder.y + t × length; measureBody: length > 0). */
  const rows = ([t0, t1]: readonly [number, number]): number[] => {
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
    let { left, right } = span;
    let axisLo: number | null = null;
    let axisHi: number | null = null;
    /** A side's half-width taken from its touching arm: to the axis, less half the upper arm's width. */
    const fromAxis = (axis: number) =>
      axis < mid
        ? Math.max(0, mid - (axis + upperArmWidth / 2))
        : Math.max(0, axis - upperArmWidth / 2 - mid);
    if (armRule) {
      const gaps: { arm: Arm; x: number }[] = [];
      for (const arm of arms) {
        const x = axisX(arm, yc);
        if (x === null || x < span.left || x > span.right + 1) continue;
        // The span bridged a gap between the torso and this arm: the side ends at the gap.
        const edge = torsoEdge(sil, y, mid, x, span, armReach);
        if (edge !== null) {
          if (x < mid) left = edge;
          else right = edge;
          gaps.push({ arm, x });
          continue;
        }
        armsTouching[arm.side] = true;
        if (x < mid) axisLo ??= x;
        else axisHi ??= x;
      }
      // A side ending at a gap agrees with the other side and with its own arm: one that comes short
      // of `sideAgreement` × the other side's half-width (seen, at its own gap, or from its axis), or
      // of `axisAgreement` × the half-width from its own arm (fromAxis), ends at a hole in the torso,
      // and the arm touches. The first catches a hole on one side, the second holes on both alike.
      const loHalf = axisLo !== null ? fromAxis(axisLo) : mid - left;
      const hiHalf = axisHi !== null ? fromAxis(axisHi) : right + 1 - mid;
      for (const { arm, x } of gaps) {
        const isLo = x < mid;
        if ((isLo ? axisLo : axisHi) !== null) continue; // another arm touches on that side
        const [half, other] = isLo ? [loHalf, hiHalf] : [hiHalf, loHalf];
        if (half >= MEASURE.sideAgreement * other && half >= MEASURE.axisAgreement * fromAxis(x)) {
          continue;
        }
        armsTouching[arm.side] = true;
        if (isLo) axisLo = x;
        else axisHi = x;
      }
    }
    // Half-widths on the image's left (lo) and right (hi) of the midline, both ≥ 0: the span holds it.
    let lo = mid - left;
    let hi = right + 1 - mid;
    if (axisLo !== null && axisHi !== null) {
      lo = fromAxis(axisLo);
      hi = fromAxis(axisHi);
    } else if (axisLo !== null) {
      lo = hi;
    } else if (axisHi !== null) {
      hi = lo;
    }
    return {
      width: lo + hi,
      a: { x: mid - lo, y: yc },
      b: { x: mid + hi, y: yc },
      fromAxes: axisLo !== null && axisHi !== null,
    };
  };

  const band = (feature: BodyFeature, t: readonly [number, number], reduce: Reducer) => {
    const armRule = feature !== 'shoulderWidth';
    const measured = rows(t)
      .map((y) => measureRow(y, armRule))
      .filter((r): r is RowWidth => r !== null);
    // A row whose sides both come from the arm axes is an estimate: it counts only when no row is seen.
    const seen = measured.filter((r) => !r.fromAxes);
    const chosen = seen.length > 0 ? seen : measured;
    return chosen.length > 0 ? { feature, ...reduce(chosen) } : null;
  };
  const { bands } = MEASURE;
  const results = [
    band('shoulderWidth', bands.shoulder, widest),
    band('bustWidth', bands.bust, median),
    band('waistWidth', bands.waist, narrowest),
    band('hipWidth', bands.hip, widest),
  ];
  const [s, b, w, h] = results;
  if (!s || !b || !w || !h) return null;
  return {
    widths: { shoulder: s.width, bust: b.width, waist: w.width, hip: h.width },
    armsTouching,
    lines: [s, b, w, h].map(({ feature, row }) => ({ feature, a: row.a, b: row.b })),
  };
}

/**
 * The span (inclusive columns) of body ∪ hair on row `y` that holds the midline `mid`, bridging
 * background gaps up to `gapPx` long, the one the midline may lie in too; then the hair (and any gap it
 * bridged) trimmed off both ends. Null, and the row skipped, when the span does not hold the midline: it
 * lies in a wider gap, or in hair with the body on one side only (spec §6).
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
  const m = Math.floor(mid);
  if (m < 0 || m >= width) return null;
  // The set pixels nearest the midline on either side, m itself when set: the gap between them, if
  // any, is the one the midline lies in.
  let l = m;
  while (l >= 0 && !set(l)) l--;
  let r = m;
  while (r < width && !set(r)) r++;
  if (l < 0 || r >= width || r - l - 1 > gapPx) return null;
  const reach = (from: number, step: 1 | -1) => {
    let last = from;
    for (let x = from + step; x >= 0 && x < width; x += step) {
      if (set(x)) last = x;
      else if (Math.abs(x - last) > gapPx) break;
    }
    return last;
  };
  let left = reach(l, -1);
  let right = reach(r, 1);
  while (left <= right && !body[row + left]) left++;
  while (right >= left && !body[row + right]) right--;
  return left <= m && m <= right ? { left, right } : null;
}

/**
 * The torso's outer column on row `y` toward the arm whose axis is at `axis` (inside `span`), when
 * background separates the two: walking from the axis toward the midline, through the arm and over the
 * first gap, the first body column (hair there trimmed off, as at the span's ends). The gap must start
 * within `reach` px of the axis, about the arm's own extent, and before the walk passes from the arm's
 * label (skin, or a sleeve's clothes) to the other: there it enters the torso, and background farther
 * in is a hole in the torso. Null when the walk meets the midline, passes `reach` or changes label
 * first: the arm touches the torso.
 */
function torsoEdge(
  sil: Silhouette,
  y: number,
  mid: number,
  axis: number,
  span: { left: number; right: number },
  reach: number,
): number | null {
  const { body, hair, clothes, width } = sil;
  const row = y * width;
  const set = (x: number) => (body[row + x]! | hair[row + x]!) === 1;
  const m = Math.floor(mid);
  const step = axis < mid ? 1 : -1;
  let x = Math.min(span.right, Math.max(span.left, Math.floor(axis)));
  // The arm's label, skin or clothes, from the walk's first body column; hair, over either, is passed.
  let armClothes: number | null = null;
  while (x !== m && set(x)) {
    if (body[row + x]) {
      armClothes ??= clothes[row + x]!;
      if (clothes[row + x] !== armClothes) return null;
    }
    x += step;
  }
  // The gap's near edge: column x's left side walking right, its right side walking left.
  const start = step > 0 ? x - axis : axis - (x + 1);
  if (x === m || start > reach) return null;
  while (x !== m && !set(x)) x += step;
  while (x !== m && !body[row + x]) x += step;
  return x === m ? null : x;
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

/** A band's width from its rows (at least one), and the row it came from. */
type Reducer = (rows: RowWidth[]) => { width: number; row: RowWidth };

const widest: Reducer = (rows) => extreme(rows, (a, b) => a > b);
const narrowest: Reducer = (rows) => extreme(rows, (a, b) => a < b);

function extreme(rows: RowWidth[], better: (a: number, b: number) => boolean) {
  let row = rows[0]!;
  for (const r of rows) if (better(r.width, row.width)) row = r;
  return { width: row.width, row };
}

/** The median width (the mean of the middle two of an even count), and the lower middle row. */
const median: Reducer = (rows) => {
  const sorted = [...rows].sort((a, b) => a.width - b.width);
  const m = (sorted.length - 1) / 2;
  const lower = sorted[Math.floor(m)]!;
  return { width: (lower.width + sorted[Math.ceil(m)]!.width) / 2, row: lower };
};

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}
