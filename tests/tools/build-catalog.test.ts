// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalogSchema } from '../../src/catalog/catalog';
import { buildCatalog } from '../../tools/build-catalog';

test('builds a valid catalog from meta.json sidecars and built assets', () => {
  if (!fs.existsSync('public/assets/hair/hair_twist_01.glb')) return; // assets not built
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-cat-')), 'catalog.json');
  buildCatalog({ source: 'assets/source', publicDir: 'public/assets', out });
  const catalog = catalogSchema.parse(JSON.parse(fs.readFileSync(out, 'utf8')));
  expect(catalog.bases).toEqual([
    { id: 'a', name: 'Base A (dev placeholder)', url: '/assets/avatars/base-a.vrm' },
  ]);
  expect(catalog.hair.map((h) => h.id)).toEqual(['hair_seed_01', 'hair_twist_01']);
  expect(catalog.hair[0]).not.toHaveProperty('license');
});

test('fails naming the id when a meta.json has no built asset', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-cat-bad-'));
  fs.mkdirSync(path.join(tmp, 'source', 'hair', 'hair_ghost'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'public', 'hair'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'source', 'hair', 'hair_ghost', 'meta.json'),
    JSON.stringify({
      id: 'hair_ghost',
      name: 'Ghost',
      base: 'a',
      tags: { length: 'short', volume: 'low', bangs: false, parting: 'none' },
    }),
  );
  expect(() =>
    buildCatalog({
      source: path.join(tmp, 'source'),
      publicDir: path.join(tmp, 'public'),
      out: path.join(tmp, 'catalog.json'),
    }),
  ).toThrow(/hair_ghost/);
});
