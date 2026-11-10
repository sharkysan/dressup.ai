import { expect, test, type Page } from '@playwright/test';
import { defaultParams, type AvatarParams } from '../src/catalog/params';
import { diffPixels, patchMean, readPngSize } from './helpers/png';

const portrait = { ...defaultParams.scene, framing: 'portrait' } as const;

async function setBody(page: Page, patch: Partial<AvatarParams['body']>) {
  await page.evaluate((p) => {
    const store = window.__kiss!.store;
    store.getState().setParams({ body: { ...store.getState().params.body, ...p } });
  }, patch);
}

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

test('skin tone changes the render', async ({ page }) => {
  // The dev panel overlays the canvas; keep it out of the sampled pixels.
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('[data-testid=params-panel]')!
      .style.setProperty('display', 'none'),
  );
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

test('every expression differs from neutral', async ({ page }) => {
  await setParams(page, { scene: portrait });
  const neutral = await shot(page, 600);
  for (const expression of ['happy', 'relaxed', 'surprised', 'wink'] as const) {
    await setParams(page, { expression });
    const img = await shot(page);
    expect(diffPixels(neutral, img), expression).toBeGreaterThan(100);
  }
});

test('body weight changes the render', async ({ page }) => {
  await setBody(page, { weight: -1 });
  const thin = await shot(page);
  await setBody(page, { weight: 1 });
  const heavy = await shot(page);
  expect(diffPixels(thin, heavy)).toBeGreaterThan(2000);
});

test('height scales the avatar', async ({ page }) => {
  const headY = async (heightCm: number) => {
    await setBody(page, { heightCm });
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__kiss!.store.getState().avatarMetrics!.headY);
  };
  const short = await headY(150);
  const tall = await headY(190);
  expect(tall / short).toBeGreaterThan((190 / 150) * 0.98);
  expect(tall / short).toBeLessThan((190 / 150) * 1.02);
});

test('all body extremes keep the avatar grounded', async ({ page }) => {
  const signed = [
    'weight',
    'muscle',
    'shoulders',
    'bust',
    'waist',
    'hips',
    'legLength',
    'armLength',
  ];
  for (const [value, gender] of [
    [1, 1],
    [-1, 0],
  ] as const) {
    const body = Object.fromEntries(signed.map((m) => [m, value]));
    await setBody(page, { ...body, gender, heightCm: 175 });
    await page.waitForTimeout(400);
    await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready');
    const m = await page.evaluate(() => window.__kiss!.store.getState().avatarMetrics!);
    expect(Number.isFinite(m.headY) && Number.isFinite(m.height)).toBe(true);
    expect(m.headY).toBeGreaterThan(1.2);
    expect(m.headY).toBeLessThan(2.1);
  }
});

test('eye colour changes the eyes', async ({ page }) => {
  await setParams(page, { scene: portrait, eyeColor: 'brown' });
  const brown = await shot(page, 600);
  await setParams(page, { eyeColor: 'blue' });
  const blue = await shot(page);
  expect(diffPixels(brown, blue)).toBeGreaterThan(50);
});

test('the base layer always covers torso and pelvis', async ({ page }) => {
  const spots = async () => {
    const pt = (name: string) => page.evaluate((n) => window.__kiss!.nodeScreenPoint(n), name);
    const [spine, neck, pelvis, calf] = await Promise.all(
      ['spine_03', 'neck_01', 'pelvis', 'calf_l'].map(pt),
    );
    // spine_02 projects into the high-waisted shorts on this base; the chest midway up the spine is shirt.
    const chest = spine && neck && { ...spine, y: (spine.y + neck.y) / 2 };
    return { torso: chest, pelvis, calf };
  };
  // The dev panel overlays the canvas; keep it out of the sampled pixels.
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('[data-testid=params-panel]')!
      .style.setProperty('display', 'none'),
  );
  await setParams(page, { skin: '#f1d7c8' });
  const light = await shot(page);
  const at = await spots();
  await setParams(page, { skin: '#4a2c20' });
  const dark = await shot(page);
  expect(at.torso && at.pelvis && at.calf).toBeTruthy();
  // Screenshots are device-pixel sized, the points are CSS pixels.
  const mean = (img: Buffer, p: { x: number; y: number; width: number }) => {
    const scale = readPngSize(img).width / p.width;
    return patchMean(img, p.x * scale, p.y * scale, Math.round(2 * scale));
  };
  const delta = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
  const torsoL = mean(light, at.torso!);
  const pelvisL = mean(light, at.pelvis!);
  const calfL = mean(light, at.calf!);
  // Opaque base layer: skin tone must not show through.
  expect(delta(torsoL, mean(dark, at.torso!))).toBeLessThan(12);
  expect(delta(pelvisL, mean(dark, at.pelvis!))).toBeLessThan(12);
  // Undershirt is light and low-chroma; shorts are dark.
  expect(Math.min(...torsoL)).toBeGreaterThan(150);
  expect(Math.max(...torsoL) - Math.min(...torsoL)).toBeLessThan(30);
  expect(Math.max(...pelvisL)).toBeLessThan(110);
  // Bare skin does respond to the tint.
  expect(delta(calfL, mean(dark, at.calf!))).toBeGreaterThan(40);
});
