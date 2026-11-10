import type { VRM } from '@pixiv/three-vrm';
import type { Object3D } from 'three';
import { BODY_MORPHS, type AvatarParams } from '../catalog/params';
import type { BaseMeta } from './baseContract';

type Body = AvatarParams['body'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Shape-key name -> influence (0..1) for a body. Signed morphs split into _min/_max; gender is _max only. */
export function bodyInfluences(body: Body): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of BODY_MORPHS) {
    if (m === 'gender') {
      out.body_gender_max = clamp(body.gender, 0, 1);
      continue;
    }
    const w = clamp(body[m], -1, 1);
    out[`body_${m}_min`] = Math.max(-w, 0);
    out[`body_${m}_max`] = Math.max(w, 0);
  }
  return out;
}

/** Sets the body shape keys on every mesh that has them. */
export function applyBodyMorphs(root: Object3D, body: Body): void {
  const influences = bodyInfluences(body);
  root.traverse((node) => {
    const mesh = node as Object3D & {
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    };
    const dict = mesh.morphTargetDictionary;
    const values = mesh.morphTargetInfluences;
    if (!dict || !values) return;
    for (const [name, value] of Object.entries(influences)) {
      const index = dict[name];
      if (index !== undefined) values[index] = value;
    }
  });
}

function weighted(deltas: Record<string, number>, body: Body): number {
  let sum = 0;
  for (const [name, value] of Object.entries(bodyInfluences(body)))
    sum += value * (deltas[name] ?? 0);
  return sum;
}

/** Uniform scale that makes the morphed body exactly heightCm tall. */
export function avatarScale(body: Body, meta: BaseMeta): number {
  return body.heightCm / 100 / (meta.heightM + weighted(meta.morphHeightDelta, body));
}

/** Y translation that puts the morphed, scaled feet on y = 0. */
export function groundOffset(body: Body, meta: BaseMeta, scale: number): number {
  return -(meta.minY + weighted(meta.morphMinYDelta, body)) * scale;
}

/** Applies morphs, then scales and grounds the VRM root. */
export function applyBody(vrm: VRM, body: Body, meta: BaseMeta): void {
  applyBodyMorphs(vrm.scene, body);
  const scale = avatarScale(body, meta);
  vrm.scene.scale.setScalar(scale);
  vrm.scene.position.y = groundOffset(body, meta, scale);
}
