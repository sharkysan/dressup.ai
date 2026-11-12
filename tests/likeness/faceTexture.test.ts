import fs from 'node:fs';
import { LM, faceBox, polygonMask, toPixels } from '../../src/analysis/landmarks';
import type { Point2, RgbaImage } from '../../src/analysis/types';
import { hexToOklab, hexToRgb, rgbToHex } from '../../src/color/oklab';
import {
  FACE_LANDMARKS,
  correspondenceSchema,
  type Correspondence,
} from '../../src/likeness/correspondence';
import {
  FACE_MASKS,
  FACE_TEXTURE_SIZE,
  projectFace,
  uvToTexel,
  warpTriangles,
} from '../../src/likeness/faceTexture';
import { CANONICAL_FACE_OBJ, readCanonicalFace } from '../../tools/base/canonicalFace';
import { synthFace, type SynthOptions } from '../../tools/test-fixtures/canonicalFace';

const CANON = readCanonicalFace(CANONICAL_FACE_OBJ);
const NOSE_TIP = 4;
const COLORS = {
  skin: '#c68642',
  hair: '#2b1b12',
  iris: '#2f5fc0',
  lips: '#c0205f',
  background: '#d8d8d8',
} as const;
/** synthFace's pupils. */
const PUPIL = '#0a0a0a';
/** Painted into the gap between the lips. */
const TEETH = '#f4f1e8';
/** Painted along the outside of the eyelid margins, 1.5 px wide. */
const LASHES = '#1c1412';

/**
 * The canonical face as a correspondence: each landmark's uv is its OBJ uv flipped to glTF (u, 1 − v),
 * so the face is upright in texel space; the face square is the whole texture. Only what projectFace
 * reads is meaningful; the rest is filled in to satisfy the schema.
 */
function synthCorrespondence(): Correspondence {
  const positions = CANON.positions.slice(0, FACE_LANDMARKS);
  return correspondenceSchema.parse({
    version: 1,
    bodyVertexCount: 1,
    canonical: positions.flat(),
    canonicalToBase: { scale: 0.01, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] },
    landmarks: positions.map((position, i) => ({
      triangle: [0, 0, 0],
      bary: [1, 0, 0],
      uv: [CANON.uvs[i]![0], 1 - CANON.uvs[i]![1]],
      position,
    })),
    triangles: CANON.triangles.filter((t) => t.every((i) => i < FACE_LANDMARKS)),
    faceUvRect: { u: 0, v: 0, size: 1 },
    head: { vertices: [], weights: [], positions: [] },
    zero: [],
  });
}

const CORR = synthCorrespondence();
const SIZE = FACE_TEXTURE_SIZE;
const TEXELS = CORR.landmarks.map((l) => uvToTexel(l.uv, CORR.faceUvRect, SIZE));

/**
 * A synthetic photo in projectFace's input form, made more like a real photo in four ways. synthFace's
 * skin is an ellipse that leaves background in the corners of the face oval: that becomes skin. Its
 * irises overhang the eyelids: they are clipped to the eye openings. The lids get lashes. And the gap
 * between the lips is painted as teeth. The hair mask is exact (the hair-coloured pixels).
 */
function photoInput(opts: SynthOptions = {}) {
  const { face, image } = synthFace({
    width: 640,
    height: 800,
    scale: 24,
    colors: COLORS,
    ...opts,
  });
  const landmarks = toPixels(face);
  const { width, height, data } = image;
  const mask = (indices: readonly number[]) => polygonMask(landmarks, indices, width, height);
  const [oval, eyeR, eyeL, mouth] = [
    LM.faceOval,
    FACE_MASKS.eyeR,
    FACE_MASKS.eyeL,
    FACE_MASKS.innerMouth,
  ].map(mask);
  const is = (i: number, hex: string) => rgb8(hex).every((v, c) => data[4 * i + c] === v);
  const paint = (i: number, hex: string) => data.set(rgb8(hex), 4 * i);
  const hair = new Uint8Array(width * height);
  for (let i = 0; i < hair.length; i++) {
    if (mouth![i]) paint(i, TEETH);
    else if (oval![i] && is(i, COLORS.background)) paint(i, COLORS.skin);
    else if ((is(i, COLORS.iris) || is(i, PUPIL)) && !eyeR![i] && !eyeL![i]) paint(i, COLORS.skin);
    hair[i] = is(i, COLORS.hair) ? 1 : 0;
  }
  for (const eye of [FACE_MASKS.eyeR, FACE_MASKS.eyeL]) {
    const lid = eye.map((i) => landmarks[i]!);
    const inside = eye === FACE_MASKS.eyeR ? eyeR! : eyeL!;
    const xs = lid.map((p) => p.x);
    const ys = lid.map((p) => p.y);
    for (let y = Math.floor(Math.min(...ys)) - 3; y <= Math.ceil(Math.max(...ys)) + 3; y++) {
      for (let x = Math.floor(Math.min(...xs)) - 3; x <= Math.ceil(Math.max(...xs)) + 3; x++) {
        const i = y * width + x;
        if (!inside[i] && distanceToPolygon({ x: x + 0.5, y: y + 0.5 }, lid) <= 1.5)
          paint(i, LASHES);
      }
    }
  }
  return { photo: image, landmarks, hair };
}

function rgb8(hex: string): [number, number, number] {
  return hexToRgb(hex).map((v) => Math.round(v * 255)) as [number, number, number];
}

function texel(image: RgbaImage, p: Point2): [number, number, number, number] {
  const k = 4 * (Math.floor(p.y) * image.width + Math.floor(p.x));
  return [image.data[k]!, image.data[k + 1]!, image.data[k + 2]!, image.data[k + 3]!];
}

/** ΔE_OK between an RGB(A) texel and a texel or a hex colour. */
function deltaE(p: readonly number[], q: readonly number[] | string): number {
  const oklab = (c: readonly number[]) =>
    hexToOklab(rgbToHex([c[0]! / 255, c[1]! / 255, c[2]! / 255]));
  const a = oklab(p);
  const b = oklab(typeof q === 'string' ? rgb8(q) : q);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function encode(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

/** Mean linear-light luminance of the texels inside the polygon of landmark `indices`. */
function meanLuminance(image: RgbaImage, indices: readonly number[]): number {
  const mask = polygonMask(TEXELS, indices, image.width, image.height);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const d = image.data;
    sum +=
      0.2126 * linear(d[4 * i]!) + 0.7152 * linear(d[4 * i + 1]!) + 0.0722 * linear(d[4 * i + 2]!);
    count++;
  }
  return sum / count;
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / ((a + b) / 2);
}

function midpoint(a: Point2, b: Point2): Point2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Area centroid of the polygon of `points`. */
function centroid(points: Point2[]): Point2 {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!;
    const b = points[i]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return { x: x / (3 * area), y: y / (3 * area) };
}

function distanceToPolygon(p: Point2, poly: Point2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

const DEFAULT = photoInput();
const PROJECTED = projectFace(DEFAULT, CORR);

test('warpTriangles maps a triangle affinely', () => {
  // A 256 × 256 photo with a linear horizontal gradient: red = x, green = 255 − x, blue = 90.
  const photo: RgbaImage = { width: 256, height: 256, data: new Uint8ClampedArray(4 * 256 * 256) };
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) photo.data.set([x, 255 - x, 90, 255], 4 * (256 * y + x));
  }
  const src: Point2[] = [
    { x: 20, y: 30 },
    { x: 230, y: 60 },
    { x: 90, y: 225 },
  ];
  // A one-triangle correspondence whose face square is the lower right quarter of the texture.
  const rect = { u: 0.5, v: 0.5, size: 0.5 };
  const uvs: [number, number][] = [
    [0.55, 0.6],
    [0.95, 0.52],
    [0.7, 0.98],
  ];
  const size = 128;
  const dst = uvs.map((uv) => uvToTexel(uv, rect, size));
  expect(dst[0]!.x).toBeCloseTo(12.8, 9);
  expect(dst[0]!.y).toBeCloseTo(25.6, 9);
  const { image, valid } = warpTriangles(
    photo,
    new Uint8Array(256 * 256),
    src,
    dst,
    [[0, 1, 2]],
    size,
  );
  expect(image.width).toBe(size);
  expect(image.height).toBe(size);

  const [a, b, c] = dst as [Point2, Point2, Point2];
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  let inside = 0;
  let worst = 0; // the largest colour error inside, in 8-bit steps
  let wrong = 0; // texels inside that aren't warped and valid, or outside that are
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = { x: x + 0.5, y: y + 0.5 };
      const w1 = ((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / area;
      const w2 = ((b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)) / area;
      const w0 = 1 - w1 - w2;
      const k = 4 * (y * size + x);
      if (Math.min(w0, w1, w2) < -1e-6) {
        if (image.data[k + 3] !== 0 || valid[y * size + x] !== 0) wrong++;
        continue;
      }
      if (Math.min(w0, w1, w2) < 1e-6) continue; // on an edge: either way is right
      inside++;
      if (image.data[k + 3] !== 255 || valid[y * size + x] !== 1) wrong++;
      // Bilinear sampling at pixel centres: red at source x is x − ½.
      const sx = w0 * src[0]!.x + w1 * src[1]!.x + w2 * src[2]!.x;
      worst = Math.max(
        worst,
        Math.abs(image.data[k]! - (sx - 0.5)),
        Math.abs(image.data[k + 1]! - (255.5 - sx)),
        Math.abs(image.data[k + 2]! - 90),
      );
    }
  }
  expect(inside).toBeGreaterThan(1500);
  expect(wrong).toBe(0);
  expect(worst).toBeLessThanOrEqual(2);
});

test('the skin colour lands at the nose tip', () => {
  expect(deltaE(texel(PROJECTED, TEXELS[NOSE_TIP]!), COLORS.skin)).toBeLessThan(0.03);
});

test('the eyes and the inner mouth are filled from around them', () => {
  const warped = warpTriangles(
    DEFAULT.photo,
    DEFAULT.hair,
    DEFAULT.landmarks,
    TEXELS,
    CORR.triangles,
    SIZE,
  );
  for (const indices of [FACE_MASKS.eyeR, FACE_MASKS.eyeL]) {
    const lid = indices.map((i) => TEXELS[i]!);
    const centre = centroid(lid);
    expect(deltaE(texel(warped.image, centre), PUPIL)).toBeLessThan(0.05); // what the mask removes
    const at = texel(PROJECTED, centre);
    expect(at[3]).toBe(255);
    expect(deltaE(at, COLORS.skin)).toBeLessThan(0.05);
    expect(deltaE(at, COLORS.iris)).toBeGreaterThan(0.05);
    expect(deltaE(at, COLORS.lips)).toBeGreaterThan(0.05);
    // The lashes along the lids go with the dilation: everything within eyeDilatePx is skin.
    const inside = polygonMask(TEXELS, indices, SIZE, SIZE);
    let lashes = 0;
    let near = 0;
    let worst = 0;
    const r = FACE_MASKS.eyeDilatePx;
    const [xs, ys] = [lid.map((p) => p.x), lid.map((p) => p.y)];
    for (let y = Math.floor(Math.min(...ys)) - r; y <= Math.ceil(Math.max(...ys)) + r; y++) {
      for (let x = Math.floor(Math.min(...xs)) - r; x <= Math.ceil(Math.max(...xs)) + r; x++) {
        const p = { x: x + 0.5, y: y + 0.5 };
        if (!inside[y * SIZE + x] && distanceToPolygon(p, lid) > r) continue;
        near++;
        if (deltaE(texel(warped.image, p), LASHES) < 0.05) lashes++;
        worst = Math.max(worst, deltaE(texel(PROJECTED, p), COLORS.skin));
      }
    }
    expect(near).toBeGreaterThan(5000);
    expect(worst).toBeLessThan(0.05);
    expect(lashes).toBeGreaterThan(300); // the warp carried them in
  }
  // In the UV layout the inner mouth is a sliver between the lips (3 texels high at 1024²), so what
  // surrounds it, and fills it, is lip, not skin: the teeth go and the lips close over them. The lip
  // texels at its edge pick up teeth in the warp's bilinear samples; left valid, they would tint the
  // fill (ΔE ~0.10 from the lip at the centre). The next test checks those lip texels themselves.
  const centre = centroid(FACE_MASKS.innerMouth.map((i) => TEXELS[i]!));
  expect(deltaE(texel(warped.image, centre), TEETH)).toBeLessThan(0.05); // what the mask removes
  const upperLip = texel(PROJECTED, midpoint(TEXELS[LM.lipTop]!, TEXELS[13]!));
  expect(deltaE(upperLip, COLORS.lips)).toBeLessThan(0.08); // de-lit: lifted towards the skin's light
  const at = texel(PROJECTED, centre);
  expect(at[3]).toBe(255);
  expect(deltaE(at, upperLip)).toBeLessThan(0.05);
  expect(deltaE(at, TEETH)).toBeGreaterThan(0.2);
  expect(deltaE(at, COLORS.skin)).toBeGreaterThan(0.05);
  expect(deltaE(at, COLORS.iris)).toBeGreaterThan(0.05);
});

test('the lips around an open mouth carry no teeth', () => {
  // The lip texels just outside the inner-mouth polygon (the rim, within 2 texels) come out lip, not
  // teeth. Checked over every lip texel outside the polygon and within 16 texels of it, which takes in
  // both ways the teeth reach the lips. In the UV layout a lip strip 1–3 px tall in the photo spans
  // 7–10 texels, so the rim's bilinear samples read the teeth. And near the mouth corners the canonical
  // face's upper lip folds over the mouth opening in the photo, so the warp puts teeth on lip texels up
  // to ~12 texels out, beyond the reach of a dilation in texels.
  const warped = warpTriangles(
    DEFAULT.photo,
    DEFAULT.hair,
    DEFAULT.landmarks,
    TEXELS,
    CORR.triangles,
    SIZE,
  ).image;
  const lip = texel(PROJECTED, midpoint(TEXELS[LM.lipTop]!, TEXELS[13]!));
  const mouth = FACE_MASKS.innerMouth.map((i) => TEXELS[i]!);
  const inMouth = polygonMask(TEXELS, FACE_MASKS.innerMouth, SIZE, SIZE);
  const inLips = polygonMask(TEXELS, LM.outerLips, SIZE, SIZE);
  const [reach, rimWidth] = [16, 2];
  const [xs, ys] = [mouth.map((p) => p.x), mouth.map((p) => p.y)];
  const [x0, x1] = [Math.floor(Math.min(...xs)) - reach, Math.ceil(Math.max(...xs)) + reach];
  const [y0, y1] = [Math.floor(Math.min(...ys)) - reach, Math.ceil(Math.max(...ys)) + reach];
  let near = 0; // lip texels outside the polygon and within reach of it
  let rim = 0; // of those, the ones within rimWidth of the polygon
  let teeth = 0; // of those, the ones the warp tints towards the teeth: what has to go
  let beyond = 0; // of those, the ones past the rim
  let worst = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = { x: x + 0.5, y: y + 0.5 };
      if (!inLips[y * SIZE + x] || inMouth[y * SIZE + x]) continue;
      const d = distanceToPolygon(p, mouth);
      if (d > reach) continue;
      near++;
      if (d <= rimWidth) rim++;
      const w = texel(warped, p);
      if (deltaE(w, COLORS.lips) > 0.05 && deltaE(w, TEETH) < deltaE(rgb8(COLORS.lips), TEETH)) {
        teeth++;
        if (d > rimWidth) beyond++;
      }
      worst = Math.max(worst, deltaE(texel(PROJECTED, p), lip));
    }
  }
  expect(near).toBeGreaterThan(6000);
  expect(rim).toBeGreaterThan(700);
  expect(teeth).toBeGreaterThan(1500);
  expect(beyond).toBeGreaterThan(1000);
  expect(worst).toBeLessThan(0.05);
});

test('hair over the forehead is replaced by skin', () => {
  const input = photoInput({ hair: { length: 'medium', bangs: true } });
  const { landmarks, photo, hair } = input;
  // Every texel of the face oval above the brows, chosen from the landmarks alone, not from what
  // projectFace takes for hair. With the oval's corners painted skin, the photo there is skin or hair,
  // so every one of them must come out skin.
  const browY = Math.min(...[...LM.browR.upper, ...LM.browL.upper].map((i) => TEXELS[i]!.y));
  const oval = polygonMask(TEXELS, LM.faceOval, SIZE, SIZE);
  const warped = warpTriangles(photo, hair, landmarks, TEXELS, CORR.triangles, SIZE).image;
  const projected = projectFace(input, CORR);
  let hairy = 0; // forehead texels the warp covers with hair (~90k): what the hair rule must remove
  let worst = 0;
  for (let y = 0; y < browY; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!oval[y * SIZE + x]) continue;
      if (deltaE(texel(warped, { x, y }), COLORS.hair) < 0.05) hairy++;
      worst = Math.max(worst, deltaE(texel(projected, { x, y }), COLORS.skin));
    }
  }
  expect(hairy).toBeGreaterThan(85_000);
  expect(worst).toBeLessThan(0.05);
});

test('de-lighting evens out a left-to-right light ramp', () => {
  const input = photoInput();
  const { photo, landmarks, hair } = input;
  // Ramp the photo in linear light across the face box: × 0.6 at its left edge to × 1.4 at its right.
  const box = faceBox(landmarks);
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const t = Math.min(1, Math.max(0, (x + 0.5 - box.x) / box.width));
      const k = 4 * (y * photo.width + x);
      for (let c = 0; c < 3; c++)
        photo.data[k + c] = encode(linear(photo.data[k + c]!) * (0.6 + 0.8 * t));
    }
  }
  const before = warpTriangles(photo, hair, landmarks, TEXELS, CORR.triangles, SIZE).image;
  expect(
    relativeDifference(
      meanLuminance(before, LM.cheekPatchR),
      meanLuminance(before, LM.cheekPatchL),
    ),
  ).toBeGreaterThan(0.25);
  const after = projectFace(input, CORR);
  expect(
    relativeDifference(meanLuminance(after, LM.cheekPatchR), meanLuminance(after, LM.cheekPatchL)),
  ).toBeLessThan(0.05);
});

test('alpha is the face oval, feathered inwards', () => {
  const alpha = (p: Point2) => texel(PROJECTED, p)[3];
  expect(alpha(TEXELS[NOSE_TIP]!)).toBe(255);
  expect(alpha({ x: 5, y: 5 })).toBe(0);

  const oval = LM.faceOval.map((i) => TEXELS[i]!);
  const inside = polygonMask(TEXELS, LM.faceOval, SIZE, SIZE);
  let band = 0;
  let outside = 0; // the largest alpha outside the oval
  let deepest = 0; // the deepest texel inside it with alpha below 255
  for (let i = 0; i < inside.length; i++) {
    const a = PROJECTED.data[4 * i + 3]!;
    if (!inside[i]) {
      outside = Math.max(outside, a);
    } else if (a < 255) {
      band++;
      const p = { x: (i % SIZE) + 0.5, y: Math.floor(i / SIZE) + 0.5 };
      deepest = Math.max(deepest, distanceToPolygon(p, oval));
    }
  }
  expect(outside).toBe(0);
  expect(band).toBeGreaterThan(10_000);
  expect(deepest).toBeLessThanOrEqual(FACE_MASKS.featherPx);

  // Along the line from the chin to the nose tip, alpha rises from 0 to 255 and never falls.
  const chin = TEXELS[LM.chin]!;
  const nose = TEXELS[NOSE_TIP]!;
  const steps = Math.ceil(Math.hypot(nose.x - chin.x, nose.y - chin.y));
  const along = Array.from({ length: steps + 1 }, (_, s) =>
    alpha({
      x: chin.x + ((nose.x - chin.x) * s) / steps,
      y: chin.y + ((nose.y - chin.y) * s) / steps,
    }),
  );
  expect(along[0]).toBeLessThan(16);
  expect(along.at(-1)).toBe(255);
  expect(along.findIndex((a, s) => s > 0 && a! < along[s - 1]!)).toBe(-1);
});

test('the texture is 1024² by default, and the same every time', () => {
  expect(PROJECTED.width).toBe(1024);
  expect(PROJECTED.height).toBe(1024);
  expect(PROJECTED.data).toHaveLength(4 * 1024 * 1024);
  const again = projectFace(DEFAULT, CORR).data;
  expect(again.findIndex((v, i) => v !== PROJECTED.data[i])).toBe(-1); // toEqual is slow on 4 MB
});

const BUILT = 'public/assets/base/correspondence.json';

describe.skipIf(!fs.existsSync(BUILT))('the built correspondence', () => {
  const corr = fs.existsSync(BUILT)
    ? correspondenceSchema.parse(JSON.parse(fs.readFileSync(BUILT, 'utf8')))
    : null!;

  test('a full-resolution face crop projects onto the turned face square, quickly', () => {
    // A 1600 × 1800 crop with a ~1000 px wide face, as buildLikeness will pass.
    const input = photoInput({ width: 1600, height: 1800, scale: 64 });
    const image = projectFace(input, corr); // also warms up the JIT
    const runs = [0, 1, 2].map(() => {
      const start = performance.now();
      projectFace(input, corr);
      return performance.now() - start;
    });
    const ms = runs.sort((p, q) => p - q)[1]!; // the median
    const nose = uvToTexel(corr.landmarks[NOSE_TIP]!.uv, corr.faceUvRect, FACE_TEXTURE_SIZE);
    expect(texel(image, nose)[3]).toBe(255);
    expect(deltaE(texel(image, nose), COLORS.skin)).toBeLessThan(0.03);
    // 280 ms is what the 400 ms likeness budget leaves after fitHead's ~120 ms. Wall-clock bounds flake
    // under machine load (a full `npm test` runs files in parallel), so this is a dev-machine check:
    // run it with KISS_PERF=1, alone, on an idle machine.
    if (process.env.KISS_PERF === '1') expect(ms).toBeLessThan(280);
  }, 20_000);
});
