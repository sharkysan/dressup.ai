// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomically } from '../../../tools/base/writeAtomically';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-atomic-'));

test('writes the content', () => {
  const file = path.join(tmpDir(), 'base.vrm');
  writeAtomically(file, new Uint8Array([1, 2, 3]));
  expect([...fs.readFileSync(file)]).toEqual([1, 2, 3]);
});

test('replaces an existing file', () => {
  const file = path.join(tmpDir(), 'base.vrm');
  fs.writeFileSync(file, new Uint8Array([9, 9]));
  writeAtomically(file, new Uint8Array([4, 5, 6]));
  expect([...fs.readFileSync(file)]).toEqual([4, 5, 6]);
});

test('a failure between the temp write and the rename keeps the old file and leaves no temp file', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'base.vrm');
  fs.writeFileSync(file, new Uint8Array([7, 7, 7]));
  const rename = (from: string) => {
    expect(fs.existsSync(from)).toBe(true); // the new bytes were written to a temp file first
    throw new Error('disk on fire');
  };
  expect(() => writeAtomically(file, new Uint8Array([1, 2, 3]), { rename })).toThrow(
    'disk on fire',
  );
  expect([...fs.readFileSync(file)]).toEqual([7, 7, 7]);
  expect(fs.readdirSync(dir)).toEqual(['base.vrm']);
});
