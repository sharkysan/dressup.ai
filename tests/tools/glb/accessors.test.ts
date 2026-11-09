// @vitest-environment node
import { appendAccessor, readAccessor } from '../../../tools/glb/accessors';
import { appendBytes, makeGlb } from '../../../tools/test-fixtures/makeGlb';

test('appendAccessor then readAccessor returns the same floats', () => {
  const doc = makeGlb();
  const data = new Float32Array([1, 2, 3, 4, 5, 6]);
  const idx = appendAccessor(doc, data, 'VEC3', { minMax: true });
  expect(doc.json.accessors[idx]).toMatchObject({
    type: 'VEC3',
    componentType: 5126,
    count: 2,
    min: [1, 2, 3],
    max: [4, 5, 6],
  });
  expect(Array.from(readAccessor(doc, idx))).toEqual([1, 2, 3, 4, 5, 6]);
  expect(doc.bin.byteLength % 4).toBe(0);
});

test('readAccessor de-strides interleaved data', () => {
  const doc = makeGlb();
  // Two VEC3 floats with a 4-byte pad each → byteStride 16.
  const interleaved = new Float32Array([1, 2, 3, 999, 4, 5, 6, 999]);
  const bv = appendBytes(doc, new Uint8Array(interleaved.buffer));
  doc.json.bufferViews[bv]!.byteStride = 16;
  doc.json.accessors.push({
    bufferView: bv,
    byteOffset: 0,
    componentType: 5126,
    count: 2,
    type: 'VEC3',
  });
  const idx = doc.json.accessors.length - 1;
  expect(Array.from(readAccessor(doc, idx))).toEqual([1, 2, 3, 4, 5, 6]);
});

test('readAccessor returns Uint16Array for unsigned short components', () => {
  const doc = makeGlb();
  const idx = appendAccessor(doc, new Uint16Array([7, 8, 9]), 'SCALAR');
  const out = readAccessor(doc, idx);
  expect(out).toBeInstanceOf(Uint16Array);
  expect(Array.from(out)).toEqual([7, 8, 9]);
});
