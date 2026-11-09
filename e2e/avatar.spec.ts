import { expect, test, type Page } from '@playwright/test';
import { defaultParams, type AvatarParams } from '../src/catalog/params';
import { diffPixels } from './helpers/png';

const zero = defaultParams.faceShape;

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

test('face morphs change the render', async ({ page }) => {
  await setParams(page, { faceShape: { ...zero, faceWidth: -1 } });
  const narrow = await shot(page);
  await setParams(page, { faceShape: { ...zero, faceWidth: 1 } });
  const wide = await shot(page);
  expect(diffPixels(narrow, wide)).toBeGreaterThan(300);
});

test('skin tone changes the render', async ({ page }) => {
  await setParams(page, { skin: '#f1d7c8' });
  const light = await shot(page);
  await setParams(page, { skin: '#5a3a24' });
  const dark = await shot(page);
  expect(diffPixels(light, dark)).toBeGreaterThan(2000);
});

test('a hairstyle attaches, tints, and detaches', async ({ page }) => {
  const bald = await shot(page);
  await setParams(page, { hair: 'hair_twist_01', hairColor: '#2b1b12' });
  const dark = await shot(page, 2000);
  expect(diffPixels(bald, dark)).toBeGreaterThan(2000);
  await setParams(page, { hairColor: '#e8c872' });
  const blonde = await shot(page);
  // The whole head of hair changes colour, so this is a large diff; 494 px was the pre-fix noise floor.
  expect(diffPixels(dark, blonde)).toBeGreaterThan(2000);
  // Brows follow hairColor, so restore it too before comparing against the original bald frame.
  await setParams(page, { hair: 'none', hairColor: defaultParams.hairColor });
  const baldAgain = await shot(page, 600);
  expect(diffPixels(baldAgain, bald)).toBeLessThan(100);
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

test('expressions change the face', async ({ page }) => {
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
