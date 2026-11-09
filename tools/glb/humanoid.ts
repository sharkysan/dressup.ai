/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GltfJson } from './types';

/** Node index of a VRM humanoid bone ('head', 'hips', …) for VRM 1.0 or 0.x, or -1. */
export function findHumanBoneNode(json: GltfJson, bone: string): number {
  const vrm1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones?.[bone]?.node;
  if (typeof vrm1 === 'number') return vrm1;
  const vrm0 = json.extensions?.VRM?.humanoid?.humanBones;
  if (Array.isArray(vrm0)) {
    const entry = vrm0.find((b: any) => b.bone === bone);
    if (entry && typeof entry.node === 'number') return entry.node;
  }
  return -1;
}

/** Marker written on attachment joints so the runtime can bind by humanoid role instead of name. */
export const HUMAN_BONE_EXTRA = 'humanBone';
