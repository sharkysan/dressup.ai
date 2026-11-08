import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { computeExportSize } from '../src/export/exportSize';
import { countDistinctColors, readPngSize, transparentFraction } from './helpers/png';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('downloads an opaque PNG at 2x CSS size, independent of device pixel ratio', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1.5,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 45_000,
  });

  const canvas = page.getByTestId('viewer').locator('canvas');
  const css = await canvas.boundingBox();
  expect(css).not.toBeNull();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-button').click(),
  ]);
  expect(download.suggestedFilename()).toBe('avatar.png');

  const buf = fs.readFileSync(await download.path());
  expect(buf.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(readPngSize(buf)).toEqual(computeExportSize(css!.width, css!.height));
  expect(countDistinctColors(buf)).toBeGreaterThan(50);
  // What the user saves must be what they see: the backdrop is part of the GL scene, so no transparency.
  expect(transparentFraction(buf)).toBe(0);

  await context.close();
});

test('export button is disabled until the avatar is ready', async ({ page }) => {
  await page.route('**/*.vrm', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'error', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('export-button')).toBeDisabled();
});
