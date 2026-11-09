import { z } from 'zod';
import calibrationJson from './calibration.json';
import { RATIO_KEYS, type Ratios } from './mapping/faceShape';

const statSchema = z.object({ mean: z.number(), std: z.number().positive() });

export const calibrationSchema = z.object({
  version: z.literal(1),
  /** 0 marks the seed derived from the canonical face model, not real photos. */
  samples: z.number().int().nonnegative(),
  stats: z.object(
    Object.fromEntries(RATIO_KEYS.map((k) => [k, statSchema])) as Record<
      (typeof RATIO_KEYS)[number],
      typeof statSchema
    >,
  ),
});
export type Calibration = z.infer<typeof calibrationSchema>;

export const DEFAULT_CALIBRATION: Calibration = calibrationSchema.parse(calibrationJson);

/** Floor on std as a fraction of |mean|, so a tiny sample set cannot produce explosive z-scores. */
export const STD_FLOOR = 0.05;

/** Population mean/std per ratio over real-photo samples (spec §6: 30–50 frontal photos). */
export function accumulateCalibration(samples: Ratios[]): Calibration {
  if (samples.length < 2) throw new Error('need at least 2 samples to calibrate');
  const stats = {} as Calibration['stats'];
  for (const key of RATIO_KEYS) {
    const values = samples.map((s) => s[key]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    const std = Math.max(Math.sqrt(variance), STD_FLOOR * Math.abs(mean), 1e-6);
    stats[key] = { mean, std };
  }
  return { version: 1, samples: samples.length, stats };
}
