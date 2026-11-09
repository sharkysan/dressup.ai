/**
 * Deterministic analysis fixtures synthesised from MediaPipe's canonical face model (478 points, cm,
 * +x = subject's left, +y up, +z toward the viewer). Produces a FaceObservation, a category mask and an
 * RGBA image with hair/skin/iris/lip regions so mapping functions can be unit-tested without MediaPipe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LM, faceBox, polygonMask, toPixels } from '../../src/analysis/landmarks';
import {
  MASK,
  type CategoryMask,
  type FaceObservation,
  type Point2,
  type RgbaImage,
} from '../../src/analysis/types';
import { hexToRgb } from '../../src/color/oklab';

export type HairSpec = {
  length: 'none' | 'short' | 'medium' | 'long';
  bangs?: boolean;
  parting?: 'left' | 'center' | 'right';
  volume?: 'low' | 'medium' | 'high';
};

export type SynthOptions = {
  width?: number;
  height?: number;
  scale?: number; // px per cm
  rollDeg?: number;
  yawDeg?: number;
  centre?: Point2;
  hair?: HairSpec;
  colors?: { skin?: string; hair?: string; iris?: string; lips?: string; background?: string };
  secondFace?: { scale: number; centre: Point2 };
  /** Lift the upper-brow points by this fraction of the brow chord (brow shape tests). */
  browLift?: { amount: number; outerOnly?: boolean };
};

let canonical: [number, number, number][] | null = null;

function loadCanonical(): [number, number, number][] {
  if (canonical) return canonical;
  const file = path.resolve('tests/fixtures/face_model_with_iris.obj');
  canonical = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('v '))
    .map((l) => l.split(/\s+/).slice(1, 4).map(Number) as [number, number, number]);
  if (canonical.length !== 478) throw new Error(`expected 478 vertices, got ${canonical.length}`);
  return canonical;
}

/** Column-major 4×4 of Ry(yaw)·Rx(pitch)·Rz(roll). */
function rotationMatrix(yawDeg: number, pitchDeg: number, rollDeg: number): number[] {
  const [y, p, r] = [yawDeg, pitchDeg, rollDeg].map((d) => (d * Math.PI) / 180) as [
    number,
    number,
    number,
  ];
  const cy = Math.cos(y),
    sy = Math.sin(y),
    cx = Math.cos(p),
    sx = Math.sin(p),
    cz = Math.cos(r),
    sz = Math.sin(r);
  const R = [
    [cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx],
    [cx * sz, cx * cz, -sx],
    [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx],
  ];
  const m = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) m[col * 4 + row] = R[row]![col]!;
  m[15] = 1;
  return m;
}

function projectFace(
  points: [number, number, number][],
  matrix: number[],
  scale: number,
  centre: Point2,
  width: number,
  height: number,
  browLift?: SynthOptions['browLift'],
): FaceObservation {
  const r = (row: number, col: number) => matrix[col * 4 + row]!;
  const landmarks = points.map(([X, Y, Z]) => {
    const x = r(0, 0) * X + r(0, 1) * Y + r(0, 2) * Z;
    const y = r(1, 0) * X + r(1, 1) * Y + r(1, 2) * Z;
    const z = r(2, 0) * X + r(2, 1) * Y + r(2, 2) * Z;
    return {
      x: (centre.x + x * scale) / width,
      y: (centre.y - y * scale) / height,
      z: (-z * scale) / width,
    };
  });
  if (browLift) {
    for (const brow of [LM.browR, LM.browL]) {
      const inner = landmarks[brow.upper[4]!]!;
      const outer = landmarks[brow.upper[0]!]!;
      const chord = Math.hypot((outer.x - inner.x) * width, (outer.y - inner.y) * height);
      const lift = (browLift.amount * chord) / height;
      const targets = browLift.outerOnly ? [brow.upper[0]!] : brow.upper.slice(1, 4);
      for (const i of targets) landmarks[i]!.y -= lift;
    }
  }
  return { landmarks, matrix, blendshapes: {}, imageWidth: width, imageHeight: height };
}

function fillRect(
  mask: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value = 1,
) {
  const xa = Math.max(0, Math.floor(x0)),
    xb = Math.min(w - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)),
    yb = Math.min(h - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) mask[y * w + x] = value;
}

function fillEllipse(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  value = 1,
) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x + 0.5 - cx) / rx,
        dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) mask[y * w + x] = value;
    }
  }
}

/** Category mask regions at full resolution for one face; returned as a byte category image. */
function paintCategories(
  cat: Uint8Array,
  w: number,
  h: number,
  face: FaceObservation,
  hair: HairSpec,
) {
  const px = toPixels(face);
  const box = faceBox(px);
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const browY = [...LM.browR.upper, ...LM.browL.upper].reduce((s, i) => s + px[i]!.y, 0) / 10;
  const chinY = px[LM.chin]!.y;
  // Face skin: ellipse of the oval; neck: body skin; clothes below shoulders.
  fillEllipse(cat, w, h, cx, cy, box.width / 2, box.height / 2, MASK.faceSkin);
  fillRect(
    cat,
    w,
    h,
    cx - box.width * 0.2,
    chinY,
    cx + box.width * 0.2,
    chinY + box.height * 0.3,
    MASK.bodySkin,
  );
  fillRect(
    cat,
    w,
    h,
    cx - box.width * 1.2,
    chinY + box.height * 0.3,
    cx + box.width * 1.2,
    h,
    MASK.clothes,
  );
  if (hair.length === 'none') return;
  const strip = { low: 0.12, medium: 0.25, high: 0.45 }[hair.volume ?? 'medium'] * box.width;
  const top = box.y - box.height * 0.35;
  const bottom =
    hair.length === 'short'
      ? chinY - box.height * 0.15
      : hair.length === 'medium'
        ? chinY + box.height * 0.5
        : chinY + box.height * 1.3;
  // Cap above the face.
  fillRect(
    cat,
    w,
    h,
    box.x - strip,
    top,
    box.x + box.width + strip,
    box.y + box.height * 0.08,
    MASK.hair,
  );
  // Side strips down to the length.
  fillRect(cat, w, h, box.x - strip, top, box.x, bottom, MASK.hair);
  fillRect(cat, w, h, box.x + box.width, top, box.x + box.width + strip, bottom, MASK.hair);
  if (hair.bangs) {
    const parting = hair.parting ?? 'center';
    // Forehead band between the top of the face and the brows; leave a gap on the parting side.
    // 'left' = subject's left = image right.
    const x0 = parting === 'right' ? box.x + box.width * 0.5 : box.x;
    const x1 = parting === 'left' ? box.x + box.width * 0.5 : box.x + box.width;
    fillRect(cat, w, h, x0, box.y, x1, browY - box.height * 0.02, MASK.hair);
  }
}

export function synthFace(opts: SynthOptions = {}): {
  face: FaceObservation;
  faces: FaceObservation[];
  mask: CategoryMask;
  image: RgbaImage;
} {
  const width = opts.width ?? 640;
  const height = opts.height ?? 800;
  const scale = opts.scale ?? 12;
  const centre = opts.centre ?? { x: width / 2, y: height / 2 };
  const hair: HairSpec = opts.hair ?? { length: 'medium', bangs: false, volume: 'medium' };
  const points = loadCanonical();
  const matrix = rotationMatrix(opts.yawDeg ?? 0, 0, opts.rollDeg ?? 0);
  const face = projectFace(points, matrix, scale, centre, width, height, opts.browLift);
  const faces = [face];

  const cat = new Uint8Array(width * height); // background = 0
  paintCategories(cat, width, height, face, hair);
  if (opts.secondFace) {
    const other = projectFace(
      points,
      rotationMatrix(0, 0, 0),
      opts.secondFace.scale,
      opts.secondFace.centre,
      width,
      height,
    );
    paintCategories(cat, width, height, other, { length: 'long', volume: 'high' });
    faces.push(other);
  }

  // Image: paint regions by category, then irises and lips from landmarks.
  const colors = {
    skin: '#c68642',
    hair: '#2b1b12',
    iris: '#6b4423',
    lips: '#b35a5a',
    background: '#d8d8d8',
    ...opts.colors,
  };
  const rgb = (hex: string) =>
    hexToRgb(hex).map((v) => Math.round(v * 255)) as [number, number, number];
  const byCat: Record<number, [number, number, number]> = {
    [MASK.background]: rgb(colors.background),
    [MASK.hair]: rgb(colors.hair),
    [MASK.bodySkin]: rgb(colors.skin),
    [MASK.faceSkin]: rgb(colors.skin),
    [MASK.clothes]: [90, 90, 110],
    [MASK.others]: [120, 120, 120],
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = byCat[cat[i]!]!;
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  const px = toPixels(face);
  const lips = polygonMask(px, LM.outerLips, width, height);
  const lipRgb = rgb(colors.lips);
  for (let i = 0; i < lips.length; i++) if (lips[i]) data.set([...lipRgb, 255], i * 4);
  for (const iris of [LM.irisR, LM.irisL]) {
    const c = px[iris[0]!]!;
    const r = Math.hypot(px[iris[1]!]!.x - px[iris[3]!]!.x, px[iris[1]!]!.y - px[iris[3]!]!.y) / 2;
    const disc = new Uint8Array(width * height);
    fillEllipse(disc, width, height, c.x, c.y, r, r);
    const pupil = new Uint8Array(width * height);
    fillEllipse(pupil, width, height, c.x, c.y, r * 0.4, r * 0.4);
    const irisRgb = rgb(colors.iris);
    for (let i = 0; i < disc.length; i++) {
      if (pupil[i]) data.set([10, 10, 10, 255], i * 4);
      else if (disc[i]) data.set([...irisRgb, 255], i * 4);
    }
  }

  // Category mask at quarter resolution, nearest-neighbour, as the segmenter would give us.
  const mw = Math.round(width / 4),
    mh = Math.round(height / 4);
  const maskData = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) / mw) * width));
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) / mh) * height));
      maskData[y * mw + x] = cat[sy * width + sx]!;
    }
  }

  return {
    face,
    faces,
    mask: { width: mw, height: mh, data: maskData },
    image: { width, height, data },
  };
}
