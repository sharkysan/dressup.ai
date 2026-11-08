import { expect, test } from '@playwright/test';
import { strings } from '../src/ui/strings';
import { countDistinctColors } from './helpers/png';

test('renders the avatar', async ({ page }) => {
  await page.goto('/');
  const viewer = page.getByTestId('viewer');
  await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 45_000 });
  const shot = await viewer.locator('canvas').screenshot();
  expect(countDistinctColors(shot)).toBeGreaterThan(50);
});

test('shows an error when the VRM cannot load', async ({ page }) => {
  await page.route('**/*.vrm', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'error', {
    timeout: 30_000,
  });
  await expect(page.getByRole('alert')).toHaveText(strings.avatarLoadFailed);
});

test('canvas follows the viewport on resize', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 45_000,
  });
  await page.setViewportSize({ width: 500, height: 900 });
  const box = await page.getByTestId('viewer').locator('canvas').boundingBox();
  expect(box?.width).toBeCloseTo(500, -1);
  expect(box?.height).toBeCloseTo(900, -1);
});
