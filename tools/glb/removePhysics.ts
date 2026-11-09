import type { GlbDoc } from './types';

/**
 * Removes all spring-bone physics (spec §7: none in v1). Static renders must be deterministic;
 * swinging hems and hair would otherwise differ frame to frame. Nodes are kept; only the
 * simulation data goes: VRMC_springBone (1.0) and VRM.secondaryAnimation (0.x).
 */
export function removePhysics(input: GlbDoc): GlbDoc {
  const json = structuredClone(input.json);
  if (json.extensions?.VRMC_springBone) {
    delete json.extensions.VRMC_springBone;
    json.extensionsUsed = (json.extensionsUsed ?? []).filter(
      (e: string) => e !== 'VRMC_springBone',
    );
  }
  const secondary = json.extensions?.VRM?.secondaryAnimation;
  if (secondary) {
    secondary.boneGroups = [];
    secondary.colliderGroups = [];
  }
  return { json, bin: input.bin };
}
