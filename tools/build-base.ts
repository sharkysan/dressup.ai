/**
 * build-base: the realistic MakeHuman base (spec §4, §7), built headlessly in Blender, → <out>/base.vrm
 * and <out>/base.json (height metadata, baseMetaSchema).
 *   tsx tools/build-base.ts --out public/assets/base
 * Steps: write the naming contract → tools/blender/build_base.py (MPFB human, rig, proxies, T-pose,
 * expressions, body-shape targets, VRM 1.0 export, base.json) → sparse morph targets → WebP textures →
 * prune → validate against the contract, and base.json against its schema → size budget → atomic writes.
 * Needs the Blender toolchain (npm run blender:setup).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseMetaSchema, contractJson } from '../src/avatar/baseContract';
import { validateBase } from './base/validateBase';
import { writeAtomically } from './base/writeAtomically';
import { cli, human, required } from './cli';
import { readGlb, writeGlb } from './glb/glb';
import { pruneUnused } from './glb/prune';
import { sparsifyMorphTargets } from './glb/sparsify';
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
    // The exporter writes every morph target dense, though most move only part of a mesh. Within 1e-6
    // counts as still: the proxies' Surface Deform capture leaves up to ~7e-7 m on vertices that don't move.
    doc = sparsifyMorphTargets(doc, { epsilon: 1e-6 });
    // MPFB's PNG textures alone are over the budget; WebP brings them well under it.
    if (!(await convertImagesToWebp(doc))) throw new Error('WebP conversion needs `sharp`');
    doc = pruneUnused(doc);
    const problems = validateBase(doc);
    if (problems.length > 0) {
      throw new Error(`base.vrm breaks the naming contract:\n  ${problems.join('\n  ')}`);
    }
    const meta = fs.readFileSync(path.join(work, 'base.json'));
    const parsed = baseMetaSchema.safeParse(JSON.parse(meta.toString('utf8')));
    if (!parsed.success) throw new Error(`base.json is invalid: ${parsed.error.message}`);

    const bytes = writeGlb(doc);
    if (bytes.byteLength > budget) {
      throw new Error(`base.vrm is ${human(bytes.byteLength)}, over its ${human(budget)} budget`);
    }
    fs.mkdirSync(opts.out, { recursive: true });
    writeAtomically(path.join(opts.out, 'base.vrm'), bytes);
    writeAtomically(path.join(opts.out, 'base.json'), meta);
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
