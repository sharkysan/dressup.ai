import type { Correspondence } from './correspondence';

/**
 * A head binding (spec §8) ties each vertex of a head-attached mesh (a hairstyle, the base's brows,
 * lashes, eyes, teeth and tongue) to its three nearest base-head vertices with inverse-distance weights,
 * so that the likeness morph can move it with the head (likenessMorph.ts). It ships as a vertex attribute
 * pair: Body vertex indices (UNSIGNED_SHORT VEC4: the first three components; the 4th is 0 and unused,
 * since glTF 2.0 §3.6.2.4 starts every vertex-attribute element on a 4-byte boundary and a VEC3 of shorts
 * is 6 bytes) and their weights (FLOAT VEC3, summing to 1).
 */
export const HEADBIND_IDX = '_HEADBIND_IDX';
export const HEADBIND_W = '_HEADBIND_W';
/** The same attributes on a three.js geometry: GLTFLoader lowercases custom attribute names. */
export const HEADBIND_IDX_ATTR = '_headbind_idx';
export const HEADBIND_W_ATTR = '_headbind_w';
/** Components per vertex: the indices are VEC4 (the 4th 0 and unused), the weights VEC3. */
export const HEADBIND_IDX_SIZE = 4;
export const HEADBIND_W_SIZE = 3;

/** The head vertices each vertex binds to. */
const NEAREST = 3;
/** Added to each distance (m), so that a vertex on a head vertex has a finite weight. */
const SOFTENING_M = 1e-4;
/** _HEADBIND_IDX is UNSIGNED_SHORT. */
const MAX_INDEX = 0xffff;

/**
 * The head binding of each vertex of `positions` (x y z per vertex, in the base's bind space): the three
 * head vertices nearest to it, nearest first, as Body vertex indices, with weights ∝ 1/(d + 0.1 mm),
 * normalised. With `parts` (one entry per vertex), every vertex of a part (id ≥ 0) takes the binding of
 * the part's centroid, so that the part moves rigidly; −1 binds the vertex on its own. Laid out as the
 * attributes are: `idx` four per vertex (the 4th 0), `w` three per vertex.
 */
export function headBinding(
  positions: Float32Array,
  head: Correspondence['head'],
  parts?: Int32Array,
): { idx: Uint16Array; w: Float32Array } {
  const count = positions.length / 3;
  if (head.vertices.length < NEAREST) {
    throw new Error(`headBinding: the head has ${head.vertices.length} vertices, fewer than three`);
  }
  const past = head.vertices.find((v) => v > MAX_INDEX);
  if (past !== undefined) {
    throw new Error(
      `headBinding: head vertex ${past} does not fit an index of ${MAX_INDEX} or less`,
    );
  }
  if (parts && parts.length !== count) {
    throw new Error(`headBinding: ${parts.length} parts for ${count} vertices`);
  }
  const idx = new Uint16Array(HEADBIND_IDX_SIZE * count); // the 4th component stays 0
  const w = new Float32Array(HEADBIND_W_SIZE * count);
  const write = (v: number, binding: Binding) => {
    idx.set(binding.idx, HEADBIND_IDX_SIZE * v);
    w.set(binding.w, HEADBIND_W_SIZE * v);
  };

  const centroids = new Map<number, [number, number, number, number]>(); // part → Σx, Σy, Σz, n
  for (let v = 0; v < count; v++) {
    const part = parts?.[v] ?? -1;
    if (part < 0) {
      write(v, nearest(head, positions[3 * v]!, positions[3 * v + 1]!, positions[3 * v + 2]!));
      continue;
    }
    const sum = centroids.get(part) ?? [0, 0, 0, 0];
    for (let c = 0; c < 3; c++) sum[c]! += positions[3 * v + c]!;
    sum[3]++;
    centroids.set(part, sum);
  }
  const ofPart = new Map(
    [...centroids].map(([part, [x, y, z, n]]) => [part, nearest(head, x / n, y / n, z / n)]),
  );
  for (let v = 0; v < count; v++) {
    const binding = ofPart.get(parts?.[v] ?? -1);
    if (binding) write(v, binding);
  }
  return { idx, w };
}

type Binding = { idx: number[]; w: number[] };

/** The NEAREST head vertices to (x, y, z), nearest first, by brute force, and their weights. */
function nearest(head: Correspondence['head'], x: number, y: number, z: number): Binding {
  const p = head.positions;
  const best = new Array<number>(NEAREST).fill(Infinity); // squared distances, ascending
  const at = new Array<number>(NEAREST).fill(-1);
  for (let h = 0; h < head.vertices.length; h++) {
    const dx = p[3 * h]! - x;
    const dy = p[3 * h + 1]! - y;
    const dz = p[3 * h + 2]! - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= best[NEAREST - 1]!) continue;
    let k = NEAREST - 1;
    for (; k > 0 && d2 < best[k - 1]!; k--) {
      best[k] = best[k - 1]!;
      at[k] = at[k - 1]!;
    }
    best[k] = d2;
    at[k] = h;
  }
  const inverse = best.map((d2) => 1 / (Math.sqrt(d2) + SOFTENING_M));
  const sum = inverse.reduce((a, b) => a + b, 0);
  return { idx: at.map((h) => head.vertices[h]!), w: inverse.map((i) => i / sum) };
}
