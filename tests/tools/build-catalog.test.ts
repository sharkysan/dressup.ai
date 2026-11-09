// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE_URL } from '../../src/avatar/baseContract';
import { catalogSchema } from '../../src/catalog/catalog';
import { buildCatalog } from '../../tools/build-catalog';

test('builds a valid catalog from meta.json sidecars and built assets', () => {
  const built = ['public/assets/base/base.vrm', 'public/assets/hair/hair_twist_01.glb'];
  if (!built.every((f) => fs.existsSync(f))) return; // assets not built
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-cat-')), 'catalog.json');
  buildCatalog({ source: 'assets/source', publicDir: 'public/assets', out });
  const catalog = catalogSchema.parse(JSON.parse(fs.readFileSync(out, 'utf8')));
  expect(catalog.bases).toEqual([{ id: 'a', name: 'Base A (dev placeholder)', url: BASE_URL }]);
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

test('fails naming the base when base.vrm is not built', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-cat-nobase-'));
  fs.mkdirSync(path.join(tmp, 'source', 'base-a'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'public'));
  fs.writeFileSync(
    path.join(tmp, 'source', 'base-a', 'meta.json'),
    JSON.stringify({ id: 'a', name: 'Base A' }),
  );
  const build = () =>
    buildCatalog({
      source: path.join(tmp, 'source'),
      publicDir: path.join(tmp, 'public'),
      out: path.join(tmp, 'catalog.json'),
    });
  expect(build).toThrow(/base "a".*base\/base\.vrm/);
  fs.mkdirSync(path.join(tmp, 'public', 'base'));
  fs.writeFileSync(path.join(tmp, 'public', 'base', 'base.vrm'), '');
  expect(build().bases).toEqual([{ id: 'a', name: 'Base A', url: BASE_URL }]);
});
