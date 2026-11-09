import { pruneUnused } from './prune';
import type { GlbDoc } from './types';

const HAIR_MESH = 'Hair';
const HAIR_MATERIAL_SUFFIX = '_HAIR';
const HAIR_JOINT_PREFIX = 'J_Sec_Hair';

/**
 * Strips VRoid hair: the 'Hair' mesh (node keeps its slot, mesh reference removed), Body
 * primitives with *_HAIR materials, and spring-bone chains made only of J_Sec_Hair* joints.
 * Node indices are untouched so humanoid, constraints and skins stay valid. Unused resources are pruned.
 */
export function removeHair(input: GlbDoc): GlbDoc {
  const json = structuredClone(input.json);

  const hairMeshIndices = new Set<number>();
  json.meshes.forEach((m: { name?: string }, i: number) => {
    if (m.name === HAIR_MESH) hairMeshIndices.add(i);
  });
  for (const node of json.nodes) {
    if (node.mesh !== undefined && hairMeshIndices.has(node.mesh)) {
      delete node.mesh;
      delete node.skin;
    }
  }
  // Drop the hair meshes themselves and renumber remaining mesh references.
  if (hairMeshIndices.size > 0) {
    const map = new Map<number, number>();
    let next = 0;
    json.meshes.forEach((_: unknown, i: number) => {
      if (!hairMeshIndices.has(i)) map.set(i, next++);
    });
    json.meshes = json.meshes.filter((_: unknown, i: number) => !hairMeshIndices.has(i));
    for (const node of json.nodes) if (node.mesh !== undefined) node.mesh = map.get(node.mesh);
    // VRM 1.0 expression binds reference nodes (unchanged). VRM 0.x references meshes by index.
    const vrm0 = json.extensions?.VRM;
    if (vrm0) {
      for (const group of vrm0.blendShapeMaster?.blendShapeGroups ?? []) {
        group.binds = (group.binds ?? []).filter((b: { mesh: number }) => map.has(b.mesh));
        for (const b of group.binds) b.mesh = map.get(b.mesh);
      }
      if (vrm0.firstPerson?.meshAnnotations) {
        vrm0.firstPerson.meshAnnotations = vrm0.firstPerson.meshAnnotations
          .filter((a: { mesh: number }) => map.has(a.mesh))
          .map((a: { mesh: number }) => ({ ...a, mesh: map.get(a.mesh) }));
      }
    }
  }

  for (const mesh of json.meshes) {
    mesh.primitives = mesh.primitives.filter(
      (p: { material?: number }) =>
        p.material === undefined ||
        !String(json.materials[p.material].name ?? '').endsWith(HAIR_MATERIAL_SUFFIX),
    );
  }

  const isHairJoint = (node: number) =>
    String(json.nodes[node]?.name ?? '').startsWith(HAIR_JOINT_PREFIX);
  const springBone = json.extensions?.VRMC_springBone;
  if (springBone?.springs) {
    springBone.springs = springBone.springs.filter(
      (s: { joints: { node: number }[] }) => !s.joints.every((j) => isHairJoint(j.node)),
    );
  }
  const secondary = json.extensions?.VRM?.secondaryAnimation;
  if (secondary?.boneGroups) {
    secondary.boneGroups = secondary.boneGroups.filter(
      (g: { bones: number[] }) => !(g.bones ?? []).every((b) => isHairJoint(b)),
    );
  }

  return pruneUnused({ json, bin: input.bin });
}
