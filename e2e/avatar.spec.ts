import { expect, test, type Page } from '@playwright/test';
import { defaultParams, type AvatarParams } from '../src/catalog/params';
import { diffPixels } from './helpers/png';

async function setParams(page: Page, patch: Partial<AvatarParams>) {
  await page.evaluate((p) => window.__kiss!.store.getState().setParams(p), patch);
}

/** Waits for two rendered frames (plus a settle for async loads) so screenshots never catch a half-applied state. */
async function shot(page: Page, settle = 400) {
  await page.waitForTimeout(settle);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  return page.getByTestId('viewer').locator('canvas').screenshot();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/#dev');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 45_000,
  });
  await expect(page.getByTestId('params-panel')).toBeVisible();
  // Camera framing depends on avatar metrics measured after load; wait for them so the first shot is final.
  await page.waitForFunction(() => window.__kiss?.store.getState().avatarMetrics !== null);
});

// Parked until Task 9: skin tint only reaches MToon materials, and the realistic base is standard PBR.
test.fixme('skin tone changes the render', async ({ page }) => {
  await setParams(page, { skin: '#f1d7c8' });
  const light = await shot(page);
  await setParams(page, { skin: '#5a3a24' });
  const dark = await shot(page);
  expect(diffPixels(light, dark)).toBeGreaterThan(2000);
});

test('an unknown hair id leaves the avatar ready and bald', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  const bald = await shot(page);
  await setParams(page, { hair: 'does_not_exist' });
  const after = await shot(page, 600);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready');
  expect(diffPixels(bald, after)).toBeLessThan(100);
  expect(warnings.some((w) => w.includes('does_not_exist'))).toBe(true);
});

// Parked until Task 4 adds the expression morph targets to the realistic base.
test.fixme('expressions change the face', async ({ page }) => {
  const neutral = await shot(page);
  await setParams(page, { expression: 'surprised' });
  const surprised = await shot(page);
  expect(diffPixels(neutral, surprised)).toBeGreaterThan(100);
});

test('portrait framing moves the camera to the face', async ({ page }) => {
  const full = await shot(page);
  await setParams(page, { scene: { ...defaultParams.scene, framing: 'portrait' } });
  const portrait = await shot(page, 600);
  expect(diffPixels(full, portrait)).toBeGreaterThan(20_000);
});
