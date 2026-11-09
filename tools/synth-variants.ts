/**
 * synth-variants (DEV ONLY): fakes the 16 face-morph variant files from a neutral VRM by warping
 * regions of the 'Face' mesh. Real variants must come from VRoid slider extremes or Blender.
 *   tsx tools/synth-variants.ts --src assets/source/base-a/neutral.vrm --out assets/source/base-a/morphs
 */
import fs from 'node:fs';
import path from 'node:path';
import { cli, required } from './cli';
import { appendAccessor, readAccessor } from './glb/accessors';
import { readGlb, writeGlb } from './glb/glb';
import type { GlbDoc } from './glb/types';

type Ctx = { cx: number; cy: number; cz: number; W: number; H: number; D: number };
type Warp = (x: number, y: number, z: number, s: 1 | -1, c: Ctx) => [number, number, number];

const sgn = (v: number) => (v < 0 ? -1 : 1);

export const WARPS: Record<string, Warp> = {
  faceWidth: (x, y, z, s, c) => [c.cx + (x - c.cx) * (1 + s * 0.08), y, z],
  jawWidth: (x, y, z, s, c) =>
    y < c.cy - 0.25 * c.H ? [c.cx + (x - c.cx) * (1 + s * 0.1), y, z] : [x, y, z],
  chinLength: (x, y, z, s, c) => (y < c.cy - 0.4 * c.H ? [x, y - s * 0.04 * c.H, z] : [x, y, z]),
  noseWidth: (x, y, z, s, c) =>
    inNose(x, y, z, c) ? [c.cx + (x - c.cx) * (1 + s * 0.3), y, z] : [x, y, z],
  noseLength: (x, y, z, s, c) => (inNose(x, y, z, c) ? [x, y, z + s * 0.04 * c.D] : [x, y, z]),
  eyeSpacing: (x, y, z, s, c) =>
    inEyeBand(x, y, c) ? [x + s * sgn(x - c.cx) * 0.03 * c.W, y, z] : [x, y, z],
  eyeSize: (x, y, z, s, c) => {
    if (!inEyeBand(x, y, c)) return [x, y, z];
    const ex = c.cx + sgn(x - c.cx) * 0.3 * c.W;
    const ey = c.cy + 0.08 * c.H;
    return [ex + (x - ex) * (1 + s * 0.1), ey + (y - ey) * (1 + s * 0.1), z];
  },
  lipFullness: (x, y, z, s, c) => {
    const inMouth =
      y > c.cy - 0.25 * c.H && y < c.cy - 0.1 * c.H && Math.abs(x - c.cx) < 0.25 * c.W;
    if (!inMouth) return [x, y, z];
    const my = c.cy - 0.175 * c.H;
    return [x, my + (y - my) * (1 + s * 0.15), z];
  },
};

function inNose(x: number, y: number, z: number, c: Ctx): boolean {
  return Math.abs(x - c.cx) < 0.08 * c.W && Math.abs(y - c.cy) < 0.15 * c.H && z > c.cz + 0.3 * c.D;
}
function inEyeBand(x: number, y: number, c: Ctx): boolean {
  return Math.abs(x - c.cx) > 0.15 * c.W && y > c.cy - 0.1 * c.H && y < c.cy + 0.25 * c.H;
}

function facePrimitives(doc: GlbDoc) {
  const face = doc.json.meshes.find((m: { name?: string }) => m.name === 'Face');
  if (!face) throw new Error("no mesh named 'Face'");
  return face.primitives as { attributes: Record<string, number> }[];
}

export function faceContext(doc: GlbDoc): Ctx {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of facePrimitives(doc)) {
    const pos = readAccessor(doc, p.attributes.POSITION!);
    for (let i = 0; i < pos.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = pos[i + c]!;
        if (v < min[c]!) min[c] = v;
        if (v > max[c]!) max[c] = v;
      }
    }
  }
  return {
    cx: (min[0]! + max[0]!) / 2,
    cy: (min[1]! + max[1]!) / 2,
    cz: (min[2]! + max[2]!) / 2,
    W: max[0]! - min[0]!,
    H: max[1]! - min[1]!,
    D: max[2]! - min[2]!,
  };
}

/** Returns a copy of `doc` whose Face POSITIONs are warped; other data is shared. */
export function warpFace(doc: GlbDoc, warp: Warp, s: 1 | -1): GlbDoc {
  const out: GlbDoc = { json: structuredClone(doc.json), bin: doc.bin.slice() };
  const ctx = faceContext(doc);
  for (const p of facePrimitives(out)) {
    const pos = readAccessor(out, p.attributes.POSITION!) as Float32Array;
    const next = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = warp(pos[i]!, pos[i + 1]!, pos[i + 2]!, s, ctx);
      next[i] = x;
      next[i + 1] = y;
      next[i + 2] = z;
    }
    p.attributes.POSITION = appendAccessor(out, next, 'VEC3', { minMax: true, target: 34962 });
  }
  return out;
}

if (process.argv[1] && /synth-variants\.(ts|js)$/.test(process.argv[1])) {
  const args = cli(['src', 'out'] as const, [] as const);
  const src = required(args.src, 'src');
  const outDir = required(args.out, 'out');
  const doc = readGlb(new Uint8Array(fs.readFileSync(src)));
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, warp] of Object.entries(WARPS)) {
    for (const [suffix, s] of [
      ['max', 1],
      ['min', -1],
    ] as const) {
      fs.writeFileSync(
        path.join(outDir, `${name}.${suffix}.vrm`),
        writeGlb(warpFace(doc, warp, s)),
      );
    }
  }
  console.log(`wrote ${Object.keys(WARPS).length * 2} SYNTHETIC variants to ${outDir}`);
  console.log(
    'reminder: these are dev placeholders — real variants must come from VRoid slider extremes or Blender.',
  );
}
