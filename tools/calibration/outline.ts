/**
 * The body estimate's target (spec §15): the outline. Each held-out render's estimate is rendered and
 * measured again; per ratio, the RMS of the re-render's error over the held-out renders, ÷ that ratio's
 * spread across them. The default body scores about 1.
 */
import {
  BODY_FEATURES,
  type BodyFeature,
  type BodyFeatures,
} from '../../src/analysis/body/measure';

/** Spec §15: every ratio's outline error at most half its spread. */
export const OUTLINE_TOLERANCE = 0.5;

const perRatio = (value: (f: BodyFeature) => number) =>
  Object.fromEntries(BODY_FEATURES.map((f) => [f, value(f)])) as Record<BodyFeature, number>;

/** Below this, a ratio's standard deviation is 0 (a constant ratio's comes out at about 1e-17). */
const NO_SPREAD = 1e-12;

/**
 * The population standard deviation (÷ n) of each ratio; throws on no samples, or naming a ratio whose
 * deviation is 0.
 */
export function spread(features: BodyFeatures[]): Record<BodyFeature, number> {
  const n = features.length;
  if (n === 0) throw new Error('spread: no samples');
  return perRatio((f) => {
    const mean = features.reduce((s, x) => s + x[f], 0) / n;
    const sd = Math.sqrt(features.reduce((s, x) => s + (x[f] - mean) ** 2, 0) / n);
    if (!(sd >= NO_SPREAD)) throw new Error(`spread: ${f} has no spread over the samples`);
    return sd;
  });
}

/**
 * Per ratio, sqrt(mean((reprojected − features)²)) ÷ the ratio's spread over the samples' features: 0
 * when every re-render measures as its original, 1 when each measures as the samples' mean.
 */
export function outlineError(
  samples: { features: BodyFeatures; reprojected: BodyFeatures }[],
): Record<BodyFeature, number> {
  const sd = spread(samples.map((s) => s.features));
  return perRatio((f) => {
    const sum = samples.reduce((acc, s) => acc + (s.reprojected[f] - s.features[f]) ** 2, 0);
    return Math.sqrt(sum / samples.length) / sd[f];
  });
}
