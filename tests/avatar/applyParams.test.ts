import { MToonMaterial, VRMExpression, VRMExpressionManager, type VRM } from '@pixiv/three-vrm';
import { BufferGeometry, Group, Mesh } from 'three';
import { EYE_COLORS } from '../../src/avatar/eyeColors';
import { applyParams, setExpression } from '../../src/avatar/applyParams';
import { defaultParams, type AvatarParams } from '../../src/catalog/params';

function named(name: string) {
  const m = new MToonMaterial();
  m.name = name;
  return m;
}

/** A stand-in VRM: a scene with named materials and a Face mesh carrying morph targets. */
function fakeVrm() {
  const scene = new Group();
  const skin = named('Body_00_SKIN');
  const faceSkin = named('Face_00_SKIN');
  const iris = named('EyeIris_00_EYE');
  const face = new Mesh(new BufferGeometry(), [faceSkin, iris]);
  scene.add(new Mesh(new BufferGeometry(), skin), face);

  const expressionManager = new VRMExpressionManager();
  for (const name of ['neutral', 'happy', 'relaxed', 'surprised', 'blinkLeft']) {
    expressionManager.registerExpression(new VRMExpression(name));
  }
  const vrm = { scene, expressionManager } as unknown as VRM;
  return { vrm, scene, face, skin, iris, expressionManager };
}

test('setExpression resets the previous preset', () => {
  const { vrm, expressionManager: em } = fakeVrm();
  setExpression(vrm, 'happy');
  setExpression(vrm, 'surprised');
  expect(em.getValue('happy')).toBe(0);
  expect(em.getValue('surprised')).toBe(1);
});

test('wink maps to blinkLeft and neutral clears all', () => {
  const { vrm, expressionManager: em } = fakeVrm();
  setExpression(vrm, 'wink');
  expect(em.getValue('blinkLeft')).toBe(1);
  setExpression(vrm, 'neutral');
  expect(em.getValue('blinkLeft')).toBe(0);
  expect(em.getValue('happy')).toBe(0);
});

test('applyParams tints skin and iris from params', () => {
  const { vrm, skin, iris } = fakeVrm();
  const params: AvatarParams = {
    ...defaultParams,
    skin: '#8d5524',
    hairColor: '#111111',
    eyeColor: 'blue',
  };
  applyParams(vrm, params);
  expect('#' + skin.color.getHexString()).toBe('#8d5524');
  expect('#' + iris.color.getHexString()).toBe(EYE_COLORS.blue);
});

test('applyParams is idempotent', () => {
  const { vrm, skin } = fakeVrm();
  const params: AvatarParams = { ...defaultParams, skin: '#8d5524', expression: 'happy' };
  applyParams(vrm, params);
  const once = skin.color.getHex();
  applyParams(vrm, params);
  applyParams(vrm, params);
  expect(skin.color.getHex()).toBe(once);
  expect(vrm.expressionManager!.getValue('happy')).toBe(1);
});
