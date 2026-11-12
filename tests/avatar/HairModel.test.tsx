import type { VRM } from '@pixiv/three-vrm';
import { act, render } from '@testing-library/react';
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { HairModel } from '../../src/avatar/HairModel';
import { loadGlb } from '../../src/avatar/loadGlb';
import type { Catalog } from '../../src/catalog/catalog';
import { defaultParams } from '../../src/catalog/params';
import { HEADBIND_IDX_ATTR, HEADBIND_W_ATTR } from '../../src/likeness/headBinding';
import { LIKENESS_TARGET, boundOffsets } from '../../src/likeness/likenessMorph';
import { useAppStore } from '../../src/store/useAppStore';

vi.mock('../../src/avatar/loadGlb', () => ({ loadGlb: vi.fn() }));

const entry = (id: string) => ({
  id,
  name: id,
  url: `/${id}.glb`,
  tags: {
    length: 'short' as const,
    volume: 'low' as const,
    bangs: false,
    parting: 'none' as const,
  },
});
const catalog: Catalog = {
  version: 2,
  base: { name: 'A', url: '/a.vrm', meta: '/a.json' },
  hair: [entry('a'), entry('b')],
};

function fakeVrm() {
  const scene = new Group();
  const head = new Bone();
  head.name = 'head';
  scene.add(head);
  return { scene, humanoid: { getRawBoneNode: () => head } } as unknown as VRM;
}

function hairGlb() {
  const bone = new Bone();
  bone.name = 'head';
  const material = new MeshStandardMaterial({ alphaTest: 0.5 });
  material.name = 'Hair';
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
  geometry.morphTargetsRelative = true;
  // Head binding: hair vertex v follows Body vertices v and v + 1 half each.
  geometry.setAttribute(
    HEADBIND_IDX_ATTR,
    new BufferAttribute(new Uint16Array([0, 1, 0, 0, 1, 2, 0, 0, 2, 3, 0, 0]), 4),
  );
  geometry.setAttribute(
    HEADBIND_W_ATTR,
    new BufferAttribute(new Float32Array([0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0]), 3),
  );
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = 'Hair';
  mesh.morphTargetDictionary = { body_weight_max: 0 };
  mesh.morphTargetInfluences = [0];
  mesh.add(bone);
  mesh.bind(new Skeleton([bone], [new Matrix4()]));
  const root = new Group();
  root.add(mesh);
  return { root, mesh, material, geometry };
}

const flush = () => act(async () => void (await Promise.resolve()));

/** Offsets of a 4-vertex Body (expandHeadOffsets' output), and a second, different set. */
const FULL = Float32Array.from({ length: 12 }, (_, i) => 0.001 * (i + 1));
const FULL2 = Float32Array.from({ length: 12 }, (_, i) => -0.002 * (i + 1));

/** The hair mesh's likeness offsets and influence, or null without the target. */
function likenessOf(mesh: SkinnedMesh) {
  const at = mesh.morphTargetDictionary?.[LIKENESS_TARGET];
  if (at === undefined) return null;
  const offsets = mesh.geometry.morphAttributes.position![at]!.array as Float32Array;
  return { at, offsets: Array.from(offsets), influence: mesh.morphTargetInfluences![at] };
}

function expected(mesh: SkinnedMesh, full: Float32Array) {
  const idx = mesh.geometry.getAttribute(HEADBIND_IDX_ATTR).array;
  const w = mesh.geometry.getAttribute(HEADBIND_W_ATTR).array;
  return Array.from(boundOffsets(idx, w, full));
}

beforeEach(() => {
  vi.mocked(loadGlb).mockReset();
  useAppStore.getState().reset();
  useAppStore.getState().setCatalog(catalog);
});

test('attaches with the current colour and body, then reports the id', async () => {
  const glb = hairGlb();
  vi.mocked(loadGlb).mockResolvedValue(glb.root);
  useAppStore.getState().setParams({ body: { ...defaultParams.body, weight: 1 } });
  const vrm = fakeVrm();
  render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />);
  await flush();
  expect(glb.mesh.parent).toBe(vrm.scene);
  expect('#' + glb.material.color.getHexString()).toBe('#aa3311');
  expect(glb.material.alphaToCoverage).toBe(true);
  expect(glb.mesh.morphTargetInfluences![0]).toBe(1);
  expect(useAppStore.getState().attachedHair).toBe('a');
});

test('a colour change keeps the mesh and does not reload', async () => {
  const glb = hairGlb();
  vi.mocked(loadGlb).mockResolvedValue(glb.root);
  const vrm = fakeVrm();
  const view = render(
    <HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />,
  );
  await flush();
  view.rerender(<HairModel vrm={vrm} hairId="a" hairColor="#11aa33" likenessOffsets={null} />);
  await flush();
  expect(loadGlb).toHaveBeenCalledTimes(1);
  expect(glb.mesh.parent).toBe(vrm.scene);
  expect('#' + glb.material.color.getHexString()).toBe('#11aa33');
});

test('switching a -> b before a loads leaves only b, and disposes a', async () => {
  const a = hairGlb();
  const b = hairGlb();
  let resolveA!: (g: Group) => void;
  vi.mocked(loadGlb)
    .mockReturnValueOnce(new Promise<Group>((r) => (resolveA = r)))
    .mockResolvedValueOnce(b.root);
  const disposeA = vi.spyOn(a.geometry, 'dispose');
  const vrm = fakeVrm();
  const view = render(
    <HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />,
  );
  view.rerender(<HairModel vrm={vrm} hairId="b" hairColor="#aa3311" likenessOffsets={null} />);
  await flush();
  await act(async () => {
    resolveA(a.root);
    await Promise.resolve();
  });
  expect(b.mesh.parent).toBe(vrm.scene);
  expect(a.mesh.parent).not.toBe(vrm.scene);
  expect(vrm.scene.children.filter((c) => c instanceof SkinnedMesh)).toEqual([b.mesh]);
  expect(disposeA).toHaveBeenCalled();
  expect(useAppStore.getState().attachedHair).toBe('b');
});

test('a failing load adds nothing, warns once naming the id, and stays none', async () => {
  vi.mocked(loadGlb).mockRejectedValue(new Error('boom'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const vrm = fakeVrm();
  render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />);
  await flush();
  expect(vrm.scene.children.some((c) => c instanceof SkinnedMesh)).toBe(false);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]![0])).toContain('"a"');
  expect(useAppStore.getState().attachedHair).toBe('none');
  warn.mockRestore();
});

test("'none' detaches the hair", async () => {
  const glb = hairGlb();
  vi.mocked(loadGlb).mockResolvedValue(glb.root);
  const vrm = fakeVrm();
  const view = render(
    <HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />,
  );
  await flush();
  view.rerender(<HairModel vrm={vrm} hairId="none" hairColor="#aa3311" likenessOffsets={null} />);
  await flush();
  expect(glb.mesh.parent).toBeNull();
  expect(useAppStore.getState().attachedHair).toBe('none');
});

test('a hair attached after the likeness gets the likeness morph, beside its body morphs', async () => {
  const glb = hairGlb();
  vi.mocked(loadGlb).mockResolvedValue(glb.root);
  useAppStore.getState().setParams({ body: { ...defaultParams.body, weight: 1 } });
  const vrm = fakeVrm();
  render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={FULL} />);
  await flush();
  expect(glb.mesh.parent).toBe(vrm.scene);
  // Appended after the body target, which keeps its influence.
  expect(likenessOf(glb.mesh)).toEqual({ at: 1, offsets: expected(glb.mesh, FULL), influence: 1 });
  expect(glb.mesh.morphTargetInfluences![0]).toBe(1);
  expect(useAppStore.getState().attachedHair).toBe('a');
});

test('a likeness that arrives while the hair loads is applied on attach', async () => {
  const glb = hairGlb();
  let resolve!: (g: Group) => void;
  vi.mocked(loadGlb).mockReturnValue(new Promise<Group>((r) => (resolve = r)));
  const vrm = fakeVrm();
  const view = render(
    <HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />,
  );
  view.rerender(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={FULL} />);
  await act(async () => {
    resolve(glb.root);
    await Promise.resolve();
  });
  expect(likenessOf(glb.mesh)).toEqual({ at: 1, offsets: expected(glb.mesh, FULL), influence: 1 });
});

test('the attached hair follows a new likeness, and null turns its morph off', async () => {
  const glb = hairGlb();
  vi.mocked(loadGlb).mockResolvedValue(glb.root);
  const vrm = fakeVrm();
  const view = render(
    <HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={FULL} />,
  );
  await flush();
  view.rerender(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={FULL2} />);
  expect(likenessOf(glb.mesh)).toEqual({ at: 1, offsets: expected(glb.mesh, FULL2), influence: 1 });
  view.rerender(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={null} />);
  expect(likenessOf(glb.mesh)?.influence).toBe(0);
  expect(loadGlb).toHaveBeenCalledTimes(1);
});

test('switching hairstyle with a likeness applied: the new hair carries it', async () => {
  const a = hairGlb();
  const b = hairGlb();
  vi.mocked(loadGlb).mockResolvedValueOnce(a.root).mockResolvedValueOnce(b.root);
  const vrm = fakeVrm();
  const view = render(
    <HairModel vrm={vrm} hairId="a" hairColor="#aa3311" likenessOffsets={FULL} />,
  );
  await flush();
  view.rerender(<HairModel vrm={vrm} hairId="b" hairColor="#aa3311" likenessOffsets={FULL} />);
  await flush();
  expect(b.mesh.parent).toBe(vrm.scene);
  expect(likenessOf(b.mesh)).toEqual({ at: 1, offsets: expected(b.mesh, FULL), influence: 1 });
});
