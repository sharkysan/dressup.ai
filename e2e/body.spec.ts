import { expect, test } from '@playwright/test';
import { CALIBRATION } from '../src/analysis/body/calibrationSetup';
import { defaultParams } from '../src/catalog/params';
import { openAvatar } from './helpers/avatar';
import { skipWithoutModels } from './helpers/models';

skipWithoutModels();

test('a full-length render of the avatar is analysed through the head crop', async ({ page }) => {
  // Under software WebGL each model's first run compiles its shaders: ~10–15 s apiece.
  test.setTimeout(150_000);
  await openAvatar(page, CALIBRATION.viewport);
  const sample = await page.evaluate((input) => window.__kiss!.calibration.sample(input), {
    body: defaultParams.body,
    skin: defaultParams.skin,
  });
  // The face is too small for FaceLandmarker on the 1024 px copy and is found on the head crop: it
  // passes the 120 px gate at full resolution, and is below the projection gate's 256 px.
  expect(sample).toEqual({ error: null, poseFound: true, likenessGate: 'too_small' });
});
