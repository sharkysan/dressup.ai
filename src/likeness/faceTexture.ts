import { LM, polygonMask } from '../analysis/landmarks';
import type { Point2, RgbaImage } from '../analysis/types';
import type { Correspondence } from './correspondence';

/** The face texture's side in texels; it covers `faceUvRect` of the Skin texture. */
export const FACE_TEXTURE_SIZE = 1024;

/**
 * The face texture's masks and constants. The eye polygons (the eyelid margins), dilated by
 * `eyeDilatePx`, and the inner-mouth polygon (the inner lip line), dilated by `mouthDilatePx`, are not
 * projected; the 3D eyes and lashes replace the eyes, and the lips close over the mouth. The inner mouth
 * is also masked in the photo, like hair: a texel is not projected if any of its four bilinear taps lies
 * inside the photo's inner-mouth polygon. That drops every lip texel whose sample reads the teeth of an
 * open mouth, which no dilation in texels can: the UV layout stretches the lips several times, and the
 * upper lip can fold over the mouth opening in the photo. Alpha rises from 0 at the face oval to 255
 * `featherPx` inside it. De-lighting divides by a Gaussian blur of the luminance with
 * σ = `delightSigmaPx`, its gain clamped to `gainRange`.
 */
export const FACE_MASKS = {
  eyeR: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  eyeL: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  innerMouth: [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
  ],
  eyeDilatePx: 6,
  mouthDilatePx: 2,
  featherPx: 40,
  delightSigmaPx: 64,
  gainRange: [0.5, 2],
} as const;

export type FaceInput = {
  /** The face crop, at full resolution. */
  photo: RgbaImage;
  /** The 478 landmarks in the crop's pixels. */
  landmarks: Point2[];
  /** The crop's hair mask, one byte per pixel: 1 = hair. */
  hair: Uint8Array;
};

/**
 * The photo's face in the head's UV layout (spec §6): a `size`² RGBA image covering `faceUvRect`. Each
 * face-mesh triangle is warped from the photo to its uvs; hair, the eyes and the inner mouth are filled
 * from what surrounds them; the result is de-lit, and alpha is the face oval, feathered inwards.
 * Nothing here assumes the face is upright in texel space (on the base it is turned 90°). Throws if the
 * hair mask is not the photo's size.
 */
export function projectFace(
  input: FaceInput,
  corr: Correspondence,
  size: number = FACE_TEXTURE_SIZE,
): RgbaImage {
  const { width, height } = input.photo;
  if (input.hair.length !== width * height) {
    throw new Error(
      `projectFace: a hair mask of ${input.hair.length} for a ${width}×${height} photo`,
    );
  }
  const texels = corr.landmarks.map((l) => uvToTexel(l.uv, corr.faceUvRect, size));
  // Not projected from the photo: hair, and the mouth opening.
  const excluded = input.hair.slice();
  const opening = FACE_MASKS.innerMouth.map((i) => input.landmarks[i]!);
  markPolygon(excluded, input.photo.width, input.photo.height, opening);
  const { image, valid } = warpTriangles(
    input.photo,
    excluded,
    input.landmarks,
    texels,
    corr.triangles,
    size,
  );

  const at = (indices: readonly number[]) => indices.map((i) => texels[i]!);
  const masked = [
    [FACE_MASKS.eyeR, FACE_MASKS.eyeDilatePx],
    [FACE_MASKS.eyeL, FACE_MASKS.eyeDilatePx],
    [FACE_MASKS.innerMouth, FACE_MASKS.mouthDilatePx],
  ] as const;
  for (const [indices, r] of masked) {
    // The polygon, dilated by r: inside it, or within r of its edges.
    const poly = at(indices);
    const inside = polygonMask(poly, corners(poly), size, size);
    const { x0, y0, w, h, values } = edgeDistance2(poly, size, r + 1);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = y * size + x;
        if (inside[i] || values[(y - y0) * w + (x - x0)]! <= r * r) valid[i] = 0;
      }
    }
  }

  fillHoles(image, valid);
  // The face mesh's outline is the face oval, so the valid texels are the valid texels inside it.
  delight(image, valid);

  const alpha = featherAlpha(at(LM.faceOval), size, FACE_MASKS.featherPx);
  for (let i = 0; i < alpha.length; i++) image.data[4 * i + 3] = alpha[i]!;
  return image;
}

/**
 * A glTF uv (v down) in texel coordinates of the `size`² face texture over `rect`: texel (i, j) spans
 * [i, i + 1) × [j, j + 1).
 */
export function uvToTexel(
  uv: readonly [number, number],
  rect: Correspondence['faceUvRect'],
  size: number,
): Point2 {
  return { x: ((uv[0] - rect.u) / rect.size) * size, y: ((uv[1] - rect.v) / rect.size) * size };
}

/**
 * Warps the photo into a `size`² texture, triangle by triangle: each texel centre inside a destination
 * triangle (`to`, texels) maps through its barycentrics to the photo (`from`, pixels), which is sampled
 * bilinearly. Warped texels get alpha 255, the rest stay 0. `valid` is 1 at warped texels whose source
 * lies inside the photo and isn't excluded (hair, the mouth opening): none of the four pixels the
 * bilinear sample reads is set in `excluded` (each read as is, the mask isn't interpolated). Testing
 * only the nearest pixel would keep a fringe of half-hair texels along every hair edge, which the fill
 * then smears into the hole.
 */
export function warpTriangles(
  photo: RgbaImage,
  excluded: Uint8Array,
  from: readonly Point2[],
  to: readonly Point2[],
  triangles: readonly (readonly [number, number, number])[],
  size: number,
): { image: RgbaImage; valid: Uint8Array } {
  const { width: W, height: H, data: src } = photo;
  const out = new Uint8ClampedArray(4 * size * size);
  const valid = new Uint8Array(size * size);
  for (const [i0, i1, i2] of triangles) {
    const [a, b, c] = [to[i0]!, to[i1]!, to[i2]!];
    const [p, q, r] = [from[i0]!, from[i1]!, from[i2]!];
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(area) < 1e-9) continue;
    // Barycentrics of b and c, affine in the texel position: w = w(a) + dx·∂x + dy·∂y.
    const w1x = (c.y - a.y) / area;
    const w1y = -(c.x - a.x) / area;
    const w2x = -(b.y - a.y) / area;
    const w2y = (b.x - a.x) / area;
    const eps = 1e-7;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - a.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - a.x;
        const w1 = dx * w1x + dy * w1y;
        const w2 = dx * w2x + dy * w2y;
        const w0 = 1 - w1 - w2;
        if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
        const sx = w0 * p.x + w1 * q.x + w2 * r.x;
        const sy = w0 * p.y + w1 * q.y + w2 * r.y;
        const t = y * size + x;
        const skip = sample(src, excluded, W, H, sx, sy, out, 4 * t);
        out[4 * t + 3] = 255;
        valid[t] = !skip && sx >= 0 && sy >= 0 && sx < W && sy < H ? 1 : 0;
      }
    }
  }
  return { image: { width: size, height: size, data: out }, valid };
}

/**
 * Writes the bilinear RGB at (x, y), in pixels with pixel centres at +½ and clamped at the edges, to
 * `out` at `o`. Returns whether any of the four pixels it reads is set in `excluded`.
 */
function sample(
  src: Uint8ClampedArray,
  excluded: Uint8Array,
  W: number,
  H: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  o: number,
): boolean {
  const fx = Math.min(W - 1, Math.max(0, x - 0.5));
  const fy = Math.min(H - 1, Math.max(0, y - 0.5));
  const xa = Math.floor(fx);
  const ya = Math.floor(fy);
  const xb = Math.min(W - 1, xa + 1);
  const yb = Math.min(H - 1, ya + 1);
  const tx = fx - xa;
  const ty = fy - ya;
  const k00 = 4 * (ya * W + xa);
  const k10 = 4 * (ya * W + xb);
  const k01 = 4 * (yb * W + xa);
  const k11 = 4 * (yb * W + xb);
  for (let ch = 0; ch < 3; ch++) {
    const top = src[k00 + ch]! + (src[k10 + ch]! - src[k00 + ch]!) * tx;
    const bottom = src[k01 + ch]! + (src[k11 + ch]! - src[k01 + ch]!) * tx;
    out[o + ch] = top + (bottom - top) * ty;
  }
  return !!(
    excluded[ya * W + xa] ||
    excluded[ya * W + xb] ||
    excluded[yb * W + xa] ||
    excluded[yb * W + xb]
  );
}

/**
 * Fills the RGB of every texel with `valid` 0 from the valid texels around it, by pull-push: the pull
 * averages the valid texels into ever coarser levels; the push fills each level's holes from the level
 * above, bilinearly. Filled texels get alpha 255; valid texels are left as they are.
 */
export function fillHoles(image: RgbaImage, valid: Uint8Array): void {
  type Level = { w: number; h: number; rgb: Float32Array; weight: Uint8Array };
  const { width, height, data } = image;
  const base: Level = {
    w: width,
    h: height,
    rgb: new Float32Array(3 * width * height),
    weight: valid,
  };
  for (let i = 0; i < width * height; i++) {
    if (!valid[i]) continue;
    base.rgb[3 * i] = data[4 * i]!;
    base.rgb[3 * i + 1] = data[4 * i + 1]!;
    base.rgb[3 * i + 2] = data[4 * i + 2]!;
  }
  // Pull: a coarse texel is the mean of its valid children, and valid if any of them is. Past an odd
  // edge the last row or column stands in for the missing one; every child then counts twice, so the
  // mean is unchanged.
  const levels = [base];
  for (let fine = base; fine.w > 1 || fine.h > 1;) {
    const w = Math.ceil(fine.w / 2);
    const h = Math.ceil(fine.h / 2);
    const coarse: Level = { w, h, rgb: new Float32Array(3 * w * h), weight: new Uint8Array(w * h) };
    for (let y = 0; y < h; y++) {
      const row0 = 2 * y * fine.w;
      const row1 = Math.min(fine.h - 1, 2 * y + 1) * fine.w;
      for (let x = 0; x < w; x++) {
        const x0 = 2 * x;
        const x1 = Math.min(fine.w - 1, x0 + 1);
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let c = 0; c < 4; c++) {
          const k = (c < 2 ? row0 : row1) + (c % 2 ? x1 : x0);
          if (!fine.weight[k]) continue;
          n++;
          r += fine.rgb[3 * k]!;
          g += fine.rgb[3 * k + 1]!;
          b += fine.rgb[3 * k + 2]!;
        }
        if (n === 0) continue;
        const k = y * w + x;
        coarse.weight[k] = 1;
        coarse.rgb[3 * k] = r / n;
        coarse.rgb[3 * k + 1] = g / n;
        coarse.rgb[3 * k + 2] = b / n;
      }
    }
    levels.push(coarse);
    fine = coarse;
  }
  // Push: a hole takes the coarser level, sampled bilinearly at its centre.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l]!;
    const { w, h, rgb } = levels[l + 1]!;
    const across = lerpSteps(fine.w, w, 2);
    for (let y = 0; y < fine.h; y++) {
      const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const ya = Math.floor(fy);
      const yb = Math.min(h - 1, ya + 1);
      const ty = fy - ya;
      for (let x = 0; x < fine.w; x++) {
        const k = y * fine.w + x;
        if (fine.weight[k]) continue;
        const xa = across.a[x]!;
        const xb = across.b[x]!;
        const tx = across.t[x]!;
        const k00 = 3 * (ya * w + xa);
        const k10 = 3 * (ya * w + xb);
        const k01 = 3 * (yb * w + xa);
        const k11 = 3 * (yb * w + xb);
        for (let ch = 0; ch < 3; ch++) {
          const top = rgb[k00 + ch]! + (rgb[k10 + ch]! - rgb[k00 + ch]!) * tx;
          const bottom = rgb[k01 + ch]! + (rgb[k11 + ch]! - rgb[k01 + ch]!) * tx;
          fine.rgb[3 * k + ch] = top + (bottom - top) * ty;
        }
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (valid[i]) continue;
    data[4 * i] = base.rgb[3 * i]!;
    data[4 * i + 1] = base.rgb[3 * i + 1]!;
    data[4 * i + 2] = base.rgb[3 * i + 2]!;
    data[4 * i + 3] = 255;
  }
}

/**
 * For reading a grid of `coarse` cells, each `scale` texels wide, at the centres of `fine` texels:
 * per texel, the two cells to interpolate between (clamped at the ends) and the weight of the second.
 */
function lerpSteps(fine: number, coarse: number, scale: number) {
  const a = new Int32Array(fine);
  const b = new Int32Array(fine);
  const t = new Float32Array(fine);
  for (let x = 0; x < fine; x++) {
    const f = Math.min(coarse - 1, Math.max(0, (x + 0.5) / scale - 0.5));
    a[x] = Math.floor(f);
    b[x] = Math.min(coarse - 1, a[x]! + 1);
    t[x] = f - a[x]!;
  }
  return { a, b, t };
}

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
/**
 * Linear → sRGB in steps of 2⁻¹⁴, up to the largest gain so that a gained value needs no clamp
 * (above 1 is 255).
 */
const LINEAR_STEPS = 1 << 14;
const LINEAR_TO_SRGB = Uint8ClampedArray.from(
  { length: FACE_MASKS.gainRange[1] * LINEAR_STEPS + 1 },
  (_, i) => {
    const v = i / LINEAR_STEPS;
    return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  },
);

/**
 * Evens out the light on the face, in place: gain = clamp(Y_t / Y_b, `gainRange`) multiplies linear RGB,
 * where Y is linear-light luminance, Y_b a normalised Gaussian blur (σ = `delightSigmaPx`) of Y over
 * the `skin` texels, and Y_t the median Y of the `skin` texels.
 */
export function delight(image: RgbaImage, skin: Uint8Array): void {
  const { width, height, data } = image;
  const n = width * height;
  const Y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Y[i] =
      0.2126 * SRGB_TO_LINEAR[data[4 * i]!]! +
      0.7152 * SRGB_TO_LINEAR[data[4 * i + 1]!]! +
      0.0722 * SRGB_TO_LINEAR[data[4 * i + 2]!]!;
  }
  const target = medianLuminance(Y, skin);
  if (target === null) return;

  // On a downsampled grid: a full-resolution σ = 64 px blur would be ~800 M multiply-adds. The skin's
  // luminance and the skin mask are summed into cells of σ/8 texels and blurred there with σ/8 cells;
  // their ratio is Y_b. Boxing into cells adds (cell² − 1)/12 texels² to the blur's σ² = 4096, which
  // is negligible. The gain is formed per cell and read back bilinearly; it varies over σ, many cells.
  const cell = Math.max(1, Math.round(FACE_MASKS.delightSigmaPx / 8));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const sum = new Float64Array(gw * gh);
  const count = new Float64Array(gw * gh);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * gw;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!skin[i]) continue;
      const g = row + Math.floor(x / cell);
      sum[g]! += Y[i]!;
      count[g]! += 1;
    }
  }
  const sigma = FACE_MASKS.delightSigmaPx / cell;
  gaussianBlur(sum, gw, gh, sigma);
  gaussianBlur(count, gw, gh, sigma);
  const [lo, hi] = FACE_MASKS.gainRange;
  const gain = new Float32Array(gw * gh);
  for (let g = 0; g < gain.length; g++) {
    // Further than the kernel from any skin texel there is no estimate: the gain stays 1.
    gain[g] = sum[g]! > 0 ? Math.min(hi, Math.max(lo, (target * count[g]!) / sum[g]!)) : 1;
  }

  const across = lerpSteps(width, gw, cell);
  const row = new Float32Array(gw);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const top = Math.floor(fy) * gw;
    const bottom = Math.min(gh - 1, Math.floor(fy) + 1) * gw;
    const ty = fy - Math.floor(fy);
    for (let c = 0; c < gw; c++)
      row[c] = gain[top + c]! + (gain[bottom + c]! - gain[top + c]!) * ty;
    for (let x = 0; x < width; x++) {
      const ga = row[across.a[x]!]!;
      const g = (ga + (row[across.b[x]!]! - ga) * across.t[x]!) * LINEAR_STEPS;
      const k = 4 * (y * width + x);
      data[k] = LINEAR_TO_SRGB[(SRGB_TO_LINEAR[data[k]!]! * g + 0.5) | 0]!;
      data[k + 1] = LINEAR_TO_SRGB[(SRGB_TO_LINEAR[data[k + 1]!]! * g + 0.5) | 0]!;
      data[k + 2] = LINEAR_TO_SRGB[(SRGB_TO_LINEAR[data[k + 2]!]! * g + 0.5) | 0]!;
    }
  }
}

/** The median of `values` where `mask` is set, to 2⁻¹⁶ (values in [0, 1]); null if the mask is empty. */
function medianLuminance(values: Float32Array, mask: Uint8Array): number | null {
  const bins = 1 << 16;
  const histogram = new Uint32Array(bins);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    histogram[Math.min(bins - 1, (values[i]! * bins) | 0)]!++;
    total++;
  }
  if (total === 0) return null;
  for (let b = 0, seen = 0; b < bins; b++) {
    seen += histogram[b]!;
    if (2 * seen >= total) return (b + 0.5) / bins;
  }
  return null;
}

/** Separable Gaussian blur of a w × h grid in place, zero outside it, truncated at 3σ. */
function gaussianBlur(grid: Float64Array, w: number, h: number, sigma: number): void {
  const radius = Math.ceil(3 * sigma);
  const kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, k) =>
    Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)),
  );
  const line = new Float64Array(Math.max(w, h));
  const pass = (count: number, length: number, stride: number, step: number) => {
    for (let j = 0; j < count; j++) {
      const start = j * stride;
      for (let i = 0; i < length; i++) line[i] = grid[start + i * step]!;
      for (let i = 0; i < length; i++) {
        let acc = 0;
        for (let k = Math.max(0, i - radius); k <= Math.min(length - 1, i + radius); k++) {
          acc += line[k]! * kernel[k - i + radius]!;
        }
        grid[start + i * step] = acc;
      }
    }
  };
  pass(h, w, w, 1); // rows
  pass(w, h, 1, w); // columns
}

/**
 * The face texture's alpha: 0 outside the `oval` polygon (texels), rising inside it with the distance
 * from its edge along a smoothstep to 255 at `featherPx`.
 */
export function featherAlpha(oval: Point2[], size: number, featherPx: number): Uint8Array {
  const inside = polygonMask(oval, corners(oval), size, size);
  const { x0, y0, w, h, values } = edgeDistance2(oval, size, featherPx);
  const alpha = new Uint8Array(size * size);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = y * size + x;
      if (!inside[i]) continue;
      const t = Math.sqrt(values[(y - y0) * w + (x - x0)]!) / featherPx;
      alpha[i] = Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  return alpha;
}

/** Every corner of `poly`, in order, as polygonMask's indices. */
function corners(poly: Point2[]): number[] {
  return poly.map((_, i) => i);
}

/**
 * Sets `mask` (width × height) to 1 where polygonMask of `poly` is set. Only the polygon's bounding
 * box is rasterised and visited, not the whole photo.
 */
function markPolygon(mask: Uint8Array, width: number, height: number, poly: Point2[]): void {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.max(0, Math.min(width, Math.ceil(Math.max(...xs)) + 1) - x0);
  const h = Math.max(0, Math.min(height, Math.ceil(Math.max(...ys)) + 1) - y0);
  const shifted = poly.map((p) => ({ x: p.x - x0, y: p.y - y0 }));
  const inside = polygonMask(shifted, corners(shifted), w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (inside[y * w + x]) mask[(y0 + y) * width + x0 + x] = 1;
  }
}

/** A window of a `size`² texture: texels x0 ≤ x < x0 + w, y0 ≤ y < y0 + h, with a value per texel. */
type Window = { x0: number; y0: number; w: number; h: number; values: Float32Array };

/**
 * The squared distance from each texel centre within `cap` of the closed polygon `poly` to its nearest
 * edge, capped at `cap`², over the polygon's bounding box grown by `cap`. Each edge visits only the
 * texels within `cap` of its own bounding box.
 */
function edgeDistance2(poly: Point2[], size: number, cap: number): Window {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - cap));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - cap));
  const w = Math.max(0, Math.min(size, Math.ceil(Math.max(...xs) + cap) + 1) - x0);
  const h = Math.max(0, Math.min(size, Math.ceil(Math.max(...ys) + cap) + 1) - y0);
  const values = new Float32Array(w * h).fill(cap * cap);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const b = poly[i]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length2 = ex * ex + ey * ey;
    const xa = Math.max(x0, Math.floor(Math.min(a.x, b.x) - cap));
    const xb = Math.min(x0 + w - 1, Math.ceil(Math.max(a.x, b.x) + cap));
    const ya = Math.max(y0, Math.floor(Math.min(a.y, b.y) - cap));
    const yb = Math.min(y0 + h - 1, Math.ceil(Math.max(a.y, b.y) + cap));
    for (let y = ya; y <= yb; y++) {
      const py = y + 0.5 - a.y;
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5 - a.x;
        const t = length2 > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey) / length2)) : 0;
        const dx = px - t * ex;
        const dy = py - t * ey;
        const d2 = dx * dx + dy * dy;
        const k = (y - y0) * w + (x - x0);
        if (d2 < values[k]!) values[k] = d2;
      }
    }
  }
  return { x0, y0, w, h, values };
}
