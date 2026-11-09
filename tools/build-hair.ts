/**
 * build-hair: every assets/source/hair/<id>/source.vrm → public/assets/hair/<id>.glb (spec §7/§8).
 *   tsx tools/build-hair.ts --src assets/source/hair --out public/assets/hair [--max-texture 1024]
 */
import fs from 'node:fs';
import path from 'node:path';
import { cli, human, required } from './cli';
import { extractHair } from './glb/extractHair';
import { readGlb, writeGlb } from './glb/glb';
import { pruneUnused } from './glb/prune';
import { convertImagesToWebp } from './glb/webp';

export async function buildHair(opts: {
  src: string;
  out: string;
  maxTexture: number;
  webp: boolean;
}): Promise<{ id: string; bytes: number }[]> {
  if (!fs.existsSync(opts.src)) return [];
  const results: { id: string; bytes: number }[] = [];
  for (const id of fs.readdirSync(opts.src).sort()) {
    const dir = path.join(opts.src, id);
    const source = path.join(dir, 'source.vrm');
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(source)) continue;
    const doc = readGlb(new Uint8Array(fs.readFileSync(source)));
    let hair = extractHair(doc, { maxTexture: opts.maxTexture });
    if (opts.webp) {
      await convertImagesToWebp(hair);
      hair = pruneUnused(hair); // drop the orphaned PNG bufferViews
    }
    const bytes = writeGlb(hair);
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, `${id}.glb`), bytes);
    results.push({ id, bytes: bytes.byteLength });
  }
  return results;
}

if (process.argv[1] && /build-hair\.(ts|js)$/.test(process.argv[1])) {
  const args = cli(['src', 'out', 'max-texture'] as const, ['webp'] as const, {
    'max-texture': '1024',
  });
  buildHair({
    src: required(args.src, 'src'),
    out: required(args.out, 'out'),
    maxTexture: Number(args['max-texture']),
    webp: args.webp,
  })
    .then((results) => {
      for (const r of results)
        console.log(`wrote ${path.join(args.out!, `${r.id}.glb`)} (${human(r.bytes)})`);
      if (results.length === 0) console.log('no hair sources found');
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
