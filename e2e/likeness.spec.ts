import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { defaultParams } from '../src/catalog/params';
import {
  expectGrounded,
  hairAttached,
  openAvatar,
  portrait,
  setBody,
  setParams,
  shot,
} from './helpers/avatar';
import { diffPixels } from './helpers/png';

/** A synthetic likeness: a face texture of one colour (null: transparent) and head offsets. */
type Synthetic = {
  color: string | null;
  /**
   * Metres along +x (the subject's left) on the subject-left half of the head, times each vertex's head
   * weight as fitHead scales its offsets, so that it fades down the neck; 0 leaves the head still.
   */
  leftHalfX: number;
};

/**
 * Puts a synthetic likeness on the avatar through the dev hook — a 1024² PNG face texture, offsets for
 * every head vertex of the shipped correspondence, sourceSkin the current skin — and waits until the
 * Body shows it.
 */
async function setLikeness(page: Page, likeness: Synthetic) {
  await page.evaluate(async ({ color, leftHalfX }) => {
    const response = await fetch('/assets/base/correspondence.json');
    const { head } = (await response.json()) as {
      head: { positions: number[]; weights: number[] };
    };
    const headOffsets = new Float32Array(head.positions.length);
    for (let i = 0; i < headOffsets.length; i += 3) {
      if (head.positions[i]! > 0) headOffsets[i] = leftHalfX * head.weights[i / 3]!;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    if (color) {
      const context = canvas.getContext('2d')!;
      context.fillStyle = color;
      context.fillRect(0, 0, 1024, 1024);
    }
    const faceTexture = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob gave no blob'))),
        'image/png',
      ),
    );
    const kiss = window.__kiss!;
    kiss.likeness.set({
      version: 1,
      faceTexture,
      headOffsets,
      sourceSkin: kiss.store.getState().params.skin,
    });
  }, likeness);
  await expect
    .poll(() => page.evaluate(() => window.__kiss!.likeness.status().meshes), { timeout: 10_000 })
    .toContain('Body');
}

async function clearLikeness(page: Page) {
  await page.evaluate(() => window.__kiss!.likeness.set(null));
  await expect
    .poll(() => page.evaluate(() => window.__kiss!.likeness.status()), { timeout: 10_000 })
    .toEqual({ meshes: [], browsVisible: true });
}

const status = (page: Page) => page.evaluate(() => window.__kiss!.likeness.status());

/**
 * The face centre in canvas CSS pixels: where the head bone projects. It sits inside the head at about
 * the height of the nose, so from the front it lands on the nose, clear of the eyes, brows and fringe.
 */
async function faceCentre(page: Page) {
  const at = await page.evaluate(() => window.__kiss!.nodeScreenPoint('head'));
  expect(at).not.toBeNull();
  return at!;
}

/** Mean RGB of the shot over a patch 17 CSS px square at the face centre. */
function faceMean(shotPng: Buffer, at: { x: number; y: number; width: number }) {
  const png = PNG.sync.read(shotPng);
  const scale = png.width / at.width; // screenshots are device pixels, the point is CSS pixels
  const [cx, cy, r] = [Math.round(at.x * scale), Math.round(at.y * scale), Math.round(8 * scale)];
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = 4 * (y * png.width + x);
      for (let c = 0; c < 3; c++) sum[c]! += png.data[i + c]!;
      n++;
    }
  }
  return sum.map((v) => Math.round(v / n)) as [number, number, number];
}

/** Writes a review render when KISS_SHOTS names a folder (never in CI; renders are never committed). */
function keep(name: string, png: Buffer) {
  const dir = process.env.KISS_SHOTS;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), png);
}

test.beforeEach(async ({ page }) => {
  // Each test loads the avatar, then decodes and composites the face at least once per likeness and
  // takes several shots: 40–60 s under a loaded machine, against the 60 s default.
  test.slow();
  await openAvatar(page);
  // The dev panel overlays the canvas; keep it out of the sampled pixels.
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('[data-testid=params-panel]')!
      .style.setProperty('display', 'none'),
  );
  await setParams(page, { scene: portrait });
});

test('a photo face texture shows on the face, and the brows hide', async ({ page }) => {
  const baseline = await shot(page, 600);
  keep('likeness-default-portrait', baseline);
  const centre = await faceCentre(page);
  expect(await status(page)).toEqual({ meshes: [], browsVisible: true });
  const skin = faceMean(baseline, centre);
  expect(skin[1], `face centre ${skin}`).toBeLessThan(skin[0]);

  await setLikeness(page, { color: '#20c040', leftHalfX: 0 });
  const green = await shot(page);
  keep('likeness-green-texture', green);
  const [r, g] = faceMean(green, centre);
  expect(g, `face centre ${[r, g]}`).toBeGreaterThan(r + 40);
  expect((await status(page)).browsVisible).toBe(false);

  await clearLikeness(page);
  const restored = await shot(page);
  const back = faceMean(restored, centre);
  expect(back[1], `face centre ${back}`).toBeLessThan(back[0]);
  expect(diffPixels(baseline, restored)).toBeLessThan(100);
});

test('head offsets move the head, its eyes and the hair', async ({ page }) => {
  const baseline = await shot(page, 600);
  await setLikeness(page, { color: null, leftHalfX: 0.008 });
  const moved = await shot(page);
  keep('likeness-offsets-left-8mm', moved);
  const { width, height } = PNG.sync.read(moved);
  expect(diffPixels(baseline, moved)).toBeGreaterThan(0.01 * width * height);
  const { meshes } = await status(page);
  expect(meshes).toEqual(expect.arrayContaining(['Body', 'Eyes', 'Hair']));
});

test('every expression renders with a likeness and stays ready', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setLikeness(page, { color: '#20c040', leftHalfX: 0.004 });
  for (const expression of ['neutral', 'happy', 'relaxed', 'surprised', 'wink'] as const) {
    await setParams(page, { expression });
    const img = await shot(page);
    keep(`likeness-expression-${expression}`, img);
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready');
    expect((await status(page)).meshes).toContain('Body');
  }
  expect(errors).toEqual([]);
});

test('body extremes with a likeness stay ready and grounded', async ({ page }) => {
  await setParams(page, { scene: defaultParams.scene });
  await setLikeness(page, { color: '#20c040', leftHalfX: 0.004 });
  for (const value of [1, -1]) {
    await setBody(page, { weight: value, bust: value });
    await page.waitForTimeout(400);
    keep(`likeness-body-${value > 0 ? 'max' : 'min'}`, await shot(page));
    await expectGrounded(page);
    await hairAttached(page, defaultParams.hair);
    expect((await status(page)).meshes).toEqual(expect.arrayContaining(['Body', 'Hair']));
  }
});
