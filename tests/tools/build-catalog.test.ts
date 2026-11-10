// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE_META_URL, BASE_URL } from '../../src/avatar/baseContract';
import { catalogSchema } from '../../src/catalog/catalog';
import { buildCatalog } from '../../tools/build-catalog';

function tmpDirs(prefix: string, withBase = true) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(tmp, 'source'));
  fs.mkdirSync(path.join(tmp, 'public'));
  if (withBase) {
    fs.mkdirSync(path.join(tmp, 'public', 'base'));
    fs.writeFileSync(path.join(tmp, 'public', 'base', 'base.vrm'), '');
  }
  const build = () =>
    buildCatalog({
      source: path.join(tmp, 'source'),
      publicDir: path.join(tmp, 'public'),
      out: path.join(tmp, 'catalog.json'),
    });
  return { tmp, build };
}

test('with no hair sources, the catalog has the contract base and no hair', () => {
  const { tmp, build } = tmpDirs('kiss-cat-');
  const catalog = build();
  expect(catalog.base).toEqual({ name: 'MakeHuman base', url: BASE_URL, meta: BASE_META_URL });
  expect(catalog.hair).toEqual([]);
  const written = catalogSchema.parse(
    JSON.parse(fs.readFileSync(path.join(tmp, 'catalog.json'), 'utf8')),
  );
  expect(written).toEqual(catalog);
});

test('fails telling to run assets:base when base.vrm is not built', () => {
  const { build } = tmpDirs('kiss-cat-nobase-', false);
  expect(build).toThrow(/run assets:base/);
});

test('fails naming the id when a hair meta.json has no built asset', () => {
  const { tmp, build } = tmpDirs('kiss-cat-bad-');
  fs.mkdirSync(path.join(tmp, 'source', 'hair', 'hair_ghost'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'source', 'hair', 'hair_ghost', 'meta.json'),
    JSON.stringify({
      id: 'hair_ghost',
      name: 'Ghost',
      tags: { length: 'short', volume: 'low', bangs: false, parting: 'none' },
    }),
  );
  expect(build).toThrow(/hair_ghost/);
});

test('lists a hair sidecar with its built file, without the sidecar licence', () => {
  const { tmp, build } = tmpDirs('kiss-cat-hair-');
  const tags = { length: 'long', volume: 'low', bangs: false, parting: 'center' } as const;
  fs.mkdirSync(path.join(tmp, 'source', 'hair', 'x'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'source', 'hair', 'x', 'meta.json'),
    JSON.stringify({ id: 'x', name: 'X', tags, license: 'CC0-1.0' }),
  );
  fs.mkdirSync(path.join(tmp, 'public', 'hair'));
  fs.writeFileSync(path.join(tmp, 'public', 'hair', 'x.glb'), '');
  expect(build().hair).toEqual([{ id: 'x', name: 'X', url: '/assets/hair/x.glb', tags }]);
  expect(fs.readFileSync(path.join(tmp, 'catalog.json'), 'utf8')).not.toContain('license');
});
