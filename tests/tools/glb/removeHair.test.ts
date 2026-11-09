// @vitest-environment node
import { removeHair } from '../../../tools/glb/removeHair';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';

test('removes the Hair mesh, hair primitives and hair springs but keeps node indices', () => {
  const doc = makeGlb({ withHair: true });
  const headIndexBefore = doc.json.extensions.VRMC_vrm.humanoid.humanBones.head.node;
  const out = removeHair(doc);
  expect(out.json.nodes.length).toBe(doc.json.nodes.length);
  expect(out.json.extensions.VRMC_vrm.humanoid.humanBones.head.node).toBe(headIndexBefore);
  expect(out.json.nodes.find((n: { name: string }) => n.name === 'Hair').mesh).toBeUndefined();
  const body = out.json.meshes.find((m: { name: string }) => m.name === 'Body');
  expect(
    body.primitives.map((p: { material: number }) => out.json.materials[p.material].name),
  ).toEqual(['Body_00_SKIN', 'Tops_01_CLOTH']);
  expect(out.json.extensions.VRMC_springBone.springs).toHaveLength(0);
  expect(out.json.materials.map((m: { name: string }) => m.name)).not.toContain('Hair_00_HAIR');
});

test('is harmless on a model without hair', () => {
  const doc = makeGlb({ withHair: false });
  const out = removeHair(doc);
  expect(out.json.meshes.length).toBe(doc.json.meshes.length);
});

test('VRM 0.x: remaps blend-shape mesh binds, drops hair bone groups and stale mesh annotations', () => {
  const doc = makeGlb({ withHair: true, morphTargets: 2, vrm0: true });
  // Put the Hair mesh before Face to force a renumber: swap meshes 1 and 2 and fix references.
  const out = removeHair(doc);
  const vrm = out.json.extensions.VRM;
  const faceIndex = out.json.meshes.findIndex((m: { name: string }) => m.name === 'Face');
  expect(vrm.blendShapeMaster.blendShapeGroups[0].binds[0].mesh).toBe(faceIndex);
  expect(vrm.secondaryAnimation.boneGroups).toHaveLength(0);
  expect(vrm.firstPerson.meshAnnotations.map((a: { mesh: number }) => a.mesh).sort()).toEqual([
    0, 1,
  ]);
  expect(vrm.materialProperties.map((p: { name: string }) => p.name)).toEqual(
    out.json.materials.map((m: { name: string }) => m.name),
  );
});

test('detects lowercase non-VRoid hair naming', () => {
  const doc = makeGlb({ withHair: true });
  doc.json.meshes.find((m: { name: string }) => m.name === 'Hair').name = 'hair_tail';
  doc.json.materials.find((m: { name: string }) => m.name === 'HairBack_00_HAIR').name =
    'hair_back';
  const out = removeHair(doc);
  expect(out.json.materials.map((m: { name: string }) => m.name)).toEqual([
    'Body_00_SKIN',
    'Tops_01_CLOTH',
    'Face_00_SKIN',
  ]);
});
