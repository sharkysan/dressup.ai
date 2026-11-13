import { expect, type Page } from '@playwright/test';
import { defaultParams, type AvatarParams } from '../../src/catalog/params';

export const portrait = { ...defaultParams.scene, framing: 'portrait' } as const;

/**
 * Opens the app with the dev hook and waits until the avatar is ready, framed (its metrics are measured
 * after load) and wearing the default hair (which lands after ready), so no first shot is half-done.
 */
export async function openAvatar(page: Page) {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/#dev');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 45_000,
  });
  await expect(page.getByTestId('params-panel')).toBeVisible();
  await page.waitForFunction(() => window.__kiss?.store.getState().avatarMetrics !== null);
  await hairAttached(page, defaultParams.hair);
}

/** Waits until the named hairstyle's meshes are attached ('none' when bald). */
export async function hairAttached(page: Page, id: string) {
  await expect
    .poll(() => page.evaluate(() => window.__kiss!.store.getState().attachedHair), {
      timeout: 20_000,
    })
    .toBe(id);
}

export async function setBody(page: Page, patch: Partial<AvatarParams['body']>) {
  await page.evaluate((p) => {
    const store = window.__kiss!.store;
    store.getState().setParams({ body: { ...store.getState().params.body, ...p } });
  }, patch);
}

export async function setParams(page: Page, patch: Partial<AvatarParams>) {
  await page.evaluate((p) => window.__kiss!.store.getState().setParams(p), patch);
}

/** Waits for two rendered frames (plus a settle for async loads) so screenshots never catch a half-applied state. */
export async function shot(page: Page, settle = 400) {
  await page.waitForTimeout(settle);
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  return page.getByTestId('viewer').locator('canvas').screenshot();
}

/** The avatar is ready, with finite metrics and its head at a standing height. */
export async function expectGrounded(page: Page) {
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready');
  const m = await page.evaluate(() => window.__kiss!.store.getState().avatarMetrics!);
  expect(Number.isFinite(m.headY) && Number.isFinite(m.height)).toBe(true);
  expect(m.headY).toBeGreaterThan(1.2);
  expect(m.headY).toBeLessThan(2.1);
}
