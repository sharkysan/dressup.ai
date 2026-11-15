import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { strings } from '../src/ui/strings';

const MODELS_DIR = path.resolve('public/models');
const PHOTOS_DIR = path.resolve('e2e/fixtures/photos');
const modelsPresent = [
  'face_landmarker.task',
  'pose_landmarker_full.task',
  'selfie_multiclass_256x256.tflite',
].every((name) => fs.existsSync(path.join(MODELS_DIR, name)));

/** A flat mid-grey image: decodes fine, contains no face. */
function blankPng(size = 512): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data.fill(128);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  return PNG.sync.write(png);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
});

test('analysis page renders the viewer and the privacy line', async ({ page }) => {
  await page.goto('/#analysis');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 45_000,
  });
  const status = page.getByTestId('analysis-status');
  await expect(status).toHaveAttribute('data-analysis', 'idle');
  await expect(status).toHaveText(strings.analysis.privacy);
  await expect(page.getByTestId('photo-input')).toBeVisible();
  // The dev hook exposes the pipeline for tooling (lineup runner, fixtures).
  const hook = await page.evaluate(() => Object.keys(window.__kiss?.analysis ?? {}).sort());
  expect(hook).toEqual(['analyzePhoto', 'loadModels']);
});

test('a failed model download shows the friendly message with retry', async ({ page }) => {
  await page.route('**/models/*', (route) => route.fulfill({ status: 500, body: 'nope' }));
  await page.goto('/#analysis');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 45_000,
  });
  await page.getByTestId('photo-input').setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: blankPng(),
  });
  const status = page.getByTestId('analysis-status');
  await expect(status).toHaveAttribute('data-analysis', 'error', { timeout: 30_000 });
  await expect(status).toHaveText(strings.analysis.modelsFailed);
  await expect(page.getByRole('button', { name: strings.analysis.retry })).toBeVisible();
});

test.describe('with models', () => {
  // Models are fetched by `npm run assets:models` (CI) and git-ignored; skip, don't fail, where absent.
  test.skip(!modelsPresent, 'MediaPipe models not present under public/models');
  // Under software WebGL each model's first run compiles its shaders: ~10–15 s apiece.
  test.describe.configure({ timeout: 150_000 });

  test('a photo without a face is rejected with guidance', async ({ page }) => {
    await page.goto('/#analysis');
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
      timeout: 45_000,
    });
    await page.getByTestId('photo-input').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: blankPng(),
    });
    const status = page.getByTestId('analysis-status');
    await expect(status).toHaveAttribute('data-analysis', 'error', { timeout: 90_000 });
    await expect(status).toHaveText(strings.analysis.noFace);
  });

  const photo = fs.existsSync(PHOTOS_DIR)
    ? fs.readdirSync(PHOTOS_DIR).find((f) => /\.(jpe?g|png)$/i.test(f))
    : undefined;

  test('a consented portrait yields valid in-range params', async ({ page }) => {
    test.skip(!photo, 'no photo under e2e/fixtures/photos (git-ignored; add a consented portrait)');
    await page.goto('/#analysis');
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
      timeout: 45_000,
    });
    await page.getByTestId('photo-input').setInputFiles(path.join(PHOTOS_DIR, photo!));
    const status = page.getByTestId('analysis-status');
    await expect(status).toHaveAttribute('data-analysis', 'done', { timeout: 90_000 });
    const params = await page.evaluate(() => window.__kiss!.store.getState().params);
    expect(params.version).toBe(2);
    expect(params.skin).toMatch(/^#[0-9a-f]{6}$/i);

    // The photo face, when the face passes the projection gate (≥ 256 px wide at full resolution).
    const gate = await page.getByTestId('likeness-gate').textContent();
    const likeness = await page.evaluate(async () => {
      const l = window.__kiss!.store.getState().likeness;
      if (!l) return null;
      const texture = await createImageBitmap(l.faceTexture);
      const corr = (await (await fetch('/assets/base/correspondence.json')).json()) as {
        head: { vertices: number[] };
      };
      let maxOffset = 0;
      for (let i = 0; i < l.headOffsets.length; i += 3) {
        const [x, y, z] = [l.headOffsets[i]!, l.headOffsets[i + 1]!, l.headOffsets[i + 2]!];
        maxOffset = Math.max(maxOffset, Math.hypot(x, y, z));
      }
      const result = {
        texture: [texture.width, texture.height],
        type: l.faceTexture.type,
        offsets: l.headOffsets.length,
        headVertices: corr.head.vertices.length,
        maxOffsetMm: 1000 * maxOffset,
      };
      texture.close();
      return result;
    });
    if (gate === strings.analysis.likenessTooSmall) {
      expect(likeness).toBeNull();
      expect(params.face).toBe('default');
      return;
    }
    expect(gate).toBe(strings.analysis.likenessOk);
    expect(likeness).not.toBeNull();
    expect(params.face).toBe('photo');
    expect(likeness!.texture).toEqual([1024, 1024]);
    expect(['image/webp', 'image/png']).toContain(likeness!.type);
    expect(likeness!.offsets).toBe(3 * likeness!.headVertices);
    expect(likeness!.maxOffsetMm).toBeLessThanOrEqual(18);
  });
});
