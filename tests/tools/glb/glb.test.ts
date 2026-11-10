// @vitest-environment node
import { readGlb, writeGlb } from '../../../tools/glb/glb';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';

test('round-trips a GLB in structure', () => {
  const doc = makeGlb();
  const bytes = writeGlb(doc);
  expect(bytes.byteLength % 4).toBe(0);
  const back = readGlb(bytes);
  expect(back.json).toEqual(doc.json);
  expect(back.bin.byteLength).toBe(doc.json.buffers[0]!.byteLength);
  expect(Buffer.from(back.bin).equals(Buffer.from(doc.bin))).toBe(true);
});

test('rejects a non-GLB buffer', () => {
  expect(() => readGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(
    /not a GLB/,
  );
});

test('rejects compressed inputs the toolkit cannot read', () => {
  const doc = makeGlb();
  doc.json.extensionsRequired = ['KHR_draco_mesh_compression'];
  expect(() => readGlb(writeGlb(doc))).toThrow(/KHR_draco_mesh_compression/);
});
