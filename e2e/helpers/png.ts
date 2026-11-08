import { PNG } from 'pngjs';

export function readPngSize(buf: Buffer): { width: number; height: number } {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height };
}

/** Counts distinct RGB triples over a sample of pixels — a cheap "is this image blank?" check. */
export function countDistinctColors(buf: Buffer, sampleEvery = 4): number {
  const png = PNG.sync.read(buf);
  const seen = new Set<number>();
  for (let i = 0; i < png.data.length; i += 4 * sampleEvery) {
    const r = png.data[i] ?? 0;
    const g = png.data[i + 1] ?? 0;
    const b = png.data[i + 2] ?? 0;
    seen.add((r << 16) | (g << 8) | b);
  }
  return seen.size;
}

/** Fraction of pixels that are fully transparent (alpha 0). */
export function transparentFraction(buf: Buffer): number {
  const png = PNG.sync.read(buf);
  let transparent = 0;
  const total = png.width * png.height;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] === 0) transparent++;
  return transparent / total;
}
