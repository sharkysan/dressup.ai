// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHair } from '../../tools/build-hair';
import { readGlb } from '../../tools/glb/glb';

test('builds one head-bound GLB per hair source directory', async () => {
  if (!fs.existsSync('assets/source/hair/hair_twist_01/source.vrm')) return; // dev samples not fetched
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-hair-'));
  const results = await buildHair({ src: 'assets/source/hair', out, maxTexture: 1024, webp: true });
  expect(results.map((r) => r.id)).toEqual(['hair_seed_01', 'hair_twist_01']);
  for (const r of results) {
    const doc = readGlb(new Uint8Array(fs.readFileSync(path.join(out, `${r.id}.glb`))));
    expect(doc.json.skins[0].joints).toHaveLength(1);
    expect(doc.json.nodes[doc.json.skins[0].joints[0]]).toMatchObject({
      name: 'head',
      extras: { humanBone: 'head' },
    });
    expect(r.bytes).toBeLessThan(2 * 1024 * 1024);
    for (const img of doc.json.images) expect(img.mimeType).toBe('image/webp');
  }
}, 120_000);
