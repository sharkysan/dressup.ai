import {
  Float32BufferAttribute,
  Mesh,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Object3D,
} from 'three';
import { BODY_MESH, MATERIALS } from '../avatar/baseContract';
import type { Correspondence } from './correspondence';
import {
  HEADBIND_IDX_ATTR,
  HEADBIND_IDX_SIZE,
  HEADBIND_W_ATTR,
  HEADBIND_W_SIZE,
} from './headBinding';

/** The runtime morph target that carries the likeness's head offsets (spec §7). */
export const LIKENESS_TARGET = 'likeness';

/**
 * The head offsets (x y z per entry of `head.vertices`, metres) as offsets of every Body vertex: each at
 * its Body vertex, zero elsewhere.
 */
export function expandHeadOffsets(
  headOffsets: Float32Array,
  head: Correspondence['head'],
  vertexCount: number,
): Float32Array {
  if (headOffsets.length !== 3 * head.vertices.length) {
    throw new Error(
      `expandHeadOffsets: ${headOffsets.length} values for ${head.vertices.length} head vertices`,
    );
  }
  const full = new Float32Array(3 * vertexCount);
  head.vertices.forEach((v, i) => {
    if (v >= vertexCount) {
      throw new Error(
        `expandHeadOffsets: head vertex ${v} is past the ${vertexCount} Body vertices`,
      );
    }
    full.set(headOffsets.subarray(3 * i, 3 * i + 3), 3 * v);
  });
  return full;
}

/**
 * The offsets of a head-bound mesh (headBinding.ts): per vertex, Σ w·offset over its three bound Body
 * vertices, from `full`, the offsets of every Body vertex. `idx` and `w` are laid out as the attributes
 * are: four indices per vertex, of which the first three are read (the 4th is unused), and three weights.
 */
export function boundOffsets(
  idx: ArrayLike<number>,
  w: ArrayLike<number>,
  full: Float32Array,
): Float32Array {
  const count = w.length / HEADBIND_W_SIZE;
  if (!Number.isInteger(count) || idx.length !== HEADBIND_IDX_SIZE * count) {
    throw new Error(
      `boundOffsets: ${idx.length} indices and ${w.length} weights; expected ` +
        `${HEADBIND_IDX_SIZE} and ${HEADBIND_W_SIZE} per vertex`,
    );
  }
  const out = new Float32Array(3 * count);
  for (let v = 0; v < count; v++) {
    for (let k = 0; k < 3; k++) {
      const b = idx[HEADBIND_IDX_SIZE * v + k]!;
      if (3 * b + 2 >= full.length) {
        throw new Error(`boundOffsets: Body vertex ${b} is past the ${full.length / 3} offsets`);
      }
      const weight = w[HEADBIND_W_SIZE * v + k]!;
      for (let c = 0; c < 3; c++) out[3 * v + c]! += weight * full[3 * b + c]!;
    }
  }
  return out;
}

/**
 * Applies a likeness to every mesh under `root` (spec §7): the Body takes `full`, the offsets of every
 * Body vertex (expandHeadOffsets), and a head-bound mesh its boundOffsets, as one extra morph target named
 * LIKENESS_TARGET at influence 1; the brows are hidden, the face texture carrying the photo's own. `null`
 * sets that target's influence to 0 and shows the brows. Works on a root without a Body (an attached
 * hairstyle) and is idempotent.
 *
 * The target is appended to the geometry's morph attributes, the mesh's influences and its dictionary;
 * `mesh.updateMorphTargets()` is never called, as it would reset every influence (body shape,
 * expressions) to 0. Applied again, the target is updated in place, and a geometry whose offsets changed
 * is disposed: three.js rebuilds a mesh's morph texture only when its target count changes or its
 * geometry is disposed. Throws, changing nothing, on offsets that don't cover the Body or on a mesh whose
 * morph targets are absolute.
 */
export function applyLikeness(root: Object3D, full: Float32Array | null): void {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  if (full === null) {
    for (const mesh of meshes) {
      const at = mesh.morphTargetDictionary?.[LIKENESS_TARGET];
      if (at !== undefined) mesh.morphTargetInfluences![at] = 0;
      if (isBrows(mesh)) mesh.visible = true;
    }
    return;
  }
  // Every target is computed and checked before any mesh changes.
  const targets: [Mesh, Float32Array][] = [];
  for (const mesh of meshes) {
    const offsets = likenessOffsets(mesh, full);
    if (!offsets) continue;
    const morph = mesh.geometry.morphAttributes;
    if (morph.position?.length && !mesh.geometry.morphTargetsRelative) {
      throw new Error(
        `applyLikeness: ${mesh.name}'s morph targets are absolute (morphTargetsRelative false), ` +
          'and the likeness target holds offsets',
      );
    }
    targets.push([mesh, offsets]);
  }
  for (const [mesh, offsets] of targets) setLikenessTarget(mesh, offsets);
  for (const mesh of meshes) if (isBrows(mesh)) mesh.visible = false;
}

function isBrows(mesh: Mesh): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((m) => m.name === MATERIALS.brows);
}

/** The mesh's likeness offsets: `full` for the Body, boundOffsets for a head-bound mesh, else null. */
function likenessOffsets(mesh: Mesh, full: Float32Array): Float32Array | null {
  const geometry = mesh.geometry;
  if (mesh.name === BODY_MESH) {
    const count = geometry.getAttribute('position').count;
    if (full.length !== 3 * count) {
      throw new Error(`applyLikeness: ${full.length / 3} offsets for the ${count} Body vertices`);
    }
    return full;
  }
  const idx = geometry.getAttribute(HEADBIND_IDX_ATTR);
  const w = geometry.getAttribute(HEADBIND_W_ATTR);
  if (!idx || !w) return null;
  return boundOffsets(
    packed(mesh, HEADBIND_IDX_ATTR, idx, HEADBIND_IDX_SIZE),
    packed(mesh, HEADBIND_W_ATTR, w, HEADBIND_W_SIZE),
    full,
  );
}

/**
 * A head-binding attribute's values: the indices VEC4 (spec §8: the 4th component pads the element to 4
 * bytes), the weights VEC3. GLTFLoader reads a tightly packed accessor as a plain attribute.
 */
function packed(
  mesh: Mesh,
  name: string,
  attribute: BufferAttribute | InterleavedBufferAttribute,
  itemSize: number,
) {
  const vec = `VEC${itemSize}`;
  if ('isInterleavedBufferAttribute' in attribute) {
    throw new Error(
      `applyLikeness: ${mesh.name}'s ${name} is interleaved; expected a packed ${vec}`,
    );
  }
  if (attribute.itemSize !== itemSize) {
    throw new Error(
      `applyLikeness: ${mesh.name}'s ${name} has itemSize ${attribute.itemSize}; expected ${vec}`,
    );
  }
  return attribute.array;
}

function setLikenessTarget(mesh: Mesh, offsets: Float32Array): void {
  const geometry = mesh.geometry;
  const dictionary = (mesh.morphTargetDictionary ??= {});
  const influences = (mesh.morphTargetInfluences ??= []);
  const at = dictionary[LIKENESS_TARGET];
  if (at !== undefined) {
    const target = geometry.morphAttributes.position![at]!;
    if (!equal(target.array, offsets)) {
      target.array.set(offsets);
      target.needsUpdate = true;
      geometry.dispose();
    }
    influences[at] = 1;
    return;
  }
  const morph = geometry.morphAttributes;
  morph.position ??= [];
  geometry.morphTargetsRelative = true; // a no-op unless the geometry had no morph targets
  const target = new Float32BufferAttribute(offsets, 3);
  target.name = LIKENESS_TARGET;
  // Every other morph attribute (normals, say) needs an entry per target: zero, it changes nothing.
  for (const [key, list] of Object.entries(morph)) {
    if (key === 'position') continue;
    const itemSize = list[0]?.itemSize ?? 3;
    list.push(
      new Float32BufferAttribute(new Float32Array((offsets.length / 3) * itemSize), itemSize),
    );
  }
  dictionary[LIKENESS_TARGET] = morph.position.length;
  influences[morph.position.length] = 1;
  morph.position.push(target);
}

function equal(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
