/**
 * lineup: batch-run the analysis page over a folder of consented photos and build the lineup sheets
 * for the M1 likeness gate (spec §15; protocol in docs/superpowers/m1-lineup-test.md).
 *   tsx tools/lineup.ts --photos DIR --out DIR [--seed 1] [--url http://localhost:4173]
 * Photos never leave the machine; the out dir is git-ignored.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { cli, required } from './cli';
import { assignLineups } from './lineup/assign';

const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

async function main() {
  const args = cli(['photos', 'out', 'seed', 'url'] as const, [] as const, {
    seed: '1',
    url: 'http://localhost:4173',
  });
  const photosDir = required(args.photos, 'photos');
  const outDir = required(args.out, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const photos = fs
    .readdirSync(photosDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  if (photos.length === 0) throw new Error(`no photos in ${photosDir}`);

  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors: Record<string, string> = {};
  const ids: string[] = [];

  for (const file of photos) {
    const id = path.parse(file).name;
    await page.goto(`${args.url}/#analysis`);
    await page.waitForSelector('[data-testid="viewer"][data-status="ready"]', { timeout: 60_000 });
    await page.setInputFiles('[data-testid="photo-input"]', path.join(photosDir, file));
    const status = page.locator('[data-testid="analysis-status"]');
    await page.waitForFunction(
      (el) => ['done', 'error'].includes(el?.getAttribute('data-analysis') ?? ''),
      await status.elementHandle(),
      { timeout: 120_000 },
    );
    if ((await status.getAttribute('data-analysis')) === 'error') {
      errors[id] = (await status.textContent()) ?? 'error';
      console.warn(`${file}: ${errors[id]}`);
      continue;
    }
    await page.evaluate(() => {
      const s = window.__kiss!.store.getState();
      s.setParams({ scene: { ...s.params.scene, framing: 'portrait' } });
    });
    await page.waitForTimeout(2500); // hair load + settle
    const params = await page.evaluate(() => window.__kiss!.store.getState().params);
    fs.writeFileSync(path.join(outDir, `${id}.params.json`), JSON.stringify(params, null, 2));
    await page
      .locator('[data-testid="viewer"] canvas')
      .screenshot({ path: path.join(outDir, `${id}.avatar.png`) });
    ids.push(id);
    console.log(`${file}: ok (hair ${params.hair}, skin ${params.skin})`);
  }
  await browser.close();

  if (ids.length >= 3) {
    const lineups = assignLineups(ids, Number(args.seed));
    for (const [index, lineup] of lineups.entries()) {
      const photoPath = photos.find((f) => path.parse(f).name === lineup.photo)!;
      const sheet = await composeSheet(
        path.join(photosDir, photoPath),
        lineup.options.map((o) => path.join(outDir, `${o}.avatar.png`)),
      );
      fs.writeFileSync(
        path.join(outDir, `sheet-${String(index + 1).padStart(2, '0')}.png`),
        PNG.sync.write(sheet),
      );
    }
    fs.writeFileSync(
      path.join(outDir, 'answers.json'),
      JSON.stringify({ seed: Number(args.seed), lineups }, null, 2),
    );
  }
  const summary = [
    `# Lineup run — ${new Date().toISOString()}`,
    '',
    `Photos analysed: ${ids.length}/${photos.length}`,
    ...Object.entries(errors).map(([id, e]) => `- ${id}: ${e}`),
    '',
    ids.length >= 3
      ? `Sheets: ${ids.length} (answers in answers.json — keep it from the judge)`
      : 'Fewer than 3 successes: no sheets built.',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary + '\n');
  console.log(summary);
}

/** Photo on the left (scaled to 600 px tall), the three avatars on the right, numbered 1–3. */
async function composeSheet(photoPath: string, avatarPaths: string[]): Promise<PNG> {
  const avatars = avatarPaths.map((p) => PNG.sync.read(fs.readFileSync(p)));
  const tile = 300;
  const height = 620;
  const photo = await loadAsPng(photoPath);
  const photoW = Math.round((photo.width / photo.height) * 600);
  const width = 10 + photoW + 20 + avatars.length * (tile + 10) + 10;
  const sheet = new PNG({ width, height });
  sheet.data.fill(235);
  blit(sheet, photo, 10, 10, photoW, 600);
  avatars.forEach((a, i) => {
    const x = 10 + photoW + 20 + i * (tile + 10);
    const h = Math.round((a.height / a.width) * tile);
    blit(sheet, a, x, 10 + Math.max(0, (600 - h) / 2), tile, Math.min(h, 600));
    stamp(sheet, x + 8, 18, i + 1);
  });
  return sheet;
}

async function loadAsPng(file: string): Promise<PNG> {
  const bytes = fs.readFileSync(file);
  if (/\.png$/i.test(file)) return PNG.sync.read(bytes);
  // JPEG photos go through sharp (already a dependency of the asset pipeline); EXIF rotation is honoured.
  return PNG.sync.read(await sharp(bytes).rotate().png().toBuffer());
}

/** Nearest-neighbour blit of `src` scaled into a w×h rectangle at (x, y). */
function blit(dst: PNG, src: PNG, x: number, y: number, w: number, h: number) {
  for (let yy = 0; yy < h; yy++) {
    const sy = Math.min(src.height - 1, Math.floor((yy / h) * src.height));
    for (let xx = 0; xx < w; xx++) {
      const sx = Math.min(src.width - 1, Math.floor((xx / w) * src.width));
      const di = ((y + yy) * dst.width + (x + xx)) * 4;
      const si = (sy * src.width + sx) * 4;
      if (di < 0 || di + 3 >= dst.data.length) continue;
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = 255;
    }
  }
}

/** A crude 5×7 digit stamp so sheets carry a number without a font dependency. */
function stamp(dst: PNG, x: number, y: number, digit: number) {
  const glyphs: Record<number, string[]> = {
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  };
  const g = glyphs[digit] ?? glyphs[1]!;
  const s = 4;
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 5; c++) {
      if (g[r]![c] !== '#') continue;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const i = ((y + r * s + dy) * dst.width + (x + c * s + dx)) * 4;
          dst.data[i] = 20;
          dst.data[i + 1] = 20;
          dst.data[i + 2] = 20;
          dst.data[i + 3] = 255;
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
