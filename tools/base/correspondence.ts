/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * buildCorrespondence: how MediaPipe's face maps onto the exported base (spec §12), → correspondence.json.
 * Everything is measured in the Body's bind space (metres, +Y up, facing +Z, +X the subject's left), and
 * vertex indices are glTF vertex indices of the shipped Body primitive.
 * Steps: the head vertices (head weight > 0) → the face island (the Body's UV island around the nose
 * tip) → the canonical face aligned to the base by a similarity fitted to three anchors (the corneas and
 * the nose tip) → each canonical landmark projected to its closest point on the face island → the face
 * mesh's triangles, the face texture's UV square and the head fit's zero points → validated against the
 * schema. Also renders a front view for review.
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
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

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

  // Each landmark's closest point on the face; its uv and position from the rounded barycentrics.
  const landmarks = canonical.map((c) => {
    const closest = closestOn(applySimilarity(canonicalToBase, c), faceTriangles, positions, index);
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
