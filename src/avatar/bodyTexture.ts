import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  SRGBColorSpace,
} from 'three';
import { hexToRgb, linearToSrgb, srgbToLinear } from '../color/oklab';
import type { Correspondence } from '../likeness/correspondence';

/** RGBA pixels, row 0 at the top: an ImageData, or anything shaped like one (tests have no canvas). */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** Per channel, in linear light. */
type Rgb = readonly [number, number, number];

/**
 * A likeness's face for the skin canvas (spec §7): `Likeness.faceTexture` decoded (alpha the feathered
 * face mask), the skin tone it was photographed at (`Likeness.sourceSkin`), and the square of the Skin
 * texture it covers (`faceUvRect`, glTF UVs).
 */
export type FaceComposite = {
  pixels: Pixels;
  sourceSkin: string;
  rect: Correspondence['faceUvRect'];
};

/** An sRGB byte in linear light. */
const LINEAR = Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255));

/** 255 × linearToSrgb(i / ENCODE_STEPS), for encode. */
const ENCODE_STEPS = 4096;
const ENCODED = Float64Array.from(
  { length: ENCODE_STEPS + 2 },
  (_, i) => 255 * linearToSrgb(i / ENCODE_STEPS),
);

/** 255 × linearToSrgb(v), interpolated in a table: within 0.005 of exact, without a pow per call. */
function encode(v: number): number {
  const x = Math.min(1, Math.max(0, v)) * ENCODE_STEPS;
  const i = Math.floor(x);
  return ENCODED[i]! + (ENCODED[i + 1]! - ENCODED[i]!) * (x - i);
}

const linearRgb = (hex: string) => hexToRgb(hex).map(srgbToLinear) as [number, number, number];

/**
 * The skin's calibration (spec §7): per channel, 1 / the neutral skin's median in linear light over the
 * texels the base layer leaves clear (alpha 0). The Skin material's colour carries it, so the rendered
 * skin's median is the tint. At least 1, as a median is at most 1.
 */
export function skinGain(skin: Pixels, baseLayer: Pixels): [number, number, number] {
  checkSizes(skin, [baseLayer]);
  const histograms = [0, 1, 2].map(() => new Uint32Array(256));
  const s = skin.data;
  const b = baseLayer.data;
  let count = 0;
  for (let i = 0; i < s.length; i += 4) {
    if (b[i + 3] !== 0) continue;
    count++;
    for (let c = 0; c < 3; c++) histograms[c]![s[i + c]!]!++;
  }
  if (count === 0) throw new Error('skin gain: the base layer leaves no skin texel clear');
  return histograms.map((histogram) => {
    const median = medianLinear(histogram, count);
    if (median === 0) throw new Error('skin gain: the neutral skin is black');
    return 1 / median;
  }) as [number, number, number];
}

/** The median of `count` bytes given as a histogram, in linear light (the middle two's mean if even). */
function medianLinear(histogram: Uint32Array, count: number): number {
  const ranked = (rank: number) => {
    for (let v = 0, seen = 0; ; v++) {
      seen += histogram[v]!;
      if (seen > rank) return LINEAR[v]!;
    }
  };
  return (ranked((count - 1) >> 1) + ranked(count >> 1)) / 2;
}

/**
 * The body albedo (spec §3, §7), as the skin canvas holds it: three layers, each encoded to sRGB, then
 * composited in this order by straight alpha.
 * - The skin: the neutral skin × `tint` (#rrggbb), per channel in linear light.
 * - The face, if given: its texture resampled into its square (faceLayer), × tint / sourceSkin and
 *   ÷ `gain` in linear light, over the skin by its alpha. So it follows skin edits, and at
 *   tint = sourceSkin renders as projected.
 * - The base layer (the crop top and shorts) ÷ `gain`, over both by its alpha, so the tint never
 *   colours it.
 * The material colour multiplies the canvas by `gain` (skinGain) again: the base layer and the face
 * render as they are, and the skin's median renders as the tint. gain ≥ 1, so nothing divided by it
 * clips. Opaque. Pure: writes `out` (a new image by default) and returns it.
 */
export function composeBodyAlbedo(
  skin: Pixels,
  baseLayer: Pixels,
  tint: string,
  gain: Rgb,
  out?: Pixels,
  face?: FaceComposite | null,
): Pixels {
  const { width, height } = skin;
  checkSizes(skin, out ? [baseLayer, out] : [baseLayer]);
  const target = out ?? { data: new Uint8ClampedArray(width * height * 4), width, height };
  const t = linearRgb(tint);
  const skinOf = encodedTable((l, c) => l * t[c]!);
  const baseOf = encodedTable((l, c) => l / gain[c]!);
  const f = face ? faceLayer(face, t, gain, width, height) : NO_FACE;
  const s = skin.data;
  const b = baseLayer.data;
  const o = target.data;
  for (let y = 0, i = 0; y < height; y++) {
    const row = y - f.y;
    const faceRow = row >= 0 && row < f.height;
    for (let x = 0; x < width; x++, i += 4) {
      const k = faceRow && x >= f.x && x < f.x + f.width ? row * f.width + x - f.x : -1;
      const fa = k < 0 ? 0 : f.alpha[k]!;
      const a = b[i + 3]! / 255;
      for (let c = 0; c < 3; c++) {
        const under = skinOf[256 * c + s[i + c]!]!;
        const faced = fa > 0 ? under + (f.rgb[3 * k + c]! - under) * fa : under;
        o[i + c] = faced + (baseOf[256 * c + b[i + c]!]! - faced) * a;
      }
      o[i + 3] = 255;
    }
  }
  return target;
}

/** At [256 c + v]: `linear(LINEAR[v], c)` encoded to sRGB, as 0..255 unrounded (clamped). */
function encodedTable(linear: (value: number, channel: number) => number): Float64Array {
  return Float64Array.from(
    { length: 768 },
    (_, k) => 255 * linearToSrgb(linear(LINEAR[k & 255]!, k >> 8)),
  );
}

/**
 * The face over a rectangle of the canvas (x, y, width, height): per canvas texel, its colour encoded to
 * sRGB as 0..255 (`rgb`, three per texel) and its alpha as 0..1.
 */
type FaceLayer = {
  x: number;
  y: number;
  width: number;
  height: number;
  rgb: Float64Array;
  alpha: Float64Array;
};
const NO_FACE: FaceLayer = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rgb: new Float64Array(0),
  alpha: new Float64Array(0),
};

/**
 * The face resampled into its square of a `width` × `height` canvas, `rect` × the canvas size: each
 * canvas texel centre inside the square samples the face texture bilinearly at its uv (premultiplied, in
 * linear light; clamped to the edge texels), its colour × tint / sourceSkin ÷ gain.
 */
function faceLayer(
  { pixels, sourceSkin, rect }: FaceComposite,
  tint: Rgb,
  gain: Rgb,
  width: number,
  height: number,
): FaceLayer {
  const source = linearRgb(sourceSkin);
  const scale = [0, 1, 2].map((c) => tint[c]! / source[c]! / gain[c]!);
  const xs = axisTaps(width, rect.u, rect.size, pixels.width);
  const ys = axisTaps(height, rect.v, rect.size, pixels.height);
  const w = xs.inside.length;
  const h = ys.inside.length;
  const layer = {
    x: xs.from,
    y: ys.from,
    width: w,
    height: h,
    rgb: new Float64Array(3 * w * h),
    alpha: new Float64Array(w * h),
  };
  const d = pixels.data;
  for (let row = 0; row < h; row++) {
    if (!ys.inside[row]) continue;
    const wy = ys.weight[row]!;
    const top = 4 * ys.lo[row]! * pixels.width;
    const bottom = 4 * ys.hi[row]! * pixels.width;
    for (let col = 0; col < w; col++) {
      if (!xs.inside[col]) continue;
      const wx = xs.weight[col]!;
      const left = 4 * xs.lo[col]!;
      const right = 4 * xs.hi[col]!;
      // The four taps (byte offsets) and their weights × alpha: premultiplied.
      const p0 = top + left;
      const p1 = top + right;
      const p2 = bottom + left;
      const p3 = bottom + right;
      const w0 = (1 - wx) * (1 - wy) * d[p0 + 3]!;
      const w1 = wx * (1 - wy) * d[p1 + 3]!;
      const w2 = (1 - wx) * wy * d[p2 + 3]!;
      const w3 = wx * wy * d[p3 + 3]!;
      const alpha = w0 + w1 + w2 + w3;
      if (alpha === 0) continue;
      const k = row * w + col;
      layer.alpha[k] = alpha / 255;
      for (let c = 0; c < 3; c++) {
        const linear =
          w0 * LINEAR[d[p0 + c]!]! +
          w1 * LINEAR[d[p1 + c]!]! +
          w2 * LINEAR[d[p2 + c]!]! +
          w3 * LINEAR[d[p3 + c]!]!;
        layer.rgb[3 * k + c] = encode((linear / alpha) * scale[c]!);
      }
    }
  }
  return layer;
}

/**
 * Bilinear taps along one axis of a `canvasSize` canvas, onto a face of `faceSize` texels covering
 * [`start`, `start` + `size`) of the axis in uv: for canvas texels `from` ≤ i < `from` + n (the face's
 * span), the two face texels each centre falls between (`lo`, `hi`, clamped to the edge), the weight of
 * `hi`, and whether the centre falls inside the face at all.
 */
function axisTaps(canvasSize: number, start: number, size: number, faceSize: number) {
  const from = Math.floor(start * canvasSize);
  const n = Math.ceil((start + size) * canvasSize) - from;
  const taps = {
    from,
    lo: new Int32Array(n),
    hi: new Int32Array(n),
    weight: new Float64Array(n),
    inside: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    // In face texels, from the face's edge: texel j's centre is at j + 0.5.
    const f = (((from + i + 0.5) / canvasSize - start) / size) * faceSize;
    if (f < 0 || f >= faceSize) continue;
    const lo = Math.floor(f - 0.5);
    taps.lo[i] = Math.max(0, lo);
    taps.hi[i] = Math.min(faceSize - 1, lo + 1);
    taps.weight[i] = f - 0.5 - lo;
    taps.inside[i] = 1;
  }
  return taps;
}

/** Throws unless every one of `others` is the size of `first`. */
function checkSizes(first: Pixels, others: Pixels[]): void {
  for (const image of others) {
    if (image.width !== first.width || image.height !== first.height) {
      throw new Error(
        `body albedo inputs differ in size: ${first.width}×${first.height} vs ${image.width}×${image.height}`,
      );
    }
  }
}

/** The base layer's garments are matte cotton (spec §3), not as glossy as the skin. */
export const GARMENT_ROUGHNESS = 0.9;

/**
 * The body's roughness, in the base layer's layout: `skin` where the base layer is clear, `garment`
 * where it is opaque, blended by its alpha in between. Two bytes per texel (an RG texture), both the
 * roughness × 255: glTF and three.js read roughness from G. Depends on the base layer only, not on the
 * tint. Pure.
 */
export function bodyRoughness(baseLayer: Pixels, skin: number, garment: number): Uint8Array {
  const b = baseLayer.data;
  const out = new Uint8Array((b.length / 4) * 2);
  for (let i = 0, j = 0; i < b.length; i += 4, j += 2) {
    const a = b[i + 3]! / 255;
    out[j] = out[j + 1] = Math.round(255 * (skin * (1 - a) + garment * a));
  }
  return out;
}

/**
 * The Skin material's maps and colour: `texture`, one canvas the base layer's size (2048², the Skin
 * texture's), recomposited by `update` only when the tint or the face changes; `roughnessMap`
 * (bodyRoughness), built once, for the material at roughness 1, so that the garments are matte while the
 * skin keeps `skinRoughness`; and `gain` (skinGain), the colour the canvas is composited for. Reads the
 * skin image's pixels once.
 */
export class SkinTexture {
  readonly texture: CanvasTexture;
  readonly roughnessMap: DataTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly skin: Pixels;
  private readonly baseLayer: Pixels;
  private readonly out: ImageData;
  private readonly calibration: Rgb;
  private tint: string | null = null;
  private face: FaceComposite | null = null;

  constructor(skinImage: CanvasImageSource, baseLayer: ImageData, skinRoughness: number) {
    const { width, height } = baseLayer;
    this.baseLayer = baseLayer;
    this.roughnessMap = new DataTexture(
      bodyRoughness(baseLayer, skinRoughness, GARMENT_ROUGHNESS),
      width,
      height,
      RGFormat,
    );
    // Linear data (no colour space), glTF UVs (flipY false, DataTexture's default), filtered like a map.
    this.roughnessMap.magFilter = LinearFilter;
    this.roughnessMap.minFilter = LinearMipmapLinearFilter;
    this.roughnessMap.generateMipmaps = true;
    this.roughnessMap.needsUpdate = true;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    this.context = context2d(canvas);
    this.context.drawImage(skinImage, 0, 0, width, height);
    this.skin = this.context.getImageData(0, 0, width, height);
    this.calibration = skinGain(this.skin, baseLayer);
    this.out = this.context.createImageData(width, height);
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false; // glTF UVs: v runs down the image, as the skin map's did
  }

  /** The Skin material's colour, in linear RGB: the skin gain of the skin image under the base layer. */
  get gain(): Rgb {
    return this.calibration;
  }

  /**
   * The texture, recomposited for `tint` and `face` (none by default) if either changed. Faces compare
   * by identity: keep one FaceComposite per likeness.
   */
  update(tint: string, face: FaceComposite | null = null): CanvasTexture {
    if (tint !== this.tint || face !== this.face) {
      composeBodyAlbedo(this.skin, this.baseLayer, tint, this.calibration, this.out, face);
      this.context.putImageData(this.out, 0, 0);
      this.texture.needsUpdate = true;
      this.tint = tint;
      this.face = face;
    }
    return this.texture;
  }

  dispose(): void {
    this.texture.dispose();
    this.roughnessMap.dispose();
  }
}

/** Fetches an image into straight-alpha RGBA pixels. Rejects with an Error naming the URL. */
export async function loadImageData(url: string): Promise<ImageData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  return decodeImageData(await response.blob());
}

/** Decodes an encoded image (PNG, WebP…) into straight-alpha RGBA pixels, its colours as stored. */
export async function decodeImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = context2d(canvas);
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is not available');
  return context;
}
