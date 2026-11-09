// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGlb } from '../../tools/glb/glb';
import { getImage } from '../../tools/glb/textures';

const NEUTRAL = 'assets/source/base-a/neutral.vrm';
const run = (args: string[]) => execFileSync('npx', ['tsx', ...args], { stdio: 'pipe' });

test('builds a base with 16 face morphs, no hair, textures ≤1024, expressions intact', () => {
  if (!fs.existsSync(NEUTRAL)) return; // dev samples not fetched
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-build-'));
  run(['tools/synth-variants.ts', '--src', NEUTRAL, '--out', path.join(tmp, 'morphs')]);
  const out = path.join(tmp, 'base.vrm');
  run([
    'tools/build-base.ts',
    '--src',
    'assets/source/base-a',
    '--morphs',
    path.join(tmp, 'morphs'),
    '--out',
    out,
  ]);

  const doc = readGlb(new Uint8Array(fs.readFileSync(out)));
  const face = doc.json.meshes.find((m: { name: string }) => m.name === 'Face');
  const ours = face.extras.targetNames.filter((n: string) => /_(min|max)$/.test(n));
  expect(ours).toHaveLength(16);
  expect(doc.json.nodes.find((n: { name: string }) => n.name === 'Hair').mesh).toBeUndefined();
  expect(doc.json.meshes.find((m: { name: string }) => m.name === 'Hair')).toBeUndefined();
  for (const img of doc.json.images) {
    const png = getImage(doc, img.name);
    // PNG IHDR: width/height at bytes 16..24
    const view = new DataView(png.buffer, png.byteOffset);
    expect(Math.max(view.getUint32(16), view.getUint32(20))).toBeLessThanOrEqual(1024);
  }
  expect(doc.json.extensions.VRMC_vrm.expressions.preset.happy.morphTargetBinds[0].index).toBe(3);
  expect(fs.statSync(out).size).toBeLessThan(6 * 1024 * 1024); // PNG build; WebP build is smaller
}, 120_000);

test('fails loudly on a variant with different topology', () => {
  if (!fs.existsSync(NEUTRAL)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-build-bad-'));
  fs.mkdirSync(path.join(tmp, 'morphs'));
  // Seed-san has different topology from the Twist sample.
  const other = 'assets/source/hair/hair_seed_01/source.vrm';
  if (!fs.existsSync(other)) return;
  fs.copyFileSync(other, path.join(tmp, 'morphs', 'faceWidth.max.vrm'));
  expect(() =>
    run([
      'tools/build-base.ts',
      '--src',
      'assets/source/base-a',
      '--morphs',
      path.join(tmp, 'morphs'),
      '--out',
      path.join(tmp, 'x.vrm'),
    ]),
  ).toThrow();
}, 120_000);
