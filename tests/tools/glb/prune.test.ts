// @vitest-environment node
import { pruneUnused } from '../../../tools/glb/prune';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';

test('drops an unreferenced material, its texture and image, and rebuilds the BIN', () => {
  const doc = makeGlb({ withHair: true });
  const body = doc.json.meshes.find((m: { name: string }) => m.name === 'Body');
  body.primitives = body.primitives.filter(
    (p: { material: number }) => !doc.json.materials[p.material].name.endsWith('_HAIR'),
  );
  const hairNode = doc.json.nodes.find((n: { name: string }) => n.name === 'Hair');
  delete hairNode.mesh;
  doc.json.meshes = doc.json.meshes.filter((m: { name: string }) => m.name !== 'Hair');

  const out = pruneUnused(doc);
  const names = out.json.materials.map((m: { name: string }) => m.name);
  expect(names).not.toContain('HairBack_00_HAIR');
  expect(names).not.toContain('Hair_00_HAIR');
  expect(out.json.images.length).toBe(doc.json.images.length - 2);
  expect(out.bin.byteLength).toBeLessThan(doc.bin.byteLength);
  expect(out.json.extensions.VRMC_vrm.meta.thumbnailImage).toBe(
    out.json.images.findIndex((i: { name: string }) => i.name === 'Thumbnail'),
  );
  expect(out.json.buffers[0]!.byteLength).toBe(out.bin.byteLength);
});

test('keeps every accessor a surviving primitive references and remaps indices', () => {
  const out = pruneUnused(makeGlb({ morphTargets: 2 }));
  for (const m of out.json.meshes) {
    for (const p of m.primitives) {
      for (const a of Object.values(p.attributes))
        expect(out.json.accessors[a as number]).toBeDefined();
      expect(out.json.accessors[p.indices]).toBeDefined();
      for (const t of p.targets ?? [])
        for (const a of Object.values(t)) expect(out.json.accessors[a as number]).toBeDefined();
    }
  }
  for (const s of out.json.skins) expect(out.json.accessors[s.inverseBindMatrices]).toBeDefined();
  for (const t of out.json.textures) expect(out.json.images[t.source]).toBeDefined();
  for (const m of out.json.materials) {
    expect(out.json.textures[m.pbrMetallicRoughness.baseColorTexture.index]).toBeDefined();
    expect(
      out.json.textures[m.extensions.VRMC_materials_mtoon.shadeMultiplyTexture.index],
    ).toBeDefined();
  }
});

test('is a no-op in structure when nothing is unused', () => {
  const doc = makeGlb();
  const out = pruneUnused(doc);
  expect(out.json.materials.length).toBe(doc.json.materials.length);
  expect(out.json.accessors.length).toBe(doc.json.accessors.length);
  expect(out.bin.byteLength).toBe(doc.bin.byteLength);
});

test('VRM 0.x: keeps materialProperties aligned and remaps texture references', () => {
  const doc = makeGlb({ withHair: true, vrm0: true });
  const body = doc.json.meshes.find((m: { name: string }) => m.name === 'Body');
  body.primitives = body.primitives.filter(
    (p: { material: number }) => !doc.json.materials[p.material].name.endsWith('_HAIR'),
  );
  const out = pruneUnused(doc);
  const props = out.json.extensions.VRM.materialProperties;
  expect(props.map((p: { name: string }) => p.name)).toEqual(
    out.json.materials.map((m: { name: string }) => m.name),
  );
  for (const p of props) expect(out.json.textures[p.textureProperties._MainTex]).toBeDefined();
  const thumb = out.json.extensions.VRM.meta.texture;
  expect(out.json.images[out.json.textures[thumb].source].name).toBe('Thumbnail');
});

test('VRM 1.0: remaps expression material binds and drops binds to removed materials', () => {
  const doc = makeGlb({ withHair: true });
  const hairMat = doc.json.materials.findIndex((m: { name: string }) => m.name === 'Hair_00_HAIR');
  const faceMat = doc.json.materials.findIndex((m: { name: string }) => m.name === 'Face_00_SKIN');
  doc.json.extensions.VRMC_vrm.expressions.preset.happy = {
    materialColorBinds: [
      { material: hairMat, type: 'color', targetValue: [1, 0, 0, 1] },
      { material: faceMat, type: 'color', targetValue: [0, 1, 0, 1] },
    ],
    textureTransformBinds: [{ material: faceMat, scale: [1, 1], offset: [0, 0] }],
  };
  // Remove hair so material indices shift.
  const body = doc.json.meshes.find((m: { name: string }) => m.name === 'Body');
  body.primitives = body.primitives.filter(
    (p: { material: number }) => !doc.json.materials[p.material].name.endsWith('_HAIR'),
  );
  delete doc.json.nodes.find((n: { name: string }) => n.name === 'Hair').mesh;
  doc.json.meshes = doc.json.meshes.filter((m: { name: string }) => m.name !== 'Hair');

  const out = pruneUnused(doc);
  const happy = out.json.extensions.VRMC_vrm.expressions.preset.happy;
  const newFace = out.json.materials.findIndex((m: { name: string }) => m.name === 'Face_00_SKIN');
  expect(happy.materialColorBinds).toHaveLength(1);
  expect(happy.materialColorBinds[0].material).toBe(newFace);
  expect(happy.textureTransformBinds[0].material).toBe(newFace);
});

test('remaps EXT_texture_webp.source alongside textures[].source', () => {
  const doc = makeGlb({ withHair: true });
  for (const t of doc.json.textures) t.extensions = { EXT_texture_webp: { source: t.source } };
  const body = doc.json.meshes.find((m: { name: string }) => m.name === 'Body');
  body.primitives = body.primitives.filter(
    (p: { material: number }) => !doc.json.materials[p.material].name.endsWith('_HAIR'),
  );
  const out = pruneUnused(doc);
  for (const t of out.json.textures) expect(t.extensions.EXT_texture_webp.source).toBe(t.source);
});
