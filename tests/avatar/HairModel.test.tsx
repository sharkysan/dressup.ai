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
  render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" />);
  await flush();
  expect(glb.mesh.parent).toBe(vrm.scene);
  expect('#' + glb.material.color.getHexString()).toBe('#aa3311');
  expect(glb.material.alphaToCoverage).toBe(false);
  expect(glb.mesh.morphTargetInfluences![0]).toBe(1);
  expect(useAppStore.getState().attachedHair).toBe('a');
});

test('a colour change keeps the mesh and does not reload', async () => {
  const glb = hairGlb();
  vi.mocked(loadGlb).mockResolvedValue(glb.root);
  const vrm = fakeVrm();
  const view = render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" />);
  await flush();
  view.rerender(<HairModel vrm={vrm} hairId="a" hairColor="#11aa33" />);
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
  const view = render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" />);
  view.rerender(<HairModel vrm={vrm} hairId="b" hairColor="#aa3311" />);
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
  render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" />);
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
  const view = render(<HairModel vrm={vrm} hairId="a" hairColor="#aa3311" />);
  await flush();
  view.rerender(<HairModel vrm={vrm} hairId="none" hairColor="#aa3311" />);
  await flush();
  expect(glb.mesh.parent).toBeNull();
  expect(useAppStore.getState().attachedHair).toBe('none');
});
