import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { CALIBRATION } from '../src/analysis/body/calibrationSetup';
import { defaultParams } from '../src/catalog/params';
import { openAvatar } from './helpers/avatar';

const MODELS_DIR = path.resolve('public/models');
const modelsPresent = [
  'face_landmarker.task',
  'pose_landmarker_full.task',
  'selfie_multiclass_256x256.tflite',
].every((name) => fs.existsSync(path.join(MODELS_DIR, name)));

// Models are fetched by `npm run assets:models` (CI) and git-ignored; skip, don't fail, where absent.
test.skip(!modelsPresent, 'MediaPipe models not present under public/models');

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
