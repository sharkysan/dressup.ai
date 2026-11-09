import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { Material, Skeleton, SkinnedMesh, type Bone, type Object3D } from 'three';

export class AttachError extends Error {
  missingBones: string[];
  constructor(missingBones: string[]) {
    super(`attachment references bones the avatar lacks: ${missingBones.join(', ')}`);
    this.name = 'AttachError';
    this.missingBones = missingBones;
  }
}

export type Attachment = { detach(): void };

/**
 * Rebinds every SkinnedMesh in `attachment` to the avatar's own bones and adds it to `vrm.scene`.
 * A bone tagged `userData.humanBone` (written by the asset pipeline) resolves via the VRM humanoid
 * map; otherwise bones match by name. Nothing is attached if any bone is missing.
 */
export function attachSkinned(vrm: VRM, attachment: Object3D): Attachment {
  const meshes: SkinnedMesh[] = [];
  attachment.traverse((obj) => {
    if (obj instanceof SkinnedMesh) meshes.push(obj);
  });

  const missing = new Set<string>();
  const plans = meshes.map((mesh) => {
    const bones = mesh.skeleton.bones.map((bone) => {
      const target = resolveBone(vrm, bone);
      if (!target) missing.add(bone.name || '(unnamed)');
      return target;
    });
    return { mesh, bones };
  });
  if (missing.size > 0) throw new AttachError([...missing]);

  for (const { mesh, bones } of plans) {
    const skeleton = new Skeleton(bones as Bone[], mesh.skeleton.boneInverses);
    mesh.bind(skeleton, mesh.bindMatrix);
    mesh.frustumCulled = false;
    vrm.scene.add(mesh);
  }

  return {
    detach() {
      for (const { mesh } of plans) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) disposeMaterial(m);
      }
    },
  };
}

function resolveBone(vrm: VRM, bone: Bone): Object3D | null {
  const role = bone.userData.humanBone as VRMHumanBoneName | undefined;
  if (role) return vrm.humanoid?.getRawBoneNode(role) ?? null;
  return vrm.scene.getObjectByName(bone.name) ?? null;
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (
      value &&
      typeof value === 'object' &&
      'isTexture' in value &&
      typeof (value as { dispose?: unknown }).dispose === 'function'
    ) {
      (value as { dispose: () => void }).dispose();
    }
  }
  material.dispose();
}
