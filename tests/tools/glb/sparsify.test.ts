// @vitest-environment node
import { appendAccessor, readAccessor } from '../../../tools/glb/accessors';
import { sparsifyMorphTargets } from '../../../tools/glb/sparsify';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';

function withTarget(values: number[]) {
  const doc = makeGlb();
  const face = doc.json.meshes.find((m: { name: string }) => m.name === 'Face');
  face.primitives[0].targets = [
    { POSITION: appendAccessor(doc, new Float32Array(values), 'VEC3', { minMax: true }) },
  ];
  face.extras = { targetNames: ['t'] };
  return doc;
}

test('a mostly-zero target becomes a sparse accessor that reads back identically', () => {
  const dense = [0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0];
  const out = sparsifyMorphTargets(withTarget(dense));
  const face = out.json.meshes.find((m: { name: string }) => m.name === 'Face');
  const acc = out.json.accessors[face.primitives[0].targets[0].POSITION];
  expect(acc.sparse.count).toBe(1);
  expect(acc.bufferView).toBeUndefined();
  expect(acc.count).toBe(4);
  expect(Array.from(readAccessor(out, face.primitives[0].targets[0].POSITION))).toEqual(dense);
});

test('a dense target (most vertices move) is left dense', () => {
  const dense = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0];
  const out = sparsifyMorphTargets(withTarget(dense));
  const face = out.json.meshes.find((m: { name: string }) => m.name === 'Face');
  expect(out.json.accessors[face.primitives[0].targets[0].POSITION].sparse).toBeUndefined();
});

test('an all-zero target becomes sparse with count 0 and no bufferView', () => {
  const out = sparsifyMorphTargets(withTarget([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const face = out.json.meshes.find((m: { name: string }) => m.name === 'Face');
  const acc = out.json.accessors[face.primitives[0].targets[0].POSITION];
  expect(acc.bufferView).toBeUndefined();
  expect(acc.sparse).toBeUndefined();
  expect(Array.from(readAccessor(out, face.primitives[0].targets[0].POSITION))).toEqual(
    new Array(12).fill(0),
  );
});

test('with an epsilon, components within it count as zero and read back as zero', () => {
  const noisy = [7e-7, 0, -7e-7, 0.5, 0, 0, 0, 1e-6, 0, 0, -5e-7, 0];
  const plain = sparsifyMorphTargets(withTarget(noisy));
  const plainFace = plain.json.meshes.find((m: { name: string }) => m.name === 'Face');
  // Default epsilon 0: every noisy vertex counts as moved, so the target stays dense.
  expect(plain.json.accessors[plainFace.primitives[0].targets[0].POSITION].sparse).toBeUndefined();

  const out = sparsifyMorphTargets(withTarget(noisy), { epsilon: 1e-6 });
  const face = out.json.meshes.find((m: { name: string }) => m.name === 'Face');
  const acc = out.json.accessors[face.primitives[0].targets[0].POSITION];
  expect(acc.sparse.count).toBe(1);
  expect(Array.from(readAccessor(out, face.primitives[0].targets[0].POSITION))).toEqual([
    0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  // min/max describe the values as they now read, not the dropped noise.
  expect(acc.min).toEqual([0, 0, 0]);
  expect(acc.max).toEqual([0.5, 0, 0]);
});
