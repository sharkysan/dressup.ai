import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes `bytes` to `file` via a temp file in the same directory and a rename, so readers (the dev
 * server, a running test) never see a half-written file and a failed build keeps the previous one.
 * `rename` is injectable for tests.
 */
export function writeAtomically(
  file: string,
  bytes: Uint8Array,
  { rename = fs.renameSync }: { rename?: (from: string, to: string) => void } = {},
): void {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, bytes);
    rename(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
