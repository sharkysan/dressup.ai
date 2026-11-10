import { z } from 'zod';

/** Wardrobe slots (spec §8). `full` excludes `top` and `bottom`; the store enforces it. */
export const SLOTS = ['top', 'bottom', 'full', 'shoes', 'outer', 'head'] as const;
export type Slot = (typeof SLOTS)[number];

/** Body regions a garment can hide (spec §7/§8). */
export type Region =
  'torso' | 'pelvis' | 'upperArms' | 'forearms' | 'thighs' | 'calves' | 'feet' | 'neck';

/** Body-shape morph sliders, each -1..1 (spec §5). Blender shape keys are named by baseContract. */
export const BODY_MORPHS = [
  'gender',
  'weight',
  'muscle',
  'shoulders',
  'bust',
  'waist',
  'hips',
  'legLength',
  'armLength',
] as const;
export type BodyMorph = (typeof BODY_MORPHS)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb colour');
const signedUnit = z.number().min(-1).max(1);
const unit = z.number().min(0).max(1);

export const outfitItemSchema = z.object({
  id: z.string(),
  color: hexColor.optional(),
});
export type OutfitItem = z.infer<typeof outfitItemSchema>;

const outfitSchema = z
  .strictObject({
    top: outfitItemSchema,
    bottom: outfitItemSchema,
    full: outfitItemSchema,
    shoes: outfitItemSchema,
    outer: outfitItemSchema,
    head: outfitItemSchema,
  })
  .partial();

const bodySchema = z.object({
  heightCm: z.number().min(140).max(210),
  gender: unit,
  weight: signedUnit,
  muscle: signedUnit,
  shoulders: signedUnit,
  bust: signedUnit,
  waist: signedUnit,
  hips: signedUnit,
  legLength: signedUnit,
  armLength: signedUnit,
}) satisfies z.ZodType<Record<BodyMorph | 'heightCm', number>>;

/** The single contract between analysis, editor UI, renderer and share links (spec §5). */
export const avatarParamsSchema = z.strictObject({
  version: z.literal(2),
  skin: hexColor,
  hairColor: hexColor,
  eyeColor: z.enum(['brown', 'darkBrown', 'hazel', 'green', 'blue', 'grey']),
  hair: z.string(),
  body: bodySchema,
  face: z.enum(['photo', 'default']),
  extras: z.object({
    glasses: z.string().optional(),
  }),
  outfit: outfitSchema,
  pose: z.string(),
  poseTweak: z.object({
    headTurn: signedUnit,
    headTilt: signedUnit,
    torsoLean: signedUnit,
  }),
  expression: z.enum(['neutral', 'happy', 'relaxed', 'surprised', 'wink']),
  scene: z.object({
    backdrop: z.string(),
    framing: z.enum(['full', 'portrait']),
  }),
});
export type AvatarParams = z.infer<typeof avatarParamsSchema>;

export const defaultParams: AvatarParams = {
  version: 2,
  skin: '#c68642',
  hairColor: '#2b1b12',
  eyeColor: 'brown',
  hair: 'none',
  body: {
    heightCm: 165,
    gender: 0,
    weight: 0,
    muscle: 0,
    shoulders: 0,
    bust: 0,
    waist: 0,
    hips: 0,
    legLength: 0,
    armLength: 0,
  },
  face: 'default',
  extras: {},
  outfit: {},
  pose: 'stand_neutral',
  poseTweak: { headTurn: 0, headTilt: 0, torsoLean: 0 },
  expression: 'neutral',
  scene: { backdrop: 'studio', framing: 'full' },
};
