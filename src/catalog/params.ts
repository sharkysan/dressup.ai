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

/** The single contract between analysis, editor UI, renderer and share links (spec §5). */
export const avatarParamsSchema = z.object({
  version: z.literal(1),
  base: z.enum(['a', 'b']),
  skin: hexColor,
  hairColor: hexColor,
  eyeColor: z.enum(['brown', 'darkBrown', 'hazel', 'green', 'blue', 'grey']),
  lipTint: hexColor,
  hair: z.string(),
  brows: z.object({
    shape: z.enum(['straight', 'arched', 'soft', 'angled']),
    thickness: unit,
  }),
  faceShape: z.object({
    faceWidth: signedUnit,
    jawWidth: signedUnit,
    chinLength: signedUnit,
    noseWidth: signedUnit,
    noseLength: signedUnit,
    eyeSpacing: signedUnit,
    eyeSize: signedUnit,
    lipFullness: signedUnit,
  }),
  extras: z.object({
    glasses: z.string().optional(),
    facialHair: z.string().optional(),
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
  version: 1,
  base: 'a',
  skin: '#c68642',
  hairColor: '#2b1b12',
  eyeColor: 'brown',
  lipTint: '#b35a5a',
  hair: 'none',
  brows: { shape: 'straight', thickness: 0.5 },
  faceShape: {
    faceWidth: 0,
    jawWidth: 0,
    chinLength: 0,
    noseWidth: 0,
    noseLength: 0,
    eyeSpacing: 0,
    eyeSize: 0,
    lipFullness: 0,
  },
  extras: {},
  outfit: {},
  pose: 'stand_neutral',
  poseTweak: { headTurn: 0, headTilt: 0, torsoLean: 0 },
  expression: 'neutral',
  scene: { backdrop: 'studio', framing: 'full' },
};
