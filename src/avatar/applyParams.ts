import type { VRM } from '@pixiv/three-vrm';
import type { AvatarParams } from '../catalog/params';
import { MATERIALS, type BaseMeta } from './baseContract';
import { standardMaterial, type EyeTextures } from './baseMaterials';
import { applyBody } from './body';
import type { SkinTexture } from './bodyTexture';

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

/** What applyParams needs besides the VRM: the body albedo, the eye textures, the base's metadata. */
export type ApplyContext = { skin: SkinTexture; eyes: EyeTextures; meta: BaseMeta };

/**
 * Applies the parts of `AvatarParams` that live on the base avatar (spec §7): the skin tint under the
 * base layer, the eye texture, the hair colour on brows and lashes, the body shape, height and
 * grounding, and the expression. Hairstyle loading and tinting are HairModel's job.
 * Idempotent: every value is set absolutely, never accumulated.
 */
export function applyParams(vrm: VRM, params: AvatarParams, ctx: ApplyContext): void {
  const root = vrm.scene;
  const skin = standardMaterial(root, MATERIALS.skin);
  if (skin) skin.map = ctx.skin.update(params.skin);
  const eyes = standardMaterial(root, MATERIALS.eyes);
  if (eyes) ctx.eyes.set(eyes, params.eyeColor);
  for (const name of [MATERIALS.brows, MATERIALS.lashes]) {
    standardMaterial(root, name)?.color.set(params.hairColor);
  }
  applyBody(vrm, params.body, ctx.meta);
  setExpression(vrm, params.expression);
}
