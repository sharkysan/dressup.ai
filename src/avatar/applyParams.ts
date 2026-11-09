import type { VRM } from '@pixiv/three-vrm';
import { Mesh, type Object3D } from 'three';
import type { AvatarParams } from '../catalog/params';
import { EYE_COLORS } from './eyeColors';
import { materialsByPrefix, materialsBySuffix, mixHex, tintMaterial } from './materials';

export const FACE_SHAPE_KEYS = [
  'faceWidth',
  'jawWidth',
  'chinLength',
  'noseWidth',
  'noseLength',
  'eyeSpacing',
  'eyeSize',
  'lipFullness',
] as const satisfies readonly (keyof AvatarParams['faceShape'])[];

const EXPRESSION_PRESETS = {
  neutral: null,
  happy: 'happy',
  relaxed: 'relaxed',
  surprised: 'surprised',
  wink: 'blinkLeft',
} as const satisfies Record<AvatarParams['expression'], string | null>;

const MANAGED_EXPRESSIONS = ['neutral', 'happy', 'relaxed', 'surprised', 'blinkLeft'] as const;

const LIP_TINT_STRENGTH = 0.35;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Drives the paired face morph targets (spec §7): weight w > 0 → `${key}_max` = w,
 * w < 0 → `${key}_min` = −w. Meshes without a given target are skipped; other targets are untouched.
 */
export function setFaceShape(root: Object3D, faceShape: AvatarParams['faceShape']): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.morphTargetDictionary || !obj.morphTargetInfluences) return;
    const dict = obj.morphTargetDictionary;
    for (const key of FACE_SHAPE_KEYS) {
      const w = clamp(faceShape[key]);
      const max = dict[`${key}_max`];
      const min = dict[`${key}_min`];
      if (max !== undefined) obj.morphTargetInfluences[max] = Math.max(w, 0);
      if (min !== undefined) obj.morphTargetInfluences[min] = Math.max(-w, 0);
    }
  });
}

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
 * Applies everything in `AvatarParams` that lives on the base avatar: skin, iris, brow and lip
 * tints, face-shape morphs and the expression. Hairstyle loading and tinting are HairModel's job.
 * Idempotent: every value is set absolutely, never accumulated.
 */
export function applyParams(vrm: VRM, params: AvatarParams): void {
  const root = vrm.scene;
  for (const m of materialsBySuffix(root, '_SKIN')) tintMaterial(m, params.skin);
  for (const m of materialsByPrefix(root, 'EyeIris')) tintMaterial(m, EYE_COLORS[params.eyeColor]);
  for (const m of materialsByPrefix(root, 'FaceBrow')) tintMaterial(m, params.hairColor);
  for (const m of materialsByPrefix(root, 'FaceMouth')) {
    tintMaterial(m, mixHex('#ffffff', params.lipTint, LIP_TINT_STRENGTH));
  }
  setFaceShape(root, params.faceShape);
  setExpression(vrm, params.expression);
}
