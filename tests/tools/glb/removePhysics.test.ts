// @vitest-environment node
import { removePhysics } from '../../../tools/glb/removePhysics';
import { makeGlb } from '../../../tools/test-fixtures/makeGlb';

test('VRM 1.0: drops the whole VRMC_springBone extension and its extensionsUsed entry', () => {
  const out = removePhysics(makeGlb({ withHair: true }));
  expect(out.json.extensions.VRMC_springBone).toBeUndefined();
  expect(out.json.extensionsUsed).not.toContain('VRMC_springBone');
  expect(out.json.extensions.VRMC_vrm).toBeDefined();
});

test('VRM 0.x: empties secondaryAnimation bone groups and collider groups', () => {
  const out = removePhysics(makeGlb({ withHair: true, vrm0: true }));
  expect(out.json.extensions.VRM.secondaryAnimation.boneGroups).toEqual([]);
  expect(out.json.extensions.VRM.secondaryAnimation.colliderGroups).toEqual([]);
});
