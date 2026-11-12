import type { VRM } from '@pixiv/three-vrm';
import { LinearSRGBColorSpace } from 'three';
import type { AvatarParams } from '../catalog/params';
import { MATERIALS, type BaseMeta } from './baseContract';
import { standardMaterial, type EyeTextures } from './baseMaterials';
import { applyBody } from './body';
import type { FaceComposite, SkinTexture } from './bodyTexture';

const EXPRESSION_PRESETS = {
  neutral: null,
  happy: 'happy',
  relaxed: 'relaxed',
  surprised: 'surprised',
  wink: 'blinkLeft',
} as const satisfies Record<AvatarParams['expression'], string | null>;

const MANAGED_EXPRESSIONS = ['neutral', 'happy', 'relaxed', 'surprised', 'blinkLeft'] as const;

/** Sets exactly one managed VRM expression preset (or none for 'neutral'); 'wink' maps to blinkLeft. */
export function setExpression(vrm: VRM, expression: AvatarParams['expression']): void {
  const manager = vrm.expressionManager;
  if (!manager) return;
  for (const name of MANAGED_EXPRESSIONS) {
    if (manager.getExpression(name)) manager.setValue(name, 0);
  }
  const preset = EXPRESSION_PRESETS[expression];
  if (preset && manager.getExpression(preset)) manager.setValue(preset, 1);
}

/**
 * What applyParams needs besides the VRM: the body albedo, the eye textures, the base's metadata, and the
 * likeness's face for the skin (null: the base face).
 */
export type ApplyContext = {
  skin: SkinTexture;
  eyes: EyeTextures;
  meta: BaseMeta;
  face: FaceComposite | null;
};

/**
 * Applies the parts of `AvatarParams` that live on the base avatar (spec §7): the skin tint and the face
 * under the base layer (with the skin gain as the material colour, and the base layer's matte
 * roughness), the eye texture, the hair colour on brows and lashes, the body shape, height and
 * grounding, and the expression. Hairstyle loading and tinting are HairModel's job.
 * Idempotent: every value is set absolutely, never accumulated.
 */
export function applyParams(vrm: VRM, params: AvatarParams, ctx: ApplyContext): void {
  const root = vrm.scene;
  const skin = standardMaterial(root, MATERIALS.skin);
  if (skin) {
    skin.map = ctx.skin.update(params.skin, ctx.face);
    // The canvas holds the albedo ÷ the skin gain; the colour multiplies it back, so the skin's median
    // renders as the tint.
    const [r, g, b] = ctx.skin.gain;
    skin.color.setRGB(r, g, b, LinearSRGBColorSpace);
    // The base layer's roughness: the map carries the skin's and the garments' values.
    skin.roughnessMap = ctx.skin.roughnessMap;
    skin.roughness = 1;
  }
  const eyes = standardMaterial(root, MATERIALS.eyes);
  if (eyes) ctx.eyes.set(eyes, params.eyeColor);
  for (const name of [MATERIALS.brows, MATERIALS.lashes]) {
    standardMaterial(root, name)?.color.set(params.hairColor);
  }
  applyBody(vrm, params.body, ctx.meta);
  setExpression(vrm, params.expression);
}
