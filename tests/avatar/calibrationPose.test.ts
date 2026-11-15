import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { MathUtils, Object3D } from 'three';
import { setArmsDown } from '../../src/avatar/calibrationPose';

/** A VRM whose humanoid has normalised bone nodes for the upper arms only. */
function fakeVrm() {
  const bones: Partial<Record<VRMHumanBoneName, Object3D>> = {
    leftUpperArm: new Object3D(),
    rightUpperArm: new Object3D(),
  };
  // A rotation already on a bone, which setArmsDown replaces.
  bones.leftUpperArm!.rotation.set(0.3, -0.2, 0.1);
  const vrm = {
    humanoid: { getNormalizedBoneNode: (name: VRMHumanBoneName) => bones[name] ?? null },
  } as unknown as VRM;
  return { vrm, left: bones.leftUpperArm!, right: bones.rightUpperArm! };
}

test('setArmsDown turns the normalised upper arms about z: the left by −degrees, the right by +', () => {
  const { vrm, left, right } = fakeVrm();
  setArmsDown(vrm, 70);
  expect(MathUtils.radToDeg(left.rotation.z)).toBeCloseTo(-70, 9);
  expect(MathUtils.radToDeg(right.rotation.z)).toBeCloseTo(70, 9);
  for (const bone of [left, right]) {
    expect(bone.rotation.x).toBe(0);
    expect(bone.rotation.y).toBe(0);
  }
});

test('setArmsDown replaces the rotation: twice with 70 is once with 70', () => {
  const { vrm, left, right } = fakeVrm();
  setArmsDown(vrm, 70);
  const once = [left.quaternion.toArray(), right.quaternion.toArray()];
  setArmsDown(vrm, 70);
  expect([left.quaternion.toArray(), right.quaternion.toArray()]).toEqual(once);
  expect(MathUtils.radToDeg(left.rotation.z)).toBeCloseTo(-70, 9);
});
