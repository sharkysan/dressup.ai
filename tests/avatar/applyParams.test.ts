import { MToonMaterial, VRMExpression, VRMExpressionManager, type VRM } from '@pixiv/three-vrm';
import { BufferGeometry, Group, Mesh } from 'three';
import { EYE_COLORS } from '../../src/avatar/eyeColors';
import { mixHex } from '../../src/avatar/materials';
import { applyParams, setExpression, setFaceShape } from '../../src/avatar/applyParams';
import { defaultParams, type AvatarParams } from '../../src/catalog/params';

const zero = defaultParams.faceShape;

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
  const brow = named('FaceBrow_00_FACE');
  const mouth = named('FaceMouth_00_FACE');
  const face = new Mesh(new BufferGeometry(), [faceSkin, iris, brow, mouth]);
  face.morphTargetDictionary = { faceWidth_min: 0, faceWidth_max: 1, Fcl_ALL_Joy: 2 };
  face.morphTargetInfluences = [0, 0, 0];
  scene.add(new Mesh(new BufferGeometry(), skin), face);

  const expressionManager = new VRMExpressionManager();
  for (const name of ['neutral', 'happy', 'relaxed', 'surprised', 'blinkLeft']) {
    expressionManager.registerExpression(new VRMExpression(name));
  }
  const vrm = { scene, expressionManager } as unknown as VRM;
  return { vrm, scene, face, skin, iris, brow, mouth, expressionManager };
}

test('positive faceWidth drives only the _max target', () => {
  const { scene, face } = fakeVrm();
  setFaceShape(scene, { ...zero, faceWidth: 0.6 });
  expect(face.morphTargetInfluences).toEqual([0, 0.6, 0]);
});

test('negative faceWidth drives only the _min target', () => {
  const { scene, face } = fakeVrm();
  setFaceShape(scene, { ...zero, faceWidth: -0.4 });
  expect(face.morphTargetInfluences![0]).toBeCloseTo(0.4);
  expect(face.morphTargetInfluences![1]).toBe(0);
});

test('weights are clamped to -1..1', () => {
  const { scene, face } = fakeVrm();
  setFaceShape(scene, { ...zero, faceWidth: 1.5 });
  expect(face.morphTargetInfluences![1]).toBe(1);
});

test('expression targets are left untouched by setFaceShape', () => {
  const { scene, face } = fakeVrm();
  face.morphTargetInfluences![2] = 1;
  setFaceShape(scene, zero);
  expect(face.morphTargetInfluences![2]).toBe(1);
});

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

test('applyParams tints skin, iris, brows and lips from params', () => {
  const { vrm, skin, iris, brow, mouth } = fakeVrm();
  const params: AvatarParams = {
    ...defaultParams,
    skin: '#8d5524',
    hairColor: '#111111',
    eyeColor: 'blue',
    lipTint: '#b35a5a',
  };
  applyParams(vrm, params);
  expect('#' + skin.color.getHexString()).toBe('#8d5524');
  expect('#' + iris.color.getHexString()).toBe(EYE_COLORS.blue);
  expect('#' + brow.color.getHexString()).toBe('#111111');
  expect('#' + mouth.color.getHexString()).toBe(mixHex('#ffffff', '#b35a5a', 0.35));
});

test('applyParams is idempotent', () => {
  const { vrm, skin, face } = fakeVrm();
  const params: AvatarParams = { ...defaultParams, faceShape: { ...zero, jawWidth: 0.3 } };
  applyParams(vrm, params);
  const once = skin.color.getHex();
  const influences = [...face.morphTargetInfluences!];
  applyParams(vrm, params);
  applyParams(vrm, params);
  expect(skin.color.getHex()).toBe(once);
  expect(face.morphTargetInfluences).toEqual(influences);
});
