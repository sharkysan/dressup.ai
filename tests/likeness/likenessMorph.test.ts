import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
} from 'three';
import { BODY_MESH, MATERIALS } from '../../src/avatar/baseContract';
import type { Correspondence } from '../../src/likeness/correspondence';
import { HEADBIND_IDX_ATTR, HEADBIND_W_ATTR } from '../../src/likeness/headBinding';
import {
  LIKENESS_TARGET,
  applyLikeness,
  boundOffsets,
  expandHeadOffsets,
} from '../../src/likeness/likenessMorph';

test('expandHeadOffsets puts each head vertex offset at its Body vertex, zero elsewhere', () => {
  const head: Correspondence['head'] = {
    vertices: [1, 3],
    weights: [1, 0.5],
    positions: new Array<number>(6).fill(0),
  };
  const full = expandHeadOffsets(Float32Array.of(1, 2, 3, 4, 5, 6), head, 5);
  expect([...full]).toEqual([0, 0, 0, 1, 2, 3, 0, 0, 0, 4, 5, 6, 0, 0, 0]);
  expect(() => expandHeadOffsets(Float32Array.of(1, 2, 3), head, 5)).toThrow();
  expect(() => expandHeadOffsets(Float32Array.of(1, 2, 3, 4, 5, 6), head, 3)).toThrow();
});

test('boundOffsets is Σ w·offset of the bound vertices', () => {
  const full = Float32Array.of(1, 0, 0, 0, 2, 0, 0, 0, 4);
  const offsets = boundOffsets([0, 1, 2, 2, 2, 2], [0.5, 0.25, 0.25, 1, 0, 0], full);
  expect([...offsets]).toEqual([0.5, 0.5, 1, 0, 0, 4]);
  expect(() => boundOffsets([0, 1, 3], [1, 0, 0], full)).toThrow();
});

/** The Body's four vertices; its offsets below. */
const BODY_VERTICES = 4;
const FULL = Float32Array.of(0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3, 0.01, 0.02, 0.03);
/** FULL with vertices 0..2 moved: the brows, bound to vertex 3 alone, don't change. */
const FULL2 = Float32Array.of(-0.1, 0, 0, 0, -0.2, 0, 0, 0, -0.3, 0.01, 0.02, 0.03);

const vec3s = (count: number, value = 0) => new Float32Array(3 * count).fill(value);

/** A mesh of `count` vertices with morph targets `a` and `b` at influences 0.3 and 0.7. */
function morphed(name: string, count: number, material: string, normals = false): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vec3s(count), 3));
  const target = (n: string, value: number) => {
    const attribute = new Float32BufferAttribute(vec3s(count, value), 3);
    attribute.name = n;
    return attribute;
  };
  geometry.morphAttributes.position = [target('a', 0.5), target('b', 0.25)];
  if (normals) geometry.morphAttributes.normal = [target('a', 0.1), target('b', 0.1)];
  geometry.morphTargetsRelative = true; // as GLTFLoader sets it
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ name: material }));
  mesh.name = name;
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences![0] = 0.3;
  mesh.morphTargetInfluences![1] = 0.7;
  return mesh;
}

function bind(mesh: Mesh, idx: number[], w: number[]): Mesh {
  mesh.geometry.setAttribute(HEADBIND_IDX_ATTR, new BufferAttribute(Uint16Array.from(idx), 3));
  mesh.geometry.setAttribute(HEADBIND_W_ATTR, new BufferAttribute(Float32Array.from(w), 3));
  return mesh;
}

const HAIR_IDX = [0, 1, 2, 3, 3, 3];
const HAIR_W = [0.5, 0.25, 0.25, 1, 0, 0];
const EYES_IDX = [0, 1, 2];
const EYES_W = [...Float32Array.of(0.2, 0.3, 0.5)]; // as the attribute holds them

/**
 * The Body (normal morphs too), a bound hair mesh, bound brows, bound eyes with no morph targets, and a
 * mesh with no binding.
 */
function scene() {
  const body = morphed(BODY_MESH, BODY_VERTICES, MATERIALS.skin, true);
  const hair = bind(morphed('Hair', 2, 'Hair'), HAIR_IDX, HAIR_W);
  const brows = bind(morphed('Brows', 1, MATERIALS.brows), [3, 3, 3], [1, 0, 0]);
  const eyes = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ name: MATERIALS.eyes }));
  eyes.geometry.setAttribute('position', new Float32BufferAttribute(vec3s(1), 3));
  bind(eyes, EYES_IDX, EYES_W);
  const other = morphed('Other', 2, 'Other');
  const root = new Group();
  const head = new Group();
  head.add(hair, brows, eyes);
  root.add(body, head, other);
  return { root, body, hair, brows, eyes, other };
}

const target = (mesh: Mesh, index: number) => [
  ...mesh.geometry.morphAttributes.position![index]!.array,
];

test('applying a likeness appends one "likeness" target at influence 1 and keeps the others', () => {
  const { root, body, hair, brows } = scene();
  applyLikeness(root, FULL);
  for (const mesh of [body, hair, brows]) {
    expect(mesh.geometry.morphAttributes.position, mesh.name).toHaveLength(3);
    expect(mesh.geometry.morphAttributes.position![2]!.name).toBe(LIKENESS_TARGET);
    expect(mesh.morphTargetDictionary).toEqual({ a: 0, b: 1, [LIKENESS_TARGET]: 2 });
    expect(mesh.morphTargetInfluences).toEqual([0.3, 0.7, 1]);
    expect(target(mesh, 0)[0]).toBe(0.5); // the existing targets' data is left alone
  }
  // A zero normal morph where the mesh has normal morphs, and none where it has none.
  expect(body.geometry.morphAttributes.normal).toHaveLength(3);
  expect([...body.geometry.morphAttributes.normal![2]!.array]).toEqual([...vec3s(BODY_VERTICES)]);
  expect(hair.geometry.morphAttributes.normal).toBeUndefined();
});

test('the Body takes the offsets as they are; a bound mesh takes boundOffsets', () => {
  const { root, body, hair, eyes } = scene();
  applyLikeness(root, FULL);
  expect(target(body, 2)).toEqual([...FULL]);
  expect(target(hair, 2)).toEqual([...boundOffsets(HAIR_IDX, HAIR_W, FULL)]);
  // A bound mesh without morph targets gets the likeness as its first.
  expect(target(eyes, 0)).toEqual([...boundOffsets(EYES_IDX, EYES_W, FULL)]);
  expect(eyes.morphTargetDictionary).toEqual({ [LIKENESS_TARGET]: 0 });
  expect(eyes.morphTargetInfluences).toEqual([1]);
  expect(eyes.geometry.morphTargetsRelative).toBe(true);
});

test('a mesh that is neither the Body nor bound is left alone', () => {
  const { root, other } = scene();
  applyLikeness(root, FULL);
  expect(other.geometry.morphAttributes.position).toHaveLength(2);
  expect(other.morphTargetInfluences).toEqual([0.3, 0.7]);
});

test('a root without a Body or brows, an attached hairstyle, takes its bound offsets', () => {
  const { hair } = scene();
  const root = new Group().add(hair);
  applyLikeness(root, FULL);
  expect(target(hair, 2)).toEqual([...boundOffsets(HAIR_IDX, HAIR_W, FULL)]);
  applyLikeness(root, null);
  expect(hair.morphTargetInfluences).toEqual([0.3, 0.7, 0]);
});

test('the brows are hidden while a likeness is applied', () => {
  const { root, brows } = scene();
  applyLikeness(root, FULL);
  expect(brows.visible).toBe(false);
});

test('re-applying updates the target in place and disposes each changed geometry once', () => {
  const { root, body, hair, brows, eyes } = scene();
  applyLikeness(root, FULL);
  const disposed = new Map<Mesh, number>();
  for (const mesh of [body, hair, brows, eyes]) {
    disposed.set(mesh, 0);
    mesh.geometry.addEventListener('dispose', () => disposed.set(mesh, disposed.get(mesh)! + 1));
  }
  applyLikeness(root, FULL2);
  expect(body.geometry.morphAttributes.position).toHaveLength(3);
  expect(hair.geometry.morphAttributes.position).toHaveLength(3);
  expect(eyes.geometry.morphAttributes.position).toHaveLength(1);
  expect(body.morphTargetInfluences).toEqual([0.3, 0.7, 1]);
  expect(target(body, 2)).toEqual([...FULL2]);
  expect(target(hair, 2)).toEqual([...boundOffsets(HAIR_IDX, HAIR_W, FULL2)]);
  expect(target(eyes, 0)).toEqual([...boundOffsets(EYES_IDX, EYES_W, FULL2)]);
  // three.js rebuilds a morph texture only on a target-count change or a dispose.
  expect(disposed.get(body)).toBe(1);
  expect(disposed.get(hair)).toBe(1);
  expect(disposed.get(eyes)).toBe(1);
  expect(disposed.get(brows)).toBe(0); // bound to vertex 3, which didn't move
});

test('null adds nothing to a fresh scene', () => {
  const { root, body, hair, brows, eyes } = scene();
  applyLikeness(root, null);
  for (const mesh of [body, hair, brows]) {
    expect(mesh.geometry.morphAttributes.position).toHaveLength(2);
    expect(mesh.morphTargetDictionary).toEqual({ a: 0, b: 1 });
    expect(mesh.morphTargetInfluences).toEqual([0.3, 0.7]);
  }
  expect(body.geometry.morphAttributes.normal).toHaveLength(2);
  expect(eyes.geometry.morphAttributes.position).toBeUndefined();
  expect(eyes.morphTargetInfluences).toBeUndefined();
  expect(brows.visible).toBe(true);
});

test('null after a likeness sets its influence to 0 and shows the brows', () => {
  const { root, body, hair, brows, eyes } = scene();
  applyLikeness(root, FULL);
  applyLikeness(root, null);
  for (const mesh of [body, hair, brows]) {
    expect(mesh.morphTargetInfluences).toEqual([0.3, 0.7, 0]);
    expect(mesh.geometry.morphAttributes.position).toHaveLength(3);
  }
  expect(eyes.morphTargetInfluences).toEqual([0]);
  expect(brows.visible).toBe(true);
  applyLikeness(root, FULL);
  expect(body.morphTargetInfluences).toEqual([0.3, 0.7, 1]);
  expect(brows.visible).toBe(false);
});

test('a mesh with absolute morph targets is rejected, not mis-morphed, and nothing changes', () => {
  const { root, body, hair } = scene();
  hair.geometry.morphTargetsRelative = false;
  expect(() => applyLikeness(root, FULL)).toThrow(/morphTargetsRelative/);
  expect(body.geometry.morphAttributes.position).toHaveLength(2);
  expect(hair.geometry.morphAttributes.position).toHaveLength(2);
});

test('offsets that do not cover the Body are rejected', () => {
  const { root } = scene();
  expect(() => applyLikeness(root, FULL.subarray(0, 9))).toThrow(/Body/);
});
