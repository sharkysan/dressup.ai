/**
 * build-base: the realistic MakeHuman base (spec §4, §7), built headlessly in Blender, → <out>/base.vrm.
 *   tsx tools/build-base.ts --out public/assets/base
 * Steps: write the naming contract → tools/blender/build_base.py (MPFB human, rig, proxies, T-pose,
 * VRM 1.0 export) → WebP textures → prune → validate against the contract → size budget → atomic write.
 * Needs the Blender toolchain (npm run blender:setup).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contractJson } from '../src/avatar/baseContract';
import { validateBase } from './base/validateBase';
import { writeAtomically } from './base/writeAtomically';
import { cli, human, required } from './cli';
import { readGlb, writeGlb } from './glb/glb';
import { pruneUnused } from './glb/prune';
import { convertImagesToWebp } from './glb/webp';

/** Spec §12 leaves 8 MB for the base and default outfit; the base gets 6 MiB of it. */
export const BASE_BUDGET_BYTES = 6 * 1024 * 1024;

export async function buildBase(opts: {
  out: string;
  budgetBytes?: number;
}): Promise<{ bytes: number; problems: string[] }> {
  const budget = opts.budgetBytes ?? BASE_BUDGET_BYTES;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-base-'));
  try {
    const contract = path.join(work, 'contract.json');
    fs.writeFileSync(contract, JSON.stringify(contractJson(), null, 2));
    const blender = spawnSync(
      'tools/blender/run.sh',
      ['tools/blender/build_base.py', '--', '--contract', contract, '--work', work],
      { stdio: 'inherit' },
    );
    if (blender.error) throw blender.error;
    if (blender.status !== 0) {
      throw new Error(`Blender build failed (${blender.signal ?? `exit ${blender.status}`})`);
    }

    let doc = readGlb(new Uint8Array(fs.readFileSync(path.join(work, 'base.vrm'))));
    // MPFB's PNG textures alone are over the budget; WebP brings them well under it.
    if (!(await convertImagesToWebp(doc))) throw new Error('WebP conversion needs `sharp`');
    doc = pruneUnused(doc);
    // Tasks 4 and 5 add the expressions and body morph targets these checks look for.
    const problems = validateBase(doc, { expressions: false, bodyTargets: false });
    if (problems.length > 0) {
      throw new Error(`base.vrm breaks the naming contract:\n  ${problems.join('\n  ')}`);
    }

    const bytes = writeGlb(doc);
    if (bytes.byteLength > budget) {
      throw new Error(`base.vrm is ${human(bytes.byteLength)}, over its ${human(budget)} budget`);
    }
    fs.mkdirSync(opts.out, { recursive: true });
    writeAtomically(path.join(opts.out, 'base.vrm'), bytes);
    return { bytes: bytes.byteLength, problems };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && /build-base\.(ts|js)$/.test(process.argv[1])) {
  const args = cli(['out'] as const, [] as const);
  const out = required(args.out, 'out');
  buildBase({ out })
    .then((r) => console.log(`wrote ${path.join(out, 'base.vrm')} (${human(r.bytes)})`))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
