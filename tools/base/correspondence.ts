/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * buildCorrespondence: how MediaPipe's face maps onto the exported base (spec §12), → correspondence.json.
 * Everything is measured in the Body's bind space (metres, +Y up, facing +Z, +X the subject's left), and
 * vertex indices are glTF vertex indices of the shipped Body primitive.
 * Steps: the head vertices (head weight > 0) → the face island (the Body's UV island around the nose
 * tip) → the canonical face aligned to the base by a similarity fitted to three anchors (the corneas and
 * the nose tip) → each canonical landmark projected onto the face island: the lips and the base of the
 * nose along the view direction, as the frontal photo sees them (viewProjection), every other landmark
 * to its closest point → the face mesh's triangles, the face texture's UV square and the head fit's zero
 * points → validated against the schema. Also renders a front view for review.
 */
import { LM } from '../../src/analysis/landmarks';
import { BODY_MESH, MATERIALS } from '../../src/avatar/baseContract';
import {
  FACE_LANDMARKS,
  correspondenceSchema,
  type Correspondence,
} from '../../src/likeness/correspondence';
import { applySimilarity, umeyama, type Vec3 } from '../../src/likeness/similarity';
import { readAccessor } from '../glb/accessors';
import { findHumanBoneNode } from '../glb/humanoid';
import type { GlbDoc } from '../glb/types';
import type { readCanonicalFace } from './canonicalFace';

/**
 * build_base.py's HEAD_GROUPS, by humanoid bone: the share of each bone's skin weight that counts as head.
 * MPFB's rig names these bones `head` and `neck_01`.
 */
const HEAD_GROUPS = { head: 1, neck: 0.5 } as const;
/** build_base.py's HEAD_WEIGHT_STILL: at or above it a vertex moves with the head alone. */
const WHOLLY_HEAD = 0.999;
/** The nose tip is searched within this distance of the midline, x = 0. */
const MIDLINE_M = 0.001;
/** The zero points lie this far behind the ears, on a grid of this pitch. */
const BEHIND_EARS_M = 0.01;
const ZERO_GRID_M = 0.02;
/** faceUvRect's side over the landmark uvs' longer extent. */
const UV_RECT_MARGIN = 1.1;
const REVIEW_SIZE = 512;

/**
 * MediaPipe's lip contours, outermost first: its outer and inner lip contours (FACEMESH_LIPS) and the
 * two rings between them, each from the subject's right mouth corner to the left. The corners belong to
 * both lips.
 */
export const LIP_RINGS = {
  upper: [
    [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
    [76, 184, 74, 73, 72, 11, 302, 303, 304, 408, 306],
    [62, 183, 42, 41, 38, 12, 268, 271, 272, 407, 292],
    [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  ],
  lower: [
    [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    [76, 77, 90, 180, 85, 16, 315, 404, 320, 307, 306],
    [62, 96, 89, 179, 86, 15, 316, 403, 319, 325, 292],
    [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  ],
} as const;
/**
 * The base of the nose, by MediaPipe index: the columella and the tip's underside, the nostril rims and
 * the alar wings. The two points inside each nostril (59 and 75, 289 and 305) are left to the ring
 * around it: in the base's nostril their view lines meet the inner wall, whose uvs run against the
 * front view, and the face mesh folds there.
 */
export const NOSE_BASE: readonly number[] = [
  1, 2, 19, 94, 141, 370, 125, 354, 44, 274, 241, 461, 242, 462, 238, 458, 239, 459, 20, 250, 60,
  290, 79, 309, 166, 392, 237, 457, 218, 438, 219, 439, 235, 455, 97, 326, 99, 328, 98, 327, 240,
  460, 64, 294, 48, 278, 115, 344, 220, 440, 45, 275,
];
/**
 * The base's mouth slit is searched this far above and below the canonical mouth line, at this pitch, in
 * columns this far apart.
 */
const SLIT_REACH_M = 0.004;
const SLIT_STEP_M = 0.0001;
const SLIT_COLUMN_M = 0.00025;
/** Triangles this far outside a region's frontal extent are left out of its view projection. */
const VIEW_MARGIN_M = 0.01;
/**
 * A view line that meets the face this far behind the aligned canonical point has passed into the mouth
 * or a nostril.
 */
const VIEW_DEPTH_M = 0.01;

/** An RGBA image, row-major from the top-left. */
type Review = { data: Uint8Array; width: number; height: number };

/** The mesh's only primitive (vertex indices are per primitive, so a split mesh would be ambiguous). */
function onlyPrimitive(doc: GlbDoc, mesh: string): { meshIndex: number; primitive: any } {
  const meshIndex = doc.json.meshes.findIndex((m: any) => m.name === mesh);
  if (meshIndex < 0) throw new Error(`mesh ${mesh} is missing`);
  const { primitives } = doc.json.meshes[meshIndex];
  if (primitives.length !== 1) {
    throw new Error(`mesh ${mesh} has ${primitives.length} primitives, expected 1`);
  }
  return { meshIndex, primitive: primitives[0] };
}

/** Per vertex of `mesh`: its head joint's weight plus half its neck_01 joint's weight (HEAD_GROUPS). */
export function headWeights(doc: GlbDoc, mesh: string): Float32Array {
  const { meshIndex, primitive } = onlyPrimitive(doc, mesh);
  const node = doc.json.nodes.find((n: any) => n.mesh === meshIndex && n.skin !== undefined);
  if (!node) throw new Error(`mesh ${mesh} is not skinned`);
  const joints: number[] = doc.json.skins[node.skin].joints;
  const shareOfJoint = new Map<number, number>();
  for (const [bone, share] of Object.entries(HEAD_GROUPS)) {
    const joint = joints.indexOf(findHumanBoneNode(doc.json, bone));
    if (joint < 0) throw new Error(`the humanoid ${bone} bone is not a joint of ${mesh}`);
    shareOfJoint.set(joint, share);
  }
  const out = new Float32Array(doc.json.accessors[primitive.attributes.POSITION].count);
  for (let set = 0; primitive.attributes[`JOINTS_${set}`] !== undefined; set++) {
    const ids = readAccessor(doc, primitive.attributes[`JOINTS_${set}`]);
    const weights = readAccessor(doc, primitive.attributes[`WEIGHTS_${set}`]);
    // Normalised unsigned byte or short weights, or floats.
    const type = doc.json.accessors[primitive.attributes[`WEIGHTS_${set}`]].componentType;
    const unit = type === 5121 ? 255 : type === 5123 ? 65535 : 1;
    for (let i = 0; i < ids.length; i++) {
      const share = shareOfJoint.get(ids[i]!);
      if (share !== undefined) out[i >> 2]! += (share * weights[i]!) / unit;
    }
  }
  return out;
}

const vertex = (xyz: ArrayLike<number>, v: number): Vec3 => [
  xyz[3 * v]!,
  xyz[3 * v + 1]!,
  xyz[3 * v + 2]!,
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Rounded to `places` decimals, −0 as 0 (JSON writes it as 0, so the data round-trips). */
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places + 0;

/** The frontmost (max z) vertex weighted wholly to the head within MIDLINE_M of x = 0. */
function noseTip(positions: Float32Array, weights: Float32Array): number {
  let nose = -1;
  for (let v = 0; v < weights.length; v++) {
    if (weights[v]! < WHOLLY_HEAD || Math.abs(positions[3 * v]!) >= MIDLINE_M) continue;
    if (nose < 0 || positions[3 * v + 2]! > positions[3 * nose + 2]!) nose = v;
  }
  if (nose < 0) throw new Error(`no head vertex within ${MIDLINE_M} m of the midline`);
  return nose;
}

/**
 * The first index of each triangle of the connected component (through shared vertices) that holds
 * `seed`. The exporter splits vertices at UV seams, so the components are the UV islands.
 */
function island(index: ArrayLike<number>, vertexCount: number, seed: number): number[] {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]!]!;
    return v;
  };
  for (let t = 0; t < index.length; t += 3) {
    parent[find(index[t + 1]!)] = find(index[t]!);
    parent[find(index[t + 2]!)] = find(index[t]!);
  }
  const root = find(seed);
  const triangles: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (find(index[t]!) === root) triangles.push(t);
  return triangles;
}

/** Each eyeball's frontmost vertex, the subject's right eye (−x) first. */
function corneas(doc: GlbDoc): [Vec3, Vec3] {
  const { primitive } = onlyPrimitive(doc, MATERIALS.eyes);
  const xyz = readAccessor(doc, primitive.attributes.POSITION);
  const front: (Vec3 | null)[] = [null, null];
  for (let v = 0; v < xyz.length / 3; v++) {
    const p = vertex(xyz, v);
    const eye = p[0] < 0 ? 0 : 1;
    if (!front[eye] || p[2] > front[eye][2]) front[eye] = p;
  }
  if (!front[0] || !front[1]) throw new Error(`mesh ${MATERIALS.eyes} lacks an eye on each side`);
  return [front[0], front[1]];
}

/**
 * Barycentrics of the point of triangle abc closest to p (Ericson, Real-Time Collision Detection 5.1.5),
 * or null for a degenerate triangle.
 */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const area = va + vb + vc;
  if (!(area > 0)) return null;
  return [va / area, vb / area, vc / area];
}

/** The triangle (first index) of `triangles` and the barycentrics of its point closest to p. */
function closestOn(
  p: Vec3,
  triangles: number[],
  positions: Float32Array,
  index: ArrayLike<number>,
): { t: number; bary: Vec3 } {
  let best = { distance: Infinity, t: -1, bary: [1, 0, 0] as Vec3 };
  for (const t of triangles) {
    const corners = [0, 1, 2].map((k) => vertex(positions, index[t + k]!));
    const bary = closestOnTriangle(p, corners[0]!, corners[1]!, corners[2]!);
    if (!bary) continue;
    const q = [0, 1, 2].map((axis) => corners.reduce((sum, c, k) => sum + bary[k]! * c[axis]!, 0));
    const distance = Math.hypot(...sub(q as Vec3, p));
    if (distance < best.distance) best = { distance, t, bary };
  }
  if (best.t < 0) throw new Error('the face island has no triangle with an area');
  return best;
}

type Hit = { t: number; bary: Vec3 };

/**
 * The frontmost point of `triangles` on the line through p along the base's view direction (−z): the
 * triangle (first index), the barycentrics and the depth of the hit, or null if the line misses.
 */
function alongView(
  p: Vec3,
  triangles: number[],
  positions: Float32Array,
  index: ArrayLike<number>,
): (Hit & { z: number }) | null {
  let best: (Hit & { z: number }) | null = null;
  const [px, py] = [p[0], p[1]];
  for (const t of triangles) {
    const [a, b, c] = [3 * index[t]!, 3 * index[t + 1]!, 3 * index[t + 2]!];
    const [ax, ay, bx, by, cx, cy] = [
      positions[a]!,
      positions[a + 1]!,
      positions[b]!,
      positions[b + 1]!,
      positions[c]!,
      positions[c + 1]!,
    ];
    // The barycentrics of (p.x, p.y) in the triangle's front view are the hit's.
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue; // seen edge on
    const wb = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det;
    const wc = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det;
    const wa = 1 - wb - wc;
    if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
    const z = wa * positions[a + 2]! + wb * positions[b + 2]! + wc * positions[c + 2]!;
    if (best && z <= best.z) continue;
    const w = [wa, wb, wc].map((x) => Math.max(x, 0));
    const sum = w[0]! + w[1]! + w[2]!;
    best = { t, bary: w.map((x) => x / sum) as Vec3, z };
  }
  return best;
}

/** The solution of the 3×3 system a·x = b (a row-major), by Cramer's rule. */
function solve3(a: number[], b: Vec3): Vec3 {
  const det3 = (m: number[]) =>
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const d = det3(a);
  if (!(Math.abs(d) > 0)) throw new Error('solve3: singular system');
  return [0, 1, 2].map(
    (col) => det3(a.map((x, k) => (k % 3 === col ? b[(k / 3) | 0]! : x))) / d,
  ) as Vec3;
}

/**
 * The least-squares affine map from the canonical face's uvs to the base's front view (x, y), fitted
 * at `fit`: the landmarks' aligned positions.
 */
function uvToFront(
  uvs: [number, number][],
  aligned: Vec3[],
  fit: number[],
): (i: number) => [number, number] {
  const ata = new Array<number>(9).fill(0);
  const atx: Vec3 = [0, 0, 0];
  const aty: Vec3 = [0, 0, 0];
  for (const i of fit) {
    const row = [uvs[i]![0], uvs[i]![1], 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) ata[3 * r + c]! += row[r]! * row[c]!;
      atx[r]! += row[r]! * aligned[i]![0];
      aty[r]! += row[r]! * aligned[i]![1];
    }
  }
  const [mx, my] = [solve3(ata, atx), solve3(ata, aty)];
  return (i) => {
    const [u, v] = uvs[i]!;
    return [mx[0] * u + mx[1] * v + mx[2], my[0] * u + my[1] * v + my[2]];
  };
}

/** The landmarks outside `region` that share a face-mesh triangle with one inside it. */
function ringAround(region: Set<number>, triangles: [number, number, number][]): number[] {
  const ring = new Set<number>();
  for (const t of triangles) {
    if (t.some((i) => region.has(i))) for (const i of t) if (!region.has(i)) ring.add(i);
  }
  return [...ring].sort((a, b) => a - b);
}

/** y on the polyline through `points` (sorted by x) at x: linear between them, constant past the ends. */
function polylineAt(points: [number, number][], x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let k = 1; k < points.length; k++) {
    const [x1, y1] = points[k]!;
    if (x > x1) continue;
    const [x0, y0] = points[k - 1]!;
    return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1]![1];
}

/**
 * The base's mouth slit seen from the front: over columns SLIT_COLUMN_M apart from x0 to x1, the highest
 * and lowest y within SLIT_REACH_M of mouth(x) where the view line misses the face or meets it behind
 * `deepest` (it has passed between the closed lips into the mouth), the run of such samples nearest
 * mouth(x). Columns without one (past the mouth corners) are left out; null if every column is.
 */
function mouthSlit(
  x0: number,
  x1: number,
  mouth: (x: number) => number,
  deepest: number,
  triangles: number[],
  positions: Float32Array,
  index: ArrayLike<number>,
): { top: [number, number][]; bottom: [number, number][] } | null {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const steps = Math.round(SLIT_REACH_M / SLIT_STEP_M);
  for (let x = x0; x <= x1; x += SLIT_COLUMN_M) {
    const y = mouth(x);
    let best: { top: number; bottom: number; gap: number } | null = null;
    let run: { top: number; bottom: number } | null = null;
    for (let k = steps; k >= -steps - 1; k--) {
      const at = y + k * SLIT_STEP_M;
      const hit = k >= -steps ? alongView([x, at, 0], triangles, positions, index) : undefined;
      if (hit !== undefined && (hit === null || hit.z < deepest)) {
        if (run) run.bottom = at;
        else run = { top: at, bottom: at };
      } else if (run) {
        const gap = y > run.top ? y - run.top : y < run.bottom ? run.bottom - y : 0;
        if (!best || gap < best.gap) best = { top: run.top, bottom: run.bottom, gap };
        run = null;
      }
    }
    if (!best) continue;
    top.push([x, best.top]);
    bottom.push([x, best.bottom]);
  }
  return top.length > 0 ? { top, bottom } : null;
}

/**
 * The 2-D thin-plate spline through the pairs from[k] → to[k] (Bookstein 1989): an affine part plus
 * Σ w_k φ(|p − from[k]|), φ(r) = r² log r, the smoothest map that interpolates them. Worked in mm.
 */
function thinPlate(
  from: [number, number][],
  to: [number, number][],
): (p: [number, number]) => [number, number] {
  const n = from.length;
  const src = from.map(([x, y]) => [1000 * x, 1000 * y] as const);
  const phi = (dx: number, dy: number) => {
    const r2 = dx * dx + dy * dy;
    return r2 > 0 ? 0.5 * r2 * Math.log(r2) : 0;
  };
  // [K P; Pᵀ 0] [w; a] = [v; 0], for x and y at once (two right-hand sides), by Gaussian elimination.
  const size = n + 3;
  const m = Array.from({ length: size }, () => new Array<number>(size + 2).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) m[i]![j] = phi(src[i]![0] - src[j]![0], src[i]![1] - src[j]![1]);
    const row = [1, src[i]![0], src[i]![1]];
    for (let k = 0; k < 3; k++) m[i]![n + k] = m[n + k]![i] = row[k]!;
    m[i]![size] = 1000 * to[i]![0];
    m[i]![size + 1] = 1000 * to[i]![1];
  }
  for (let c = 0; c < size; c++) {
    let pivot = c;
    for (let r = c + 1; r < size; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    if (!(Math.abs(m[pivot]![c]!) > 1e-12)) throw new Error('thinPlate: degenerate control points');
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = 0; r < size; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      if (f !== 0) for (let k = c; k < size + 2; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  const coef = (out: number) => m.map((row, c) => row[size + out]! / row[c]!);
  const [cx, cy] = [coef(0), coef(1)];
  return ([px, py]) => {
    const [x, y] = [1000 * px, 1000 * py];
    let [fx, fy] = [
      cx[n]! + cx[n + 1]! * x + cx[n + 2]! * y,
      cy[n]! + cy[n + 1]! * x + cy[n + 2]! * y,
    ];
    for (let k = 0; k < n; k++) {
      const v = phi(x - src[k]![0], y - src[k]![1]);
      fx += cx[k]! * v;
      fy += cy[k]! * v;
    }
    return [fx / 1000, fy / 1000];
  };
}

/**
 * Brings the lips' front-view targets onto the base's closed mouth by a thin-plate spline: the ring of
 * skin around the lips goes to its own front view (`ring`), the inner lip contours (where the lips meet)
 * to the slit's edges, just outside it, each on its own lip, and the inner mouth corners to the slit's
 * ends, just past them, where the lips close. The rest of the lips follows smoothly, in order.
 */
function toMouthSlit(
  targets: Map<number, [number, number]>,
  ring: Map<number, [number, number]>,
  slit: { top: [number, number][]; bottom: [number, number][] },
): void {
  const from: [number, number][] = [];
  const to: [number, number][] = [];
  for (const [i, p] of ring) {
    from.push(targets.get(i)!);
    to.push(p);
  }
  const [upper, lower] = [LIP_RINGS.upper[3], LIP_RINGS.lower[3]];
  const corners = new Set<number>(upper.filter((i) => (lower as readonly number[]).includes(i)));
  const ends = [slit.top[0]!, slit.top[slit.top.length - 1]!].map(([x], k) => {
    const out = (k === 0 ? -1 : 1) * SLIT_COLUMN_M;
    const mid = (polylineAt(slit.top, x) + polylineAt(slit.bottom, x)) / 2;
    return [x + out, mid] as [number, number];
  });
  for (const [ringOf, edge, out] of [
    [upper, slit.top, SLIT_STEP_M],
    [lower, slit.bottom, -SLIT_STEP_M],
  ] as const) {
    for (const i of ringOf) {
      if (corners.has(i)) continue;
      const [x] = targets.get(i)!;
      from.push(targets.get(i)!);
      to.push([x, polylineAt(edge, x) + out]);
    }
  }
  for (const i of corners) {
    const [x] = targets.get(i)!;
    from.push(targets.get(i)!);
    to.push(x < 0 ? ends[0]! : ends[1]!);
  }
  const warp = thinPlate(from, to);
  for (const [i, p] of targets) targets.set(i, warp(p));
}

/**
 * The lips and the base of the nose seen from the front, as the photo sees them: each of those landmarks
 * where the view line through it meets the face. Closest-point projection fails there: the aligned
 * canonical lips lie 13–21 mm behind the base's, and from behind a convex lip the closest point is the
 * crease between the lips, so the whole upper lip would collapse onto it.
 *
 * Where the line runs comes from the canonical face's uv layout, not its geometry: seen from the front,
 * the canonical inner lips curl behind their neighbours and the nostrils fold, while the uv layout is
 * fold-free and closes the mouth, as the base's is. Per region an affine map takes the uvs to the front
 * view, fitted to the ring of landmarks around the region. The lips are then brought onto the base's
 * mouth slit (toMouthSlit). The ring goes along the view too, from its own aligned front view, so that
 * the change to closest-point comes one ring further out, on smooth skin. A landmark whose line misses
 * the face, or passes into the mouth or a nostril, keeps its closest point.
 */
function viewProjection(
  face: ReturnType<typeof readCanonicalFace>,
  aligned: Vec3[],
  triangles: number[],
  positions: Float32Array,
  index: ArrayLike<number>,
): Map<number, Hit> {
  const mesh = face.triangles.filter((t) => t.every((i) => i < FACE_LANDMARKS));
  const lips = new Set<number>([...LIP_RINGS.upper.flat(), ...LIP_RINGS.lower.flat()]);
  const out = new Map<number, Hit>();
  for (const region of [lips, new Set(NOSE_BASE)]) {
    const around = ringAround(region, mesh);
    const front = uvToFront(face.uvs, aligned, around);
    const targets = new Map([...region].map((i) => [i, front(i)] as [number, [number, number]]));
    const ring = new Map(
      around
        .filter((i) => !out.has(i))
        .map((i) => [i, [aligned[i]![0], aligned[i]![1]]] as [number, [number, number]]),
    );
    const xs = [...targets.values(), ...ring.values()].map((p) => p[0]);
    const ys = [...targets.values(), ...ring.values()].map((p) => p[1]);
    const [x0, x1] = [Math.min(...xs) - VIEW_MARGIN_M, Math.max(...xs) + VIEW_MARGIN_M];
    const [y0, y1] = [Math.min(...ys) - VIEW_MARGIN_M, Math.max(...ys) + VIEW_MARGIN_M];
    const near = triangles.filter((t) =>
      [0, 1, 2].some((k) => {
        const [x, y] = vertex(positions, index[t + k]!);
        return x > x0 && x < x1 && y > y0 && y < y1;
      }),
    );
    if (region === lips) {
      const contour = (ring: readonly number[]) =>
        ring.map((i) => targets.get(i)!).sort((p, q) => p[0] - q[0]);
      const [ui, li, uo] = [LIP_RINGS.upper[3], LIP_RINGS.lower[3], LIP_RINGS.upper[0]].map(
        contour,
      );
      const mouth = (x: number) => (polylineAt(ui!, x) + polylineAt(li!, x)) / 2;
      const deepest = Math.min(...[...region].map((i) => aligned[i]![2])) - VIEW_DEPTH_M;
      const [left, right] = [uo![0]![0], uo![uo!.length - 1]![0]];
      const slit = mouthSlit(left, right, mouth, deepest, near, positions, index);
      if (slit) {
        for (const i of ring.keys()) targets.set(i, front(i));
        toMouthSlit(targets, ring, slit);
      }
    }
    for (const [i, p] of ring) targets.set(i, p);
    for (const [i, [x, y]] of targets) {
      const hit = alongView([x, y, 0], near, positions, index);
      if (hit && hit.z >= aligned[i]![2] - VIEW_DEPTH_M) out.set(i, hit);
    }
  }
  return out;
}

/** Rounded to 1e-6 with the largest entry absorbing the rounding, so that they still sum to 1. */
function roundBary(bary: Vec3): Vec3 {
  const micro = bary.map((b) => Math.round(b * 1e6)) as Vec3;
  const largest = micro.indexOf(Math.max(...micro));
  micro[largest]! += 1e6 - (micro[0] + micro[1] + micro[2]);
  return micro.map((m) => m / 1e6) as Vec3;
}

/**
 * The square around the uvs' bounding box, its side UV_RECT_MARGIN × the box's longer edge, shifted
 * (not shrunk) into [0,1]². Worked in millionths, so that the bounds hold exactly.
 */
function faceUvRect(uvs: [number, number][]): Correspondence['faceUvRect'] {
  const extent = (axis: 0 | 1) => {
    const values = uvs.map((uv) => uv[axis]);
    return [Math.min(...values), Math.max(...values)] as const;
  };
  const [[u0, u1], [v0, v1]] = [extent(0), extent(1)];
  const size = Math.round(UV_RECT_MARGIN * Math.max(u1 - u0, v1 - v0) * 1e6);
  if (size > 1e6) throw new Error('the face uvs span more than the texture');
  const start = (lo: number, hi: number) =>
    Math.min(Math.max(Math.round(((lo + hi) / 2) * 1e6 - size / 2), 0), 1e6 - size) / 1e6;
  return { u: start(u0, u1), v: start(v0, v1), size: size / 1e6 };
}

/**
 * Indices into the head vertices behind the ears (z < zEar − BEHIND_EARS_M), thinned to the first in
 * index order per ZERO_GRID_M cell.
 */
function zeroPoints(positions: number[], zEar: number): number[] {
  const cells = new Set<string>();
  const zero: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const p = vertex(positions, i);
    if (p[2] >= zEar - BEHIND_EARS_M) continue;
    const cell = p.map((x) => Math.floor(x / ZERO_GRID_M)).join();
    if (cells.has(cell)) continue;
    cells.add(cell);
    zero.push(i);
  }
  return zero;
}

/**
 * A front orthographic view (image x = base x, image y = −base y) framed on the head: head vertices as
 * 1 px grey dots, the projected landmarks 3 px red, the anchors 5 px blue, on white.
 */
function reviewRender(head: number[], landmarks: Vec3[], anchors: Vec3[]): Review {
  const size = REVIEW_SIZE;
  const data = new Uint8Array(size * size * 4).fill(255);
  const xs = head.filter((_, i) => i % 3 === 0);
  const ys = head.filter((_, i) => i % 3 === 1);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = (0.9 * size) / Math.max(x1 - x0, y1 - y0);
  const plot = (p: Vec3, width: number, rgb: [number, number, number]) => {
    const cx = Math.round(size / 2 + (p[0] - (x0 + x1) / 2) * scale);
    const cy = Math.round(size / 2 - (p[1] - (y0 + y1) / 2) * scale);
    const r = (width - 1) / 2;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) data.set([...rgb, 255], (y * size + x) * 4);
      }
    }
  };
  for (let i = 0; i < head.length / 3; i++) plot(vertex(head, i), 1, [128, 128, 128]);
  for (const p of landmarks) plot(p, 3, [255, 0, 0]);
  for (const p of anchors) plot(p, 5, [0, 0, 255]);
  return { data, width: size, height: size };
}

export function buildCorrespondence(
  doc: GlbDoc,
  face: ReturnType<typeof readCanonicalFace>,
): { data: Correspondence; review: Review } {
  const { primitive } = onlyPrimitive(doc, BODY_MESH);
  const positions = readAccessor(doc, primitive.attributes.POSITION) as Float32Array;
  const texcoords = readAccessor(doc, primitive.attributes.TEXCOORD_0);
  const index = readAccessor(doc, primitive.indices);
  const weights = headWeights(doc, BODY_MESH);
  const vertexCount = positions.length / 3;

  const headVertices = [...weights.keys()].filter((v) => weights[v]! > 0);
  const nose = noseTip(positions, weights);
  const faceTriangles = island(index, vertexCount, nose);

  // Anchors: the iris centres onto the corneas, the nose tip onto the nose tip.
  const canonical = face.positions.slice(0, FACE_LANDMARKS);
  const canonicalNose = canonical.reduce(
    (best, p, i) => (p[2] > canonical[best]![2] ? i : best),
    0,
  );
  const anchors = [...corneas(doc), vertex(positions, nose)];
  const canonicalToBase = umeyama(
    [face.positions[LM.irisR[0]]!, face.positions[LM.irisL[0]]!, canonical[canonicalNose]!],
    anchors,
  );

  // Each landmark's point on the face (seen from the front for the lips and the nose's base, the closest
  // point elsewhere); its uv and position from the rounded barycentrics.
  const aligned = canonical.map((c) => applySimilarity(canonicalToBase, c));
  const viewed = viewProjection(face, aligned, faceTriangles, positions, index);
  const landmarks = aligned.map((p, i) => {
    const closest = viewed.get(i) ?? closestOn(p, faceTriangles, positions, index);
    const triangle = [0, 1, 2].map((k) => index[closest.t + k]!) as [number, number, number];
    const bary = roundBary(closest.bary);
    const mix = (values: ArrayLike<number>, comps: number, component: number) =>
      triangle.reduce((sum, v, k) => sum + bary[k]! * values[comps * v + component]!, 0);
    return {
      triangle,
      bary,
      uv: [round(mix(texcoords, 2, 0), 6), round(mix(texcoords, 2, 1), 6)] as [number, number],
      position: [0, 1, 2].map((a) => round(mix(positions, 3, a), 5)) as Vec3,
    };
  });

  const headPositions = headVertices.flatMap((v) => vertex(positions, v).map((x) => round(x, 5)));
  const zEar = (landmarks[LM.cheekR]!.position[2] + landmarks[LM.cheekL]!.position[2]) / 2;
  const data = correspondenceSchema.parse({
    version: 1,
    bodyVertexCount: vertexCount,
    canonical: canonical.flat(),
    canonicalToBase,
    landmarks,
    triangles: face.triangles.filter((t) => t.every((i) => i < FACE_LANDMARKS)),
    faceUvRect: faceUvRect(landmarks.map((l) => l.uv)),
    head: {
      vertices: headVertices,
      weights: headVertices.map((v) => weights[v]!),
      positions: headPositions,
    },
    zero: zeroPoints(headPositions, zEar),
  } satisfies Correspondence);
  const review = reviewRender(
    headPositions,
    landmarks.map((l) => l.position),
    anchors,
  );
  return { data, review };
}
