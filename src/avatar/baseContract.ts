import { z } from 'zod';
import { BODY_MORPHS, type AvatarParams, type BodyMorph, type Region } from '../catalog/params';

/** Shape-key names for one body morph: gender is one-sided, the rest have a min and a max. */
export function morphTargetNames(m: BodyMorph): string[] {
  return m === 'gender' ? ['body_gender_max'] : [`body_${m}_min`, `body_${m}_max`];
}

export const ALL_BODY_TARGETS: string[] = BODY_MORPHS.flatMap(morphTargetNames);

/** Expression name -> shape key on the Body mesh. */
export const EXPRESSION_TARGETS = {
  happy: 'ex_happy',
  relaxed: 'ex_relaxed',
  surprised: 'ex_surprised',
  blinkLeft: 'ex_blinkLeft',
} as const;

export const BODY_MESH = 'Body';

export const MATERIALS = {
  skin: 'Skin',
  eyes: 'Eyes',
  brows: 'Brows',
  lashes: 'Lashes',
  teeth: 'Teeth',
  tongue: 'Tongue',
} as const;

/** Materials exported with alphaMode MASK. */
export const MASKED_MATERIALS = ['Brows', 'Lashes'];

/** Region id painted into the regions map. 0 = never hidden (head, hands). */
export const REGION_CODES: Record<Region, number> = {
  torso: 1,
  pelvis: 2,
  upperArms: 3,
  forearms: 4,
  thighs: 5,
  calves: 6,
  feet: 7,
  neck: 8,
};

/** VRM 1.0 humanoid bones the export must map. */
export const REQUIRED_HUMAN_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
];

/** Sidecar written by the build (metres, glTF Y-up). Keys of the delta maps are body target names. */
export const baseMetaSchema = z.object({
  version: z.literal(1),
  heightM: z.number(),
  minY: z.number(),
  morphHeightDelta: z.record(z.string(), z.number()),
  morphMinYDelta: z.record(z.string(), z.number()),
});
export type BaseMeta = z.infer<typeof baseMetaSchema>;

export const BASE_URL = '/assets/base/base.vrm';
export const BASE_META_URL = '/assets/base/base.json';
export const BASE_LAYER_URL = '/assets/base/baselayer.webp';
export const REGIONS_URL = '/assets/base/regions.png';
export const eyeTextureUrl = (preset: AvatarParams['eyeColor']) =>
  `/assets/base/eyes/${preset}.webp`;

/** Everything the Blender build needs, as plain JSON. */
export function contractJson(): object {
  return {
    bodyMesh: BODY_MESH,
    materials: MATERIALS,
    maskedMaterials: MASKED_MATERIALS,
    regions: REGION_CODES,
    bodyTargets: ALL_BODY_TARGETS,
    expressionTargets: EXPRESSION_TARGETS,
    humanBones: REQUIRED_HUMAN_BONES,
  };
}
