/**
 * build-catalog: assets/source/** meta.json sidecars + built files → public/assets/catalog.json.
 *   tsx tools/build-catalog.ts --source assets/source --public public/assets --out public/assets/catalog.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { BASE_URL } from '../src/avatar/baseContract';
import { catalogSchema, type Catalog } from '../src/catalog/catalog';
import { cli, required } from './cli';

type BaseMeta = { id: 'a' | 'b'; name: string; license?: string };
type HairMeta = Omit<Catalog['hair'][number], 'url' | 'thumb'> & { license?: string };

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function buildCatalog(opts: { source: string; publicDir: string; out: string }): Catalog {
  const bases: Catalog['bases'] = [];
  const hair: Catalog['hair'] = [];

  for (const entry of fs.readdirSync(opts.source).sort()) {
    const dir = path.join(opts.source, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (entry.startsWith('base-')) {
      // The one realistic base (tools/build-base.ts); the sidecar still supplies id and name.
      const meta = readJson<BaseMeta>(path.join(dir, 'meta.json'));
      const file = BASE_URL.replace(/^\/assets\//, '');
      if (!fs.existsSync(path.join(opts.publicDir, file))) {
        throw new Error(`base "${meta.id}": built file ${file} is missing — run assets:base`);
      }
      bases.push({ id: meta.id, name: meta.name, url: BASE_URL });
    }
  }

  const hairDir = path.join(opts.source, 'hair');
  if (fs.existsSync(hairDir)) {
    for (const id of fs.readdirSync(hairDir).sort()) {
      const metaFile = path.join(hairDir, id, 'meta.json');
      if (!fs.existsSync(metaFile)) continue;
      const { license: _license, ...meta } = readJson<HairMeta>(metaFile);
      const file = `hair/${meta.id}.glb`;
      if (!fs.existsSync(path.join(opts.publicDir, file))) {
        throw new Error(`hair "${meta.id}": built file ${file} is missing — run assets:hair`);
      }
      hair.push({ ...meta, url: `/assets/${file}` });
    }
  }

  const catalog = catalogSchema.parse({ version: 1, bases, hair });
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
    console.log(
      `wrote ${args.out}: ${catalog.bases.length} base(s), ${catalog.hair.length} hairstyle(s)`,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
