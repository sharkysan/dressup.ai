/**
 * A synthetic full-length figure for the body measurement (spec §6): a front-facing person drawn into a
 * category mask at the analysed image's size, the way the segmenter labels one. A head disc, a torso
 * profile and thick segments for the arms and legs, with the matching 33 pose landmarks. `expected` is
 * what measureBody should find, computed from the drawn shapes.
 */
import { MEASURE, type BodyFeatures } from '../../src/analysis/body/measure';
import {
  MASK,
  type Box,
  type CategoryMask,
  type Point2,
  type PoseObservation,
} from '../../src/analysis/types';
import { FACE_LANDMARKS, type Correspondence } from '../../src/likeness/correspondence';

export type SynthBodyOptions = {
  /** The analysed image's size; 1000 × 1000 by default. */
  width?: number;
  height?: number;
  /** The figure's midline; x 300 by default. */
  centreX?: number;
  /** The top of the head (y) and the height from there to the ankle line; 100 and 800 px by default. */
  headTopY?: number;
  heightPx?: number;
  /**
   * The torso's half-widths as fractions of `heightPx`: its shoulder block (t −0.1..0.15, t = 0 at the
   * shoulder line and 1 at the hip line), the bust band (t 0.3..0.4), the waist (t 0.7) and the hips
   * (t 1..1.2), joined by straight lines.
   */
  halfWidths?: { shoulder: number; bust: number; waist: number; hip: number };
  /** 'clear': both arms angled away from the torso. A touching arm runs down the torso's side. */
  arms?: 'clear' | 'leftTouching' | 'bothTouching';
  /**
   * A touching arm drawn this far (px) further out, with background between it and the torso; 0 by
   * default.
   */
  armGapPx?: number;
  /** The thighs touch at the midline (by default they are apart). */
  legsTouching?: boolean;
  /**
   * Long hair behind the figure: wider than the shoulders above the shoulder line, and showing past the
   * torso's side in the bust band.
   */
  hairPastShoulders?: boolean;
  /** A second full figure, with long hair, to the right: outside the person region. */
  secondPerson?: boolean;
};

export type SynthBody = {
  pose: PoseObservation;
  mask: CategoryMask;
  faceBox: Box;
  headTopY: number;
  expected: BodyFeatures;
};

type Size = { width: number; height: number };
type Layer = Uint8Array;
type Limb = [Point2, Point2, Point2]; // shoulder, elbow, wrist; or hip, knee, ankle

type FigureSpec = {
  centreX: number;
  headTopY: number;
  heightPx: number;
  halfWidths: { shoulder: number; bust: number; waist: number; hip: number };
  touching: { left: boolean; right: boolean };
  armGapPx: number;
  legsTouching: boolean;
  hair: boolean;
};

type Figure = {
  /** The body's parts, each a 0/1 layer over the image. */
  head: Layer;
  neck: Layer;
  torso: Layer;
  arms: Layer[];
  legs: Layer[];
  hair: Layer | null;
  /** The 33 pose landmarks, in pixels. */
  points: Point2[];
  faceBox: Box;
  /** The subject's left limb first. */
  armAxes: Limb[];
  legAxes: Limb[];
  radii: { arm: number; thigh: number; calf: number };
  shoulderY: number;
  hipY: number;
  ankleY: number;
};

/** At the default height of 800 px: the shoulder block's 112 px, the bust's 85, the waist's 70, the hips' 92. */
const HALF_WIDTHS = { shoulder: 0.14, bust: 0.10625, waist: 0.0875, hip: 0.115 };

export function synthBody(opts: SynthBodyOptions = {}): SynthBody {
  const size = { width: opts.width ?? 1000, height: opts.height ?? 1000 };
  const arms = opts.arms ?? 'clear';
  const spec: FigureSpec = {
    centreX: opts.centreX ?? 300,
    headTopY: opts.headTopY ?? 100,
    heightPx: opts.heightPx ?? 800,
    halfWidths: opts.halfWidths ?? HALF_WIDTHS,
    touching: { left: arms !== 'clear', right: arms === 'bothTouching' },
    armGapPx: opts.armGapPx ?? 0,
    legsTouching: opts.legsTouching ?? false,
    hair: opts.hairPastShoulders ?? false,
  };
  const figure = drawFigure(size, spec);
  const figures = [figure];
  if (opts.secondPerson) {
    const centreX = spec.centreX + Math.round(0.62 * spec.heightPx);
    const touching = { left: false, right: false };
    figures.push(drawFigure(size, { ...spec, centreX, touching, legsTouching: false, hair: true }));
  }

  const data = new Uint8Array(size.width * size.height); // background
  for (const f of figures) {
    // Hair behind the body; the base layer (the torso) as clothes; the arms and legs over it.
    const parts: [Layer | null, number][] = [
      [f.hair, MASK.hair],
      [f.head, MASK.faceSkin],
      [f.neck, MASK.bodySkin],
      [f.torso, MASK.clothes],
      ...[...f.arms, ...f.legs].map((l): [Layer, number] => [l, MASK.bodySkin]),
    ];
    for (const [layer, category] of parts) {
      if (!layer) continue;
      for (let i = 0; i < data.length; i++) if (layer[i]) data[i] = category;
    }
  }

  return {
    pose: poseOf(figure, size),
    mask: { width: size.width, height: size.height, data },
    faceBox: figure.faceBox,
    headTopY: spec.headTopY,
    expected: expectedFeatures(figure, size, spec.heightPx),
  };
}

/**
 * A correspondence with only what headTopFactor reads: landmark 10 at base height `faceTop`, 152 at
 * `chin`, the head's full-weight vertices up to `skullTop` (m), and a vertex of weight 0.99 above them
 * that the head top leaves out.
 */
export function headCorrespondence(
  y: { faceTop: number; chin: number; skullTop: number } = {
    faceTop: 1.5,
    chin: 1.4,
    skullTop: 1.54,
  },
): Correspondence {
  const at = (height: number) => ({
    triangle: [0, 0, 0],
    bary: [1, 0, 0],
    uv: [0, 0],
    position: [0, height, 0],
  });
  const landmarks = Array.from({ length: FACE_LANDMARKS }, () => at(y.chin));
  landmarks[10] = at(y.faceTop);
  return {
    version: 1,
    landmarks,
    head: {
      vertices: [0, 1, 2, 3],
      weights: [1, 1, 0.999, 0.99],
      positions: [0, y.faceTop, 0, 0, y.skullTop, 0, 0, y.chin, 0, 0, y.skullTop + 0.1, 0],
    },
  } as unknown as Correspondence;
}

function drawFigure(size: Size, f: FigureSpec): Figure {
  const u = f.heightPx;
  const px = (fraction: number) => Math.round(fraction * u);
  const cx = f.centreX;
  const top = f.headTopY;
  const rh = px(0.0625);
  const shoulderY = top + px(0.18);
  const hipY = top + px(0.525);
  const kneeY = top + px(0.765);
  const ankleY = top + u;
  const yAt = (t: number) => shoulderY + t * (hipY - shoulderY);
  const half = {
    shoulder: px(f.halfWidths.shoulder),
    bust: px(f.halfWidths.bust),
    waist: px(f.halfWidths.waist),
    hip: px(f.halfWidths.hip),
  };
  const radii = { arm: px(0.0225), thigh: px(0.045), calf: px(0.0325) };

  // Offsets from the midline. A touching arm's inner edge runs along the torso's side: the upper arm
  // through the middle of the bust band and the waist (t 0.7, the elbow), the forearm from there to the
  // hips at the hip band's end (t 1.1); all of it `armGapPx` further out. Clear arms leave the same
  // shoulders, angled outward.
  const shoulderOut = 2 * half.bust - half.waist + radii.arm;
  const elbowY = yAt(0.7);
  const wristY = yAt(1.25);
  const armOffsets = (touching: boolean) => {
    const elbow = touching ? half.waist + radii.arm : shoulderOut + px(0.04);
    const wrist = touching
      ? elbow + ((half.hip - half.waist) * (1.25 - 0.7)) / (1.1 - 0.7)
      : elbow + px(0.03);
    return { elbow, wrist };
  };
  const legOut = f.legsTouching ? radii.thigh : px(0.0575);
  /** +1: the subject's left, on the image's right. */
  const at = (sign: number, offset: number, y: number): Point2 => ({ x: cx + sign * offset, y });
  const arm = (sign: number, touching: boolean): Limb => {
    const o = armOffsets(touching);
    const gap = touching ? f.armGapPx : 0;
    return [
      at(sign, shoulderOut + gap, shoulderY),
      at(sign, o.elbow + gap, elbowY),
      at(sign, o.wrist + gap, wristY),
    ];
  };
  const leg = (sign: number): Limb => [
    at(sign, legOut, hipY),
    at(sign, legOut, kneeY),
    at(sign, legOut, ankleY),
  ];
  const armAxes = [arm(1, f.touching.left), arm(-1, f.touching.right)];
  const legAxes = [leg(1), leg(-1)];

  const layer = () => new Uint8Array(size.width * size.height);
  const head = layer();
  capsule(head, size, { x: cx, y: top + rh }, { x: cx, y: top + rh }, rh);
  const neck = layer();
  rect(neck, size, cx - px(0.028), top + 2 * rh - px(0.01), cx + px(0.028), yAt(-0.05));
  const torso = layer();
  profile(torso, size, cx, yAt, [
    [-0.1, half.shoulder],
    [0.15, half.shoulder],
    [0.3, half.bust],
    [0.4, half.bust],
    [0.7, half.waist],
    [1, half.hip],
    [1.2, half.hip],
  ]);
  const arms = armAxes.map(([s, e, w]) => {
    const l = layer();
    capsule(l, size, s, e, radii.arm);
    capsule(l, size, e, w, radii.arm);
    return l;
  });
  const legs = legAxes.map(([h, k, a]) => {
    const l = layer();
    capsule(l, size, h, k, radii.thigh);
    capsule(l, size, k, a, radii.calf);
    return l;
  });
  let hair: Layer | null = null;
  if (f.hair) {
    hair = layer();
    capsule(
      hair,
      size,
      { x: cx, y: top + rh - px(0.005) },
      { x: cx, y: top + rh },
      rh + px(0.0125),
    );
    const cape = half.shoulder + px(0.05);
    rect(hair, size, cx - cape, top + rh, cx + cape, shoulderY);
    for (const sign of [1, -1]) {
      const inner = half.bust - px(0.03);
      const outer = half.bust + px(0.015);
      const [x0, x1] = sign > 0 ? [cx + inner, cx + outer] : [cx - outer, cx - inner];
      rect(hair, size, x0, shoulderY, x1, yAt(0.5));
    }
  }

  const points = landmarks({ cx, top, rh, armAxes, legAxes, px });
  const faceHalf = Math.round(0.8 * rh);
  const faceTop = top + Math.round(0.4 * rh);
  const faceBox = {
    x: cx - faceHalf,
    y: faceTop,
    width: 2 * faceHalf,
    height: top + 2 * rh - faceTop,
  };
  return {
    head,
    neck,
    torso,
    arms,
    legs,
    hair,
    points,
    faceBox,
    armAxes,
    legAxes,
    radii,
    shoulderY,
    hipY,
    ankleY,
  };
}

/** MediaPipe's 33 pose landmarks for the figure (odd indices from 11 on: the subject's left). */
function landmarks(g: {
  cx: number;
  top: number;
  rh: number;
  armAxes: Limb[];
  legAxes: Limb[];
  px: (fraction: number) => number;
}): Point2[] {
  const { cx, top, rh, px } = g;
  const head = (dx: number, dy: number): Point2 => ({ x: cx + dx * rh, y: top + dy * rh });
  const points: Point2[] = [
    head(0, 1.2), // nose
    head(0.15, 0.9), // left eye: inner, centre, outer
    head(0.3, 0.9),
    head(0.45, 0.9),
    head(-0.15, 0.9), // right eye
    head(-0.3, 0.9),
    head(-0.45, 0.9),
    head(0.9, 1), // ears
    head(-0.9, 1),
    head(0.25, 1.5), // mouth
    head(-0.25, 1.5),
  ];
  const [armL, armR] = g.armAxes as [Limb, Limb];
  const [legL, legR] = g.legAxes as [Limb, Limb];
  for (let j = 0; j < 3; j++) points.push(armL[j]!, armR[j]!); // 11–16
  for (const [dx, dy] of [
    [px(0.006), px(0.05)], // pinky
    [0, px(0.055)], // index
    [-px(0.006), px(0.035)], // thumb
  ] as const) {
    points.push({ x: armL[2].x + dx, y: armL[2].y + dy }, { x: armR[2].x - dx, y: armR[2].y + dy });
  }
  for (let j = 0; j < 3; j++) points.push(legL[j]!, legR[j]!); // 23–28
  points.push(
    { x: legL[2].x, y: legL[2].y + px(0.02) }, // heels
    { x: legR[2].x, y: legR[2].y + px(0.02) },
    { x: legL[2].x + px(0.01), y: legL[2].y + px(0.035) }, // foot index
    { x: legR[2].x - px(0.01), y: legR[2].y + px(0.035) },
  );
  return points;
}

/** The figure's pose: every landmark visible, the world frame metric and hip-centred, shoulders level. */
function poseOf(figure: Figure, size: Size): PoseObservation {
  const [hipL, hipR] = [figure.points[23]!, figure.points[24]!];
  const centre = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const metre = (figure.ankleY - figure.faceBox.y) / 1.6;
  return {
    landmarks: figure.points.map((p) => ({
      x: p.x / size.width,
      y: p.y / size.height,
      z: 0,
      visibility: 1,
    })),
    world: figure.points.map((p) => ({
      x: (p.x - centre.x) / metre,
      y: (p.y - centre.y) / metre,
      z: 0,
    })),
    imageWidth: size.width,
    imageHeight: size.height,
  };
}

/**
 * The features of the drawn figure: the torso bands' widths from the drawn parts, row by row (the
 * shoulder band over every part, the others over the torso, neck and legs, without the arms), the limbs'
 * drawn thicknesses, the lengths from the landmarks, and the body's pixels from the shoulder line to
 * the ankle line.
 */
function expectedFeatures(figure: Figure, size: Size, heightPx: number): BodyFeatures {
  const all = union(size, [figure.head, figure.neck, figure.torso, ...figure.arms, ...figure.legs]);
  const trunk = union(size, [figure.neck, figure.torso, ...figure.legs]);
  const torsoLength = figure.hipY - figure.shoulderY;
  const rows = ([t0, t1]: readonly [number, number]) => {
    const out: number[] = [];
    for (let y = 0; y < size.height; y++) {
      const t = (y + 0.5 - figure.shoulderY) / torsoLength;
      if (t >= t0 && t <= t1) out.push(y);
    }
    return out;
  };
  const widths = (layer: Layer, band: readonly [number, number]) =>
    rows(band).map((y) => extent(layer, size, y));
  const { bands } = MEASURE;
  const sorted = widths(trunk, bands.bust).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
  const length = (limbs: Limb[]) =>
    limbs.reduce((s, [a, b, c]) => s + dist(a, b) + dist(b, c), 0) / limbs.length;
  let area = 0;
  for (const y of rows([0, (figure.ankleY - figure.shoulderY) / torsoLength])) {
    for (let x = 0; x < size.width; x++) area += all[y * size.width + x]!;
  }
  const px = {
    shoulderWidth: Math.max(...widths(all, bands.shoulder)),
    bustWidth: median,
    waistWidth: Math.min(...widths(trunk, bands.waist)),
    hipWidth: Math.max(...widths(trunk, bands.hip)),
    thighWidth: 2 * figure.radii.thigh,
    calfWidth: 2 * figure.radii.calf,
    upperArmWidth: 2 * figure.radii.arm,
    legLength: length(figure.legAxes),
    armLength: length(figure.armAxes),
  };
  return {
    ...(Object.fromEntries(Object.entries(px).map(([k, v]) => [k, v / heightPx])) as Omit<
      BodyFeatures,
      'area'
    >),
    area: area / heightPx ** 2,
  };
}

function union(size: Size, layers: Layer[]): Layer {
  const out = new Uint8Array(size.width * size.height);
  for (const l of layers) for (let i = 0; i < out.length; i++) out[i] = out[i]! | l[i]!;
  return out;
}

/** From the row's first set pixel to its last, in pixels; 0 when none is set. */
function extent(layer: Layer, size: Size, y: number): number {
  let first = -1;
  let last = -1;
  for (let x = 0; x < size.width; x++) {
    if (!layer[y * size.width + x]) continue;
    if (first < 0) first = x;
    last = x;
  }
  return first < 0 ? 0 : last - first + 1;
}

/** Sets the pixels whose centres lie within `r` of the segment ab. */
function capsule(layer: Layer, size: Size, a: Point2, b: Point2, r: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r));
  const x1 = Math.min(size.width - 1, Math.ceil(Math.max(a.x, b.x) + r));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
  const y1 = Math.min(size.height - 1, Math.ceil(Math.max(a.y, b.y) + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a.x;
      const py = y + 0.5 - a.y;
      const t = len2 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
      if ((px - t * dx) ** 2 + (py - t * dy) ** 2 <= r * r) layer[y * size.width + x] = 1;
    }
  }
}

/** Sets the pixels whose centres lie in [x0, x1) × [y0, y1). */
function rect(layer: Layer, size: Size, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, Math.ceil(y0 - 0.5)); y < Math.min(size.height, y1 - 0.5); y++) {
    for (let x = Math.max(0, Math.ceil(x0 - 0.5)); x < Math.min(size.width, x1 - 0.5); x++) {
      layer[y * size.width + x] = 1;
    }
  }
}

/**
 * The torso: in each row whose centre lies between the first knot's t and the last's (`yAt` maps t to
 * y), the pixels whose centres lie within the half-width interpolated between the knots of `cx`.
 */
function profile(
  layer: Layer,
  size: Size,
  cx: number,
  yAt: (t: number) => number,
  knots: [number, number][],
): void {
  const [first, last] = [knots[0]!, knots[knots.length - 1]!];
  const tAt = (y: number) => (y - yAt(0)) / (yAt(1) - yAt(0));
  for (let y = 0; y < size.height; y++) {
    const t = tAt(y + 0.5);
    if (t < first[0] || t > last[0]) continue;
    const k = Math.max(
      1,
      knots.findIndex(([kt]) => kt >= t),
    );
    const [ta, ha] = knots[k - 1]!;
    const [tb, hb] = knots[k]!;
    const hw = ha + ((t - ta) / (tb - ta)) * (hb - ha);
    for (let x = 0; x < size.width; x++) {
      if (Math.abs(x + 0.5 - cx) <= hw) layer[y * size.width + x] = 1;
    }
  }
}
