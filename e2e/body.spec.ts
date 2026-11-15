import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CALIBRATION } from '../src/analysis/body/calibrationSetup';
import { BODY_FEATURES, type BodyFeature, type BodyFeatures } from '../src/analysis/body/measure';
import { defaultParams, type AvatarParams } from '../src/catalog/params';
import { spread } from '../tools/calibration/outline';
import { SKIN_TONES } from '../tools/calibration/sample';
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
  const { features, body, ...gates } = sample;
  expect(body).not.toBeNull();
  expect(gates).toEqual({
    error: null,
    poseFound: true,
    likenessGate: 'too_small',
    bodyGate: 'ok',
  });
  // The body gate passes, and the body is measured.
  expect(features).not.toBeNull();
  for (const f of BODY_FEATURES) {
    expect(Number.isFinite(features![f]), f).toBe(true);
    expect(features![f], f).toBeGreaterThan(0);
  }
});

/**
 * The ratios checked per body. The others are noisier from one body to the next, so their check is
 * statistical: the held-out outline test (tests/analysis/bodyCalibration.test.ts) covers all ten.
 */
const OUTLINE_RATIOS: BodyFeature[] = [
  'shoulderWidth',
  'waistWidth',
  'hipWidth',
  'legLength',
  'armLength',
  'area',
];

test('a rendered body analyses back to its outline', async ({ page }) => {
  // Four analyses: under software WebGL the first takes 1–2 min (each model's first run compiles its
  // shaders), each later one ~20 s.
  test.setTimeout(300_000);
  await openAvatar(page, CALIBRATION.viewport);
  const holdout = JSON.parse(readFileSync('tests/fixtures/body-holdout.json', 'utf8')) as {
    samples: { features: BodyFeatures }[];
  };
  const sd = spread(holdout.samples.map((s) => s.features));
  const skin = SKIN_TONES[2]!;
  const bodies: AvatarParams['body'][] = [
    { ...defaultParams.body, heightCm: CALIBRATION.heightCm },
    {
      heightCm: CALIBRATION.heightCm,
      gender: 0.2,
      weight: 0.5,
      muscle: -0.3,
      shoulders: 0.4,
      bust: -0.4,
      waist: 0.3,
      hips: -0.5,
      legLength: 0.4,
      armLength: -0.3,
    },
  ];
  const sample = (body: AvatarParams['body']) =>
    page.evaluate((input) => window.__kiss!.calibration.sample(input), { body, skin });
  for (const body of bodies) {
    const rendered = await sample(body);
    expect(rendered.bodyGate).toBe('ok');
    // The analysis's body (the shipped calibration's estimate), rendered and measured the same way.
    const estimated = await sample(rendered.body!);
    expect(estimated.bodyGate).toBe('ok');
    for (const f of OUTLINE_RATIOS) {
      expect(
        Math.abs(estimated.features![f] - rendered.features![f]),
        `${f} of ${JSON.stringify(body)}`,
      ).toBeLessThanOrEqual(sd[f]);
    }
  }
});
