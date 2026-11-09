// @vitest-environment node
import { readAccessor } from '../../../tools/glb/accessors';
import { extractHair } from '../../../tools/glb/extractHair';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';

test('extractHair produces a single-joint skin bound to the head and only hair primitives', () => {
  const out = extractHair(makeGlb({ withHair: true }));
  expect(out.json.skins).toHaveLength(1);
  expect(out.json.nodes[out.json.skins[0].joints[0]]).toMatchObject({
    name: 'head',
    extras: { humanBone: 'head' },
  });
  expect(out.json.meshes).toHaveLength(1);
  const mesh = out.json.meshes[0];
  expect(
    mesh.primitives.map((p: { material: number }) => out.json.materials[p.material].name).sort(),
  ).toEqual(['HairBack_00_HAIR', 'Hair_00_HAIR']);
  const joints = readAccessor(out, mesh.primitives[0].attributes.JOINTS_0);
  expect(new Set(Array.from(joints))).toEqual(new Set([0]));
  const weights = readAccessor(out, mesh.primitives[0].attributes.WEIGHTS_0);
  expect(weights[0]).toBe(1);
  expect(weights[1]).toBe(0);
  expect(out.json.extensions?.VRMC_vrm).toBeUndefined();
  expect(out.json.extensions?.VRMC_springBone).toBeUndefined();
  expect(out.json.extensionsUsed).toContain('VRMC_materials_mtoon');
  expect(out.json.extensionsUsed).not.toContain('VRMC_vrm');
  // Only hair images survive.
  expect(out.json.images.map((i: { name: string }) => i.name).sort()).toEqual([
    'HairBack_00',
    'Hair_00',
  ]);
  // Mesh node is skinned and in the scene.
  const meshNode = out.json.nodes.find((n: { mesh?: number }) => n.mesh === 0);
  expect(meshNode.skin).toBe(0);
  // Documented structure: scene → root (0) → { joint (1), mesh node (2) }.
  expect(out.json.scenes[0].nodes).toEqual([0]);
  expect(out.json.nodes[0].children).toContain(out.json.nodes.indexOf(meshNode));
});

test('extractHair throws when the model has no hair', () => {
  expect(() => extractHair(makeGlb({ withHair: false }))).toThrow(/no hair/);
});

test('inverse bind matrix matches the source head joint IBM', () => {
  const src = makeGlb({ withHair: true });
  const srcIbm = readAccessor(src, src.json.skins[0].inverseBindMatrices);
  const headSlot = src.json.skins[0].joints.indexOf(4); // node 4 is J_Bip_C_Head in the fixture
  const expected = Array.from(srcIbm.slice(headSlot * 16, headSlot * 16 + 16));
  const out = extractHair(src);
  expect(Array.from(readAccessor(out, out.json.skins[0].inverseBindMatrices))).toEqual(expected);
});

test('hair textures are greyscale after extraction', () => {
  const out = extractHair(makeGlb({ withHair: true }));
  // Fixture hair colour is [90,50,20]; after luminance neutralisation R=G=B.
  const img = out.json.images.find((i: { name: string }) => i.name === 'Hair_00');
  const bv = out.json.bufferViews[img.bufferView]!;
  const png = out.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const { PNG } = require('pngjs');
  const decoded = PNG.sync.read(Buffer.from(png));
  expect(decoded.data[0]).toBe(decoded.data[1]);
  expect(decoded.data[1]).toBe(decoded.data[2]);
});

test('detects lowercase non-VRoid hair naming (mesh "hair_tail", material "hair")', () => {
  const doc = makeGlb({ withHair: true });
  doc.json.meshes.find((m: { name: string }) => m.name === 'Hair').name = 'hair_tail';
  doc.json.materials.find((m: { name: string }) => m.name === 'Hair_00_HAIR').name = 'hair';
  const out = extractHair(doc);
  expect(out.json.meshes[0].primitives.length).toBe(2);
});
