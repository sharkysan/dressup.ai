import { PNG } from 'pngjs';
import type { GlbDoc } from './types';

/** Raw PNG bytes of the image with this name. */
export function getImage(doc: GlbDoc, name: string): Uint8Array {
  const image = doc.json.images.find((i: { name?: string }) => i.name === name);
  if (!image) throw new Error(`image "${name}" not found`);
  if (image.bufferView === undefined) throw new Error(`image "${name}" has no bufferView`);
  const bv = doc.json.bufferViews[image.bufferView]!;
  const start = bv.byteOffset ?? 0;
  return doc.bin.subarray(start, start + bv.byteLength);
}

/** Replaces the bytes of a named image with a new PNG (appends a bufferView; prune later). */
export function replaceImage(doc: GlbDoc, name: string, png: Uint8Array): void {
  const image = doc.json.images.find((i: { name?: string }) => i.name === name);
  if (!image) throw new Error(`image "${name}" not found`);
  const offset = doc.bin.byteLength;
  const padded = (png.byteLength + 3) & ~3;
  const next = new Uint8Array(offset + padded);
  next.set(doc.bin, 0);
  next.set(png, offset);
  doc.bin = next;
  doc.json.buffers[0]!.byteLength = next.byteLength;
  doc.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.byteLength });
  image.bufferView = doc.json.bufferViews.length - 1;
  image.mimeType = 'image/png';
}

export type NeutralizeMode = 'divideByMedian' | 'luminance';

const TARGET_MEDIAN: Record<NeutralizeMode, number> = { divideByMedian: 0.85, luminance: 0.75 };
/** divideByMedian: at most this share of the measured texels may reach 255 in any channel. */
const MAX_CLIPPED = 0.005;

/**
 * Prepares a texture for runtime tinting (spec §7). Measures the opaque pixels, or with `coverage` (a
 * PNG of the same size) only those where its R is non-zero, e.g. the texels a mesh's faces cover.
 * - divideByMedian: divides each channel by the measured pixels' median and scales so the median lands
 *   at 0.85 — keeps blush/shading detail, removes the painted base tone (skin). Lower if needed, so
 *   that at most 0.5% of the measured pixels reach 255 in any channel: highlights keep their detail.
 * - luminance: Rec.709 grey, scaled so the median lands at 0.75 (hair, brows, lashes); a texture
 *   that is black where opaque becomes flat 0.75 grey.
 */
export function neutralizeImage(
  png: Uint8Array,
  mode: NeutralizeMode,
  opts: { coverage?: Uint8Array } = {},
): Uint8Array {
  const img = PNG.sync.read(Buffer.from(png));
  const { data } = img;
  const covered = opts.coverage ? PNG.sync.read(Buffer.from(opts.coverage)) : null;
  if (covered && (covered.width !== img.width || covered.height !== img.height)) {
    throw new Error(
      `coverage is ${covered.width}×${covered.height}, the image ${img.width}×${img.height}: sizes differ`,
    );
  }
  // Offsets of the measured pixels: opaque, and covered when a coverage map is given.
  const measured: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! > 127 && (!covered || covered.data[i]! > 0)) measured.push(i);
  }
  if (measured.length === 0) return png;

  const median = (pick: (i: number) => number) => {
    const values = measured.map(pick).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  };
  const target = TARGET_MEDIAN[mode] * 255;

  if (mode === 'divideByMedian') {
    const med = [median((i) => data[i]!), median((i) => data[i + 1]!), median((i) => data[i + 2]!)];
    const [r, g, b] = med.map((m) => Math.max(m, 1)) as [number, number, number];
    // Each measured pixel's brightest channel over its median, ranked: the pixel MAX_CLIPPED from the
    // top must land at 254 or below (254.5 would round to 255), and so must every one under it.
    const ratios = measured
      .map((i) => Math.max(data[i]! / r, data[i + 1]! / g, data[i + 2]! / b))
      .sort((x, y) => x - y);
    const limit = ratios[Math.floor(ratios.length * (1 - MAX_CLIPPED))]!;
    const level = Math.min(target, 254 / limit);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255((data[i]! / r) * level);
      data[i + 1] = clamp255((data[i + 1]! / g) * level);
      data[i + 2] = clamp255((data[i + 2]! / b) * level);
    }
  } else {
    const lum = (i: number) => 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    const med = median(lum);
    // Black where opaque (MakeHuman's brows and lashes): the shape is all in alpha and there is no
    // shading to keep, so the texture turns flat grey rather than amplifying near-zero noise.
    const black = med < 1;
    for (let i = 0; i < data.length; i += 4) {
      const g = black ? clamp255(target) : clamp255((lum(i) / med) * target);
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
    }
  }
  return new Uint8Array(PNG.sync.write(img));
}

/** Bilinear downscale so neither side exceeds maxSize; returns the input untouched when already small. */
export function resizeImage(png: Uint8Array, maxSize: number): Uint8Array {
  const src = PNG.sync.read(Buffer.from(png));
  const scale = maxSize / Math.max(src.width, src.height);
  if (scale >= 1) return png;
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = ((y + 0.5) / height) * src.height - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) / width) * src.width - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c]!;
        const p10 = src.data[(y0 * src.width + x1) * 4 + c]!;
        const p01 = src.data[(y1 * src.width + x0) * 4 + c]!;
        const p11 = src.data[(y1 * src.width + x1) * 4 + c]!;
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        dst.data[(y * width + x) * 4 + c] = clamp255(top + (bottom - top) * fy);
      }
    }
  }
  return new Uint8Array(PNG.sync.write(dst));
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Resizes every embedded image so neither side exceeds `maxSize` (spec §12: textures ≤1024²). */
export function resizeAllImages(doc: GlbDoc, maxSize: number): void {
  doc.json.images.forEach((image: { name?: string; bufferView?: number }, index: number) => {
    if (image.bufferView === undefined) return;
    const bv = doc.json.bufferViews[image.bufferView]!;
    const start = bv.byteOffset ?? 0;
    const png = doc.bin.subarray(start, start + bv.byteLength);
    const resized = resizeImage(png, maxSize);
    if (resized !== png) replaceImageAt(doc, index, resized);
  });
}

/**
 * Downscales each image a material uses so neither side exceeds `maxFor(imageName, materialName)`; an
 * image several materials share keeps the largest size any of them allows. Images no material uses are
 * left alone (prune drops them).
 */
export function resizeImages(
  doc: GlbDoc,
  maxFor: (imageName: string, materialName: string) => number,
): void {
  const limits = new Map<number, number>();
  for (const material of doc.json.materials) {
    for (const index of textureIndices(material)) {
      const source: number | undefined = doc.json.textures[index]?.source;
      if (source === undefined) continue;
      const limit = maxFor(doc.json.images[source]?.name ?? '', material.name ?? '');
      limits.set(source, Math.max(limits.get(source) ?? 0, limit));
    }
  }
  for (const [index, maxSize] of limits) {
    const image = doc.json.images[index];
    if (image?.bufferView === undefined) continue;
    const bv = doc.json.bufferViews[image.bufferView]!;
    const start = bv.byteOffset ?? 0;
    const png = doc.bin.subarray(start, start + bv.byteLength);
    const resized = resizeImage(png, maxSize);
    if (resized !== png) replaceImageAt(doc, index, resized);
  }
}

/** The texture indices a material references: every `…Texture: { index }`, extensions included. */
function textureIndices(node: unknown, key = ''): number[] {
  if (typeof node !== 'object' || node === null) return [];
  const { index } = node as { index?: unknown };
  if (key.endsWith('Texture') && typeof index === 'number') return [index];
  return Object.entries(node).flatMap(([k, v]) => textureIndices(v, k));
}

/** Replaces the bytes of the image at `index` (by position, so unnamed/duplicate names are safe). */
export function replaceImageAt(doc: GlbDoc, index: number, png: Uint8Array): void {
  const image = doc.json.images[index];
  if (!image) throw new Error(`image ${index} not found`);
  const offset = doc.bin.byteLength;
  const padded = (png.byteLength + 3) & ~3;
  const next = new Uint8Array(offset + padded);
  next.set(doc.bin, 0);
  next.set(png, offset);
  doc.bin = next;
  doc.json.buffers[0]!.byteLength = next.byteLength;
  doc.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.byteLength });
  image.bufferView = doc.json.bufferViews.length - 1;
  image.mimeType = 'image/png';
}
