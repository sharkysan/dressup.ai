// @vitest-environment node
import fs from 'node:fs';
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

test('reads the real sample VRM when present', () => {
  const p = 'assets/source/base-a/neutral.vrm';
  if (!fs.existsSync(p)) return;
  const doc = readGlb(new Uint8Array(fs.readFileSync(p)));
  expect(doc.json.extensionsUsed).toContain('VRMC_vrm');
});

test('rejects compressed inputs the toolkit cannot read', () => {
  const doc = makeGlb();
  doc.json.extensionsRequired = ['KHR_draco_mesh_compression'];
  expect(() => readGlb(writeGlb(doc))).toThrow(/KHR_draco_mesh_compression/);
});
