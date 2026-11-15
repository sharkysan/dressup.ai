import { describe, expect, it } from 'vitest';
import { CALIBRATION } from '../../../src/analysis/body/calibrationSetup';
import { CALIBRATED_MORPHS } from '../../../src/analysis/body/estimate';
import { avatarParamsSchema } from '../../../src/catalog/params';
import { sampleBodies, SKIN_TONES } from '../../../tools/calibration/sample';

/** tools/calibrate-body.ts's defaults: 600 training bodies from the seed, 100 held out from seed + 1. */
const SEED = 20261115;
const TRAIN = 600;
const HOLDOUT = 100;

describe('sampleBodies', () => {
  it('gives the same list for the same seed', () => {
    expect(sampleBodies(50, 7)).toEqual(sampleBodies(50, 7));
    expect(sampleBodies(50, 7)).not.toEqual(sampleBodies(50, 8));
  });

  it('keeps every value in range: morphs −1..1, gender 0..1, the calibration height, a listed skin', () => {
    const samples = sampleBodies(TRAIN, SEED);
    expect(samples).toHaveLength(TRAIN);
    for (const { body, skin } of samples) {
      expect(avatarParamsSchema.shape.body.safeParse(body).success).toBe(true);
      expect(body.heightCm).toBe(CALIBRATION.heightCm);
      expect(body.gender).toBeGreaterThanOrEqual(0);
      expect(body.gender).toBeLessThanOrEqual(1);
      for (const m of CALIBRATED_MORPHS) {
        expect(body[m]).toBeGreaterThanOrEqual(-1);
        expect(body[m]).toBeLessThanOrEqual(1);
      }
      expect(SKIN_TONES).toContain(skin);
    }
  });

  it('spreads the values over their ranges and picks every skin tone', () => {
    const samples = sampleBodies(TRAIN, SEED);
    for (const m of CALIBRATED_MORPHS) {
      const values = samples.map((s) => s.body[m]);
      expect(Math.min(...values)).toBeLessThan(-0.95);
      expect(Math.max(...values)).toBeGreaterThan(0.95);
    }
    const genders = samples.map((s) => s.body.gender);
    expect(Math.min(...genders)).toBeLessThan(0.05);
    expect(Math.max(...genders)).toBeGreaterThan(0.95);
    expect(new Set(samples.map((s) => s.skin))).toEqual(new Set(SKIN_TONES));
  });

  it('shares no body between the training seed and seed + 1 (the held-out set)', () => {
    const train = new Set(sampleBodies(TRAIN, SEED).map((s) => JSON.stringify(s.body)));
    const holdout = sampleBodies(HOLDOUT, SEED + 1).map((s) => JSON.stringify(s.body));
    expect(holdout.filter((b) => train.has(b))).toEqual([]);
  });
});
