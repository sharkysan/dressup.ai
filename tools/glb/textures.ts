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

/**
 * Prepares a texture for runtime tinting (spec §7).
 * - divideByMedian: divides each channel by the median colour of opaque pixels and scales so the
 *   median lands at 0.85 — keeps blush/shading detail, removes the painted base tone (skin).
 * - luminance: Rec.709 grey, scaled so the median lands at 0.75 (hair, iris).
 */
export function neutralizeImage(png: Uint8Array, mode: NeutralizeMode): Uint8Array {
  const img = PNG.sync.read(Buffer.from(png));
  const { data } = img;
  const opaque: number[] = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 127) opaque.push(i);
  if (opaque.length === 0) return png;

  const median = (pick: (i: number) => number) => {
    const values = opaque.map(pick).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  };
  const target = TARGET_MEDIAN[mode] * 255;

  if (mode === 'divideByMedian') {
    const med = [median((i) => data[i]!), median((i) => data[i + 1]!), median((i) => data[i + 2]!)];
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const m = Math.max(med[c]!, 1);
        data[i + c] = clamp255((data[i + c]! / m) * target);
      }
    }
  } else {
    const lum = (i: number) => 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    const med = Math.max(median(lum), 1);
    for (let i = 0; i < data.length; i += 4) {
      const g = clamp255((lum(i) / med) * target);
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
