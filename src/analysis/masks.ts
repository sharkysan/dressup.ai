import type { Box, CategoryMask } from './types';

/** 0/1 mask (at the category mask's resolution) where the category equals `value`. */
export function categoryEquals(mask: CategoryMask, value: number): Uint8Array {
  const out = new Uint8Array(mask.data.length);
  for (let i = 0; i < out.length; i++) out[i] = mask.data[i] === value ? 1 : 0;
  return out;
}

/** Nearest-neighbour resample of a 0/1 mask. */
export function resampleMask(
  data: Uint8Array,
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): Uint8Array {
  if (fromW === toW && fromH === toH) return data.slice();
  const out = new Uint8Array(toW * toH);
  for (let y = 0; y < toH; y++) {
    const sy = Math.min(fromH - 1, Math.floor(((y + 0.5) / toH) * fromH));
    for (let x = 0; x < toW; x++) {
      const sx = Math.min(fromW - 1, Math.floor(((x + 0.5) / toW) * fromW));
      out[y * toW + x] = data[sy * fromW + sx]!;
    }
  }
  return out;
}

export function restrictToBox(
  mask: Uint8Array,
  width: number,
  height: number,
  box: Box,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) out[y * width + x] = mask[y * width + x]!;
  return out;
}

export function andMasks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! & b[i]!;
  return out;
}

export function countOnes(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i]!;
  return n;
}

/** Bottom-most row containing a set pixel, or −1. */
export function lowestRow(mask: Uint8Array, width: number, height: number): number {
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = 0; x < width; x++) if (mask[row + x]) return y;
  }
  return -1;
}

/** Fraction (0..1) of the box's pixels that are set. */
export function coverage(mask: Uint8Array, width: number, height: number, box: Box): number {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  const total = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (total === 0) return 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += mask[y * width + x]!;
  return n / total;
}

/** Grows a box about its centre by `factor`, clamped to the image. */
export function expandBox(box: Box, factor: number, width: number, height: number): Box {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const w = box.width * factor;
  const h = box.height * factor;
  const x0 = Math.max(0, cx - w / 2);
  const y0 = Math.max(0, cy - h / 2);
  const x1 = Math.min(width, cx + w / 2);
  const y1 = Math.min(height, cy + h / 2);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
