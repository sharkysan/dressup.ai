import type { VRM } from '@pixiv/three-vrm';
import {
  Bone,
  BufferGeometry,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { AttachError, attachSkinned } from '../../src/avatar/skinnedAttach';

function avatar() {
  const scene = new Group();
  const hips = new Bone();
  hips.name = 'J_Bip_C_Hips';
  const head = new Bone();
  head.name = 'J_Bip_C_Head';
  hips.add(head);
  scene.add(hips);
  const humanoid = { getRawBoneNode: (name: string) => (name === 'head' ? head : null) };
  return { vrm: { scene, humanoid } as unknown as VRM, scene, head };
}

function attachment(boneName: string, humanBone?: string) {
  const bone = new Bone();
  bone.name = boneName;
  if (humanBone) bone.userData.humanBone = humanBone;
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new Skeleton([bone], [new Matrix4()]));
  const root = new Group();
  root.add(mesh);
  return { root, mesh };
}

test('rebinds to the avatar bone with the same name and adds the mesh to vrm.scene', () => {
  const { vrm, scene, head } = avatar();
  const { root, mesh } = attachment('J_Bip_C_Head');
  const handle = attachSkinned(vrm, root);
  expect(mesh.skeleton.bones[0]).toBe(head);
  expect(mesh.parent).toBe(scene);
  handle.detach();
  expect(mesh.parent).toBeNull();
});

test('binds by humanoid role when the bone carries userData.humanBone', () => {
  const { vrm, head } = avatar();
  const { root, mesh } = attachment('head', 'head');
  attachSkinned(vrm, root);
  expect(mesh.skeleton.bones[0]).toBe(head);
});

test('throws AttachError listing missing bones and attaches nothing', () => {
  const { vrm, scene } = avatar();
  const { root, mesh } = attachment('J_Nope');
  expect(() => attachSkinned(vrm, root)).toThrow(AttachError);
  try {
    attachSkinned(vrm, root);
  } catch (e) {
    expect((e as AttachError).missingBones).toEqual(['J_Nope']);
  }
  expect(scene.children).not.toContain(mesh);
});
