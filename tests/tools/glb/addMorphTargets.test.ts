// @vitest-environment node
import { readAccessor } from '../../../tools/glb/accessors';
import { addMorphTargets, MorphTopologyError } from '../../../tools/glb/addMorphTargets';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';
import type { GlbDoc } from '../../../tools/glb/types';

function faceMesh(doc: GlbDoc) {
  return doc.json.meshes.find((m: { name: string }) => m.name === 'Face');
}

/** Moves Face vertex 0 by dx along X inside `doc` (in place, same topology). */
function nudgeFace(doc: GlbDoc, dx: number) {
  const acc = doc.json.accessors[faceMesh(doc).primitives[0].attributes.POSITION];
  const bv = doc.json.bufferViews[acc.bufferView]!;
  const view = new DataView(doc.bin.buffer, doc.bin.byteOffset + (bv.byteOffset ?? 0));
  view.setFloat32(0, view.getFloat32(0, true) + dx, true);
}

test('adds POSITION/NORMAL deltas as a named target on every primitive of an affected mesh', () => {
  const base = makeGlb();
  const variant = makeGlb();
  nudgeFace(variant, 0.1);
  const out = addMorphTargets(base, [{ name: 'faceWidth_max', doc: variant }]);
  const face = faceMesh(out);
  expect(face.extras.targetNames.at(-1)).toBe('faceWidth_max');
  for (const p of face.primitives) {
    expect(p.targets.at(-1)).toHaveProperty('POSITION');
    expect(p.targets.at(-1)).toHaveProperty('NORMAL');
  }
  const delta = readAccessor(out, face.primitives[0].targets.at(-1).POSITION);
  expect(delta[0]).toBeCloseTo(0.1);
  expect(delta[1]).toBeCloseTo(0);
  const body = out.json.meshes.find((m: { name: string }) => m.name === 'Body');
  expect(body.primitives[0].targets ?? []).toHaveLength(0);
});

test('preserves existing expression targets and their indices', () => {
  const base = makeGlb({ morphTargets: 3 });
  const variant = makeGlb({ morphTargets: 3 });
  nudgeFace(variant, -0.05);
  const out = addMorphTargets(base, [{ name: 'jawWidth_min', doc: variant }]);
  const face = faceMesh(out);
  expect(face.extras.targetNames.slice(0, 3)).toEqual(faceMesh(base).extras.targetNames);
  expect(face.extras.targetNames[3]).toBe('jawWidth_min');
  expect(face.primitives[0].targets).toHaveLength(4);
});

test('throws MorphTopologyError naming mesh and primitive when vertex counts differ', () => {
  const base = makeGlb();
  const variant = makeGlb();
  variant.json.accessors[faceMesh(variant).primitives[0].attributes.POSITION].count = 3;
  expect(() => addMorphTargets(base, [{ name: 'x_max', doc: variant }])).toThrow(
    MorphTopologyError,
  );
  expect(() => addMorphTargets(base, [{ name: 'x_max', doc: variant }])).toThrow(
    /Face.*primitive 0/,
  );
});

test('an identical variant adds no target anywhere', () => {
  const out = addMorphTargets(makeGlb(), [{ name: 'noop_max', doc: makeGlb() }]);
  for (const m of out.json.meshes)
    for (const p of m.primitives) expect(p.targets ?? []).toHaveLength(0);
});

test('pads missing targetNames so names stay aligned with targets', () => {
  const base = makeGlb({ morphTargets: 2 });
  delete faceMesh(base).extras; // VRoid always writes names, but other tools may not
  const variant = makeGlb({ morphTargets: 2 });
  nudgeFace(variant, 0.02);
  const out = addMorphTargets(base, [{ name: 'noseWidth_max', doc: variant }]);
  const face = faceMesh(out);
  expect(face.extras.targetNames).toHaveLength(face.primitives[0].targets.length);
  expect(face.extras.targetNames.at(-1)).toBe('noseWidth_max');
});
