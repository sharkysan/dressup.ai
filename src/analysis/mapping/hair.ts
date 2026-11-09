import { faceBox, LM } from '../landmarks';
import { countOnes, coverage, lowestRow, restrictToBox } from '../masks';
import type { Box, Point2 } from '../types';

export type HairTags = {
  present: boolean;
  length: 'short' | 'medium' | 'long';
  volume: 'low' | 'medium' | 'high';
  bangs: boolean;
  parting: 'left' | 'center' | 'right' | 'none';
};

export const HAIR_RULES = {
  regionWidth: 2.5, // hair is only looked for within this multiple of the face width (other people excluded)
  regionAbove: 1.0, // face heights above the face box
  regionBelow: 3.0, // face heights below the face box (long hair hangs down)
  presentMinArea: 0.02, // of the face box area
  mediumBelowChin: 0.9, // of face height: lowest hair row below this → long
  volumeLow: 0.8, // hair area ÷ face box area
  volumeHigh: 1.6,
  bangsCoverage: 0.4, // of the forehead band
  partingAsymmetry: 0.25, // |left − right| coverage difference
} as const;

/** Hair geometry → catalogue tags (spec §6 "hair mask geometry relative to the face box"). */
export function hairTags(
  hair: Uint8Array,
  width: number,
  height: number,
  pixels: Point2[],
): HairTags {
  const box = faceBox(pixels);
  const region = hairRegion(box, width, height);
  const local = restrictToBox(hair, width, height, region);
  const area = countOnes(local);
  const faceArea = box.width * box.height;
  const none: HairTags = {
    present: false,
    length: 'short',
    volume: 'low',
    bangs: false,
    parting: 'none',
  };
  if (area < HAIR_RULES.presentMinArea * faceArea) return none;

  const chinY = pixels[LM.chin]!.y;
  const lowest = lowestRow(local, width, height);
  const length: HairTags['length'] =
    lowest < chinY
      ? 'short'
      : lowest < chinY + HAIR_RULES.mediumBelowChin * box.height
        ? 'medium'
        : 'long';

  const ratio = area / faceArea;
  const volume: HairTags['volume'] =
    ratio < HAIR_RULES.volumeLow ? 'low' : ratio < HAIR_RULES.volumeHigh ? 'medium' : 'high';

  const browIdx = [...LM.browR.upper, ...LM.browL.upper];
  const browY = browIdx.reduce((s, i) => s + pixels[i]!.y, 0) / browIdx.length;
  const band = { x: box.x, y: box.y, width: box.width, height: Math.max(1, browY - box.y) };
  const bangs = coverage(local, width, height, band) > HAIR_RULES.bangsCoverage;

  let parting: HairTags['parting'] = 'none';
  if (bangs) {
    // Image left is the subject's right.
    const imageLeft = coverage(local, width, height, { ...band, width: band.width / 2 });
    const imageRight = coverage(local, width, height, {
      ...band,
      x: band.x + band.width / 2,
      width: band.width / 2,
    });
    const diff = imageLeft - imageRight;
    parting =
      Math.abs(diff) <= HAIR_RULES.partingAsymmetry ? 'center' : diff > 0 ? 'left' : 'right';
  }
  return { present: true, length, volume, bangs, parting };
}

/** Where hair may be for this face: wide enough for volume, tall enough for long hair, excluding other people. */
export function hairRegion(box: Box, width: number, height: number): Box {
  const cx = box.x + box.width / 2;
  const halfW = (box.width * HAIR_RULES.regionWidth) / 2;
  const x0 = Math.max(0, cx - halfW);
  const x1 = Math.min(width, cx + halfW);
  const y0 = Math.max(0, box.y - box.height * HAIR_RULES.regionAbove);
  const y1 = Math.min(height, box.y + box.height + box.height * HAIR_RULES.regionBelow);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Mask of the brow region, used as a hair-colour fallback when no hair is visible. */
export function browRegionMask(pixels: Point2[], width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const browIdx = [...LM.browR.upper, ...LM.browR.lower, ...LM.browL.upper, ...LM.browL.lower];
  const pad = Math.max(1, faceBox(pixels).height * 0.01);
  for (const i of browIdx) {
    const p = pixels[i]!;
    for (
      let y = Math.max(0, Math.floor(p.y - pad));
      y <= Math.min(height - 1, Math.ceil(p.y + pad));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(p.x - pad));
        x <= Math.min(width - 1, Math.ceil(p.x + pad));
        x++
      )
        mask[y * width + x] = 1;
    }
  }
  return mask;
}
