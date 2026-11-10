import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGFormat,
  SRGBColorSpace,
} from 'three';

/** RGBA pixels, row 0 at the top: an ImageData, or anything shaped like one (tests have no canvas). */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/**
 * The body albedo (spec §3, §7): the neutral skin multiplied by `tint` (#rrggbb) per channel, with the
 * base layer (undershirt and shorts) composited over it by its straight alpha, so the tint never colours
 * the base layer. Opaque. Pure: writes `out` (a new image by default) and returns it.
 */
export function composeBodyAlbedo(
  skin: Pixels,
  baseLayer: Pixels,
  tint: string,
  out?: Pixels,
): Pixels {
  const { width, height } = skin;
  for (const image of out ? [baseLayer, out] : [baseLayer]) {
    if (image.width !== width || image.height !== height) {
      throw new Error(
        `body albedo inputs differ in size: ${width}×${height} vs ${image.width}×${image.height}`,
      );
    }
  }
  const target = out ?? { data: new Uint8ClampedArray(width * height * 4), width, height };
  const t = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) / 255);
  const s = skin.data;
  const b = baseLayer.data;
  const o = target.data;
  for (let i = 0; i < o.length; i += 4) {
    const a = b[i + 3]! / 255;
    for (let c = 0; c < 3; c++) {
      o[i + c] = s[i + c]! * t[c]! * (1 - a) + b[i + c]! * a;
    }
    o[i + 3] = 255;
  }
  return target;
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
 * The Skin material's maps: `texture`, one canvas the base layer's size (2048², the Skin texture's),
 * recomposited by `update` only when the tint changes; and `roughnessMap` (bodyRoughness), built once,
 * for the material at roughness 1, so that the garments are matte while the skin keeps `skinRoughness`.
 * Reads the skin image's pixels once.
 */
export class SkinTexture {
  readonly texture: CanvasTexture;
  readonly roughnessMap: DataTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly skin: Pixels;
  private readonly baseLayer: Pixels;
  private readonly out: ImageData;
  private tint: string | null = null;

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
    this.out = this.context.createImageData(width, height);
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false; // glTF UVs: v runs down the image, as the skin map's did
  }

  /** The texture, recomposited for `tint` if it changed. */
  update(tint: string): CanvasTexture {
    if (tint !== this.tint) {
      composeBodyAlbedo(this.skin, this.baseLayer, tint, this.out);
      this.context.putImageData(this.out, 0, 0);
      this.texture.needsUpdate = true;
      this.tint = tint;
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
  const bitmap = await createImageBitmap(await response.blob(), {
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
