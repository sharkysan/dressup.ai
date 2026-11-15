/** The bodies the body calibration renders (spec §6): sampled uniformly, from a seed. */
import { CALIBRATION } from '../../src/analysis/body/calibrationSetup';
import { CALIBRATED_MORPHS, type CalibratedMorph } from '../../src/analysis/body/estimate';
import type { AvatarParams } from '../../src/catalog/params';
import { mulberry32 } from './ridge';

/** The skins the calibration renders with, light to dark. */
export const SKIN_TONES = ['#f1d3b8', '#e0b48f', '#c68642', '#a0663a', '#7a4a2a', '#4a2a1a'];

/**
 * `n` bodies from `seed`: each calibrated morph uniform in −1..1, gender uniform in 0..1, the height
 * CALIBRATION.heightCm, and a skin picked uniformly from SKIN_TONES.
 */
export function sampleBodies(
  n: number,
  seed: number,
): { body: AvatarParams['body']; skin: string }[] {
  const rand = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const gender = rand();
    const morphs = Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, 2 * rand() - 1])) as Record<
      CalibratedMorph,
      number
    >;
    const skin = SKIN_TONES[Math.floor(rand() * SKIN_TONES.length)]!;
    return { body: { heightCm: CALIBRATION.heightCm, gender, ...morphs }, skin };
  });
}
