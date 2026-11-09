/**
 * build-catalog: assets/source/** hair meta.json sidecars + the built base → public/assets/catalog.json.
 *   tsx tools/build-catalog.ts --source assets/source --public public/assets --out public/assets/catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { BASE_META_URL, BASE_URL } from '../src/avatar/baseContract';
import { catalogSchema, type Catalog } from '../src/catalog/catalog';
import { cli, required } from './cli';

type HairMeta = Omit<Catalog['hair'][number], 'url' | 'thumb'> & { license?: string };

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function buildCatalog(opts: { source: string; publicDir: string; out: string }): Catalog {
  const file = BASE_URL.replace(/^\/assets\//, '');
  if (!fs.existsSync(path.join(opts.publicDir, file))) {
    throw new Error(`base: built file ${file} is missing — run assets:base`);
  }
  const base: Catalog['base'] = { name: 'MakeHuman base', url: BASE_URL, meta: BASE_META_URL };
  const hair: Catalog['hair'] = [];

  const hairDir = path.join(opts.source, 'hair');
  if (fs.existsSync(hairDir)) {
    for (const id of fs.readdirSync(hairDir).sort()) {
      const metaFile = path.join(hairDir, id, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      const { license: _license, ...meta } = readJson<HairMeta>(metaFile);
      const file = `hair/${meta.id}.glb`;
      if (!fs.existsSync(path.join(opts.publicDir, file))) {
        throw new Error(`hair "${meta.id}": built file ${file} is missing — build the hair assets`);
      }
      hair.push({ ...meta, url: `/assets/${file}` });
    }
  }

  const catalog = catalogSchema.parse({ version: 2, base, hair });
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(catalog, null, 2) + '\n');
  return catalog;
}

if (process.argv[1] && /build-catalog\.(ts|js)$/.test(process.argv[1])) {
  const args = cli(['source', 'public', 'out'] as const, [] as const);
  try {
    const catalog = buildCatalog({
      source: required(args.source, 'source'),
      publicDir: required(args.public, 'public'),
      out: required(args.out, 'out'),
    });
    console.log(`wrote ${args.out}: base, ${catalog.hair.length} hairstyle(s)`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
