import { MToonMaterial, type VRM } from '@pixiv/three-vrm';
import { act, render } from '@testing-library/react';
import { Bone, BufferGeometry, Group, Matrix4, Skeleton, SkinnedMesh } from 'three';
import { HairModel } from '../../src/avatar/HairModel';
import { loadGlbWithMToon } from '../../src/avatar/loadGlb';
import type { Catalog } from '../../src/catalog/catalog';
import { useAppStore } from '../../src/store/useAppStore';

vi.mock('../../src/avatar/loadGlb', () => ({ loadGlbWithMToon: vi.fn() }));

const catalog: Catalog = {
  version: 2,
  base: { name: 'A', url: '/a.vrm', meta: '/a.json' },
  hair: [
    {
      id: 'hair_x',
      name: 'X',
      url: '/x.glb',
      tags: { length: 'short', volume: 'low', bangs: false, parting: 'none' },
    },
  ],
};

function fakeVrm() {
  const scene = new Group();
  const head = new Bone();
  head.name = 'J_Bip_C_Head';
  scene.add(head);
  return { scene, humanoid: { getRawBoneNode: () => head } } as unknown as VRM;
}

function hairGlb() {
  const bone = new Bone();
  bone.name = 'head';
  bone.userData.humanBone = 'head';
  const material = new MToonMaterial();
  material.name = 'Hair_00_HAIR';
  const mesh = new SkinnedMesh(new BufferGeometry(), material);
  mesh.add(bone);
  mesh.bind(new Skeleton([bone], [new Matrix4()]));
  const root = new Group();
  root.add(mesh);
  return { root, material };
}

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.getState().setCatalog(catalog);
});

test('a colour change while the hairstyle is still loading is applied once it lands', async () => {
  const { root, material } = hairGlb();
  let resolve!: (g: Group) => void;
  vi.mocked(loadGlbWithMToon).mockReturnValue(new Promise<Group>((r) => (resolve = r)));
  const vrm = fakeVrm();

  const view = render(<HairModel vrm={vrm} hairId="hair_x" hairColor="#2b1b12" />);
  view.rerender(<HairModel vrm={vrm} hairId="hair_x" hairColor="#e8c872" />); // picker dragged mid-load
  await act(async () => {
    resolve(root);
    await Promise.resolve();
  });
  expect('#' + material.color.getHexString()).toBe('#e8c872');
});
