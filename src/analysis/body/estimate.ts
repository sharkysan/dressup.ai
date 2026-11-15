import { z } from 'zod';
import { BODY_MORPHS } from '../../catalog/params';
import {
  BODY_FEATURES,
  WIDTH_FEATURES,
  type BodyFeature,
  type BodyFeatures,
  type WidthFeature,
} from './measure';

/** The morphs the photo determines: every body morph but gender, which is never inferred. */
export const CALIBRATED_MORPHS = BODY_MORPHS.filter((m) => m !== 'gender');
export type CalibratedMorph = (typeof CALIBRATED_MORPHS)[number];

/** The regression inputs: the ten features and gender. */
const INPUTS = BODY_FEATURES.length + 1;

/** The design row's length (without the intercept): 11, or 11 + 66 with the squares and products. */
export function designLength(degree: 1 | 2): number {
  return degree === 1 ? INPUTS : INPUTS + (INPUTS * (INPUTS + 1)) / 2;
}

const numbers = (n: number) => z.array(z.number().finite()).length(n);

export const bodyCalibrationSchema = z
  .object({
    version: z.literal(1),
    degree: z.union([z.literal(1), z.literal(2)]),
    features: z
      .array(z.string())
      .refine(
        (f) => f.length === BODY_FEATURES.length && f.every((n, i) => n === BODY_FEATURES[i]),
        'features must equal BODY_FEATURES in order',
      ),
    /** The clothing allowance per width: a photographed width is divided by 1 + allowance. */
    allowance: z.object(
      Object.fromEntries(WIDTH_FEATURES.map((f) => [f, z.number().min(0)])) as Record<
        WidthFeature,
        z.ZodNumber
      >,
    ),
    mean: numbers(INPUTS),
    scale: z.array(z.number().positive()).length(INPUTS),
    /** Intercept first. */
    coefficients: z.object(
      Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, z.array(z.number().finite())])) as Record<
        CalibratedMorph,
        z.ZodArray<z.ZodNumber>
      >,
    ),
    holdout: z.object({
      n: z.number().int().nonnegative(),
      /** Per ratio: the re-rendered estimates' RMS error ÷ the ratio's spread (spec §15). */
      outlineError: z.object(
        Object.fromEntries(BODY_FEATURES.map((f) => [f, z.number().nonnegative()])) as Record<
          BodyFeature,
          z.ZodNumber
        >,
      ),
      /** Per morph, for information: the morphs are not a target (spec §15). */
      maxAbsError: z.object(
        Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, z.number().nonnegative()])) as Record<
          CalibratedMorph,
          z.ZodNumber
        >,
      ),
    }),
    setup: z.object({
      train: z.number().int(),
      holdout: z.number().int(),
      seed: z.number().int(),
      armDownDeg: z.number(),
      render: z.tuple([z.number(), z.number()]),
    }),
  })
  .superRefine((cal, ctx) => {
    const want = 1 + designLength(cal.degree);
    for (const m of CALIBRATED_MORPHS) {
      if (cal.coefficients[m].length !== want) {
        ctx.addIssue({
          code: 'custom',
          path: ['coefficients', m],
          message: `expected ${want} coefficients`,
        });
      }
    }
  });
export type BodyCalibration = z.infer<typeof bodyCalibrationSchema> & {
  features: (typeof BODY_FEATURES)[number][];
};

const WIDTHS: ReadonlySet<string> = new Set(WIDTH_FEATURES);

/** The regression's design row (without the intercept): standardised inputs, then products. */
export function designRow(features: BodyFeatures, gender: number, cal: BodyCalibration): number[] {
  const raw = [
    ...BODY_FEATURES.map((f) =>
      WIDTHS.has(f) ? features[f] / (1 + cal.allowance[f as WidthFeature]) : features[f],
    ),
    gender,
  ];
  const x = raw.map((v, i) => (v - cal.mean[i]!) / cal.scale[i]!);
  if (cal.degree === 1) return x;
  const row = [...x];
  for (let i = 0; i < x.length; i++) for (let j = i; j < x.length; j++) row.push(x[i]! * x[j]!);
  return row;
}

/** The morphs the measurements imply, each clamped to -1..1. */
export function estimateMorphs(
  features: BodyFeatures,
  gender: number,
  cal: BodyCalibration,
): Record<CalibratedMorph, number> {
  const row = designRow(features, gender, cal);
  const out = {} as Record<CalibratedMorph, number>;
  for (const m of CALIBRATED_MORPHS) {
    const c = cal.coefficients[m];
    let v = c[0]!;
    for (let i = 0; i < row.length; i++) v += c[i + 1]! * row[i]!;
    out[m] = Math.min(1, Math.max(-1, v));
  }
  return out;
}
