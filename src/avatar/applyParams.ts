import type { VRM } from '@pixiv/three-vrm';
import type { AvatarParams } from '../catalog/params';
import { EYE_COLORS } from './eyeColors';
import { materialsWhere, tintMaterial } from './materials';
import { isIrisMaterial, isSkinMaterial } from './vroidNames';

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
 * Applies the parts of `AvatarParams` that live on the base avatar: skin and iris tints and the
 * expression (body morphs and realistic materials arrive in later tasks). Hairstyle loading and tinting are HairModel's job.
 * Idempotent: every value is set absolutely, never accumulated.
 */
export function applyParams(vrm: VRM, params: AvatarParams): void {
  const root = vrm.scene;
  for (const m of materialsWhere(root, isSkinMaterial)) tintMaterial(m, params.skin);
  for (const m of materialsWhere(root, isIrisMaterial))
    tintMaterial(m, EYE_COLORS[params.eyeColor]);
  setExpression(vrm, params.expression);
}
