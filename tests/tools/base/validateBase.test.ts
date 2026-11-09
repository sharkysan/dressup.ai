// @vitest-environment node
import {
  ALL_BODY_TARGETS,
  EXPRESSION_TARGETS,
  MATERIALS,
  REQUIRED_HUMAN_BONES,
} from '../../../src/avatar/baseContract';
import { validateBase } from '../../../tools/base/validateBase';
import type { GlbDoc } from '../../../tools/glb/types';

function validBaseDoc(): GlbDoc {
  const humanBones = Object.fromEntries(REQUIRED_HUMAN_BONES.map((b, i) => [b, { node: i }]));
  const preset = Object.fromEntries(
    Object.keys(EXPRESSION_TARGETS).map((k) => [
      k,
      { morphTargetBinds: [{ node: 0, index: 0, weight: 1 }] },
    ]),
  );
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
    nodes: [],
    skins: [],
    textures: [],
    images: [],
    samplers: [],
    extensions: {
      VRMC_vrm: { specVersion: '1.0', humanoid: { humanBones }, expressions: { preset } },
    },
    meshes: [
      {
        name: 'Body',
        primitives: [],
        extras: { targetNames: [...ALL_BODY_TARGETS, ...Object.values(EXPRESSION_TARGETS)] },
      },
    ],
    materials: Object.values(MATERIALS).map((name) => ({
      name,
      ...(name === 'Brows' || name === 'Lashes' ? { alphaMode: 'MASK' } : {}),
    })),
  };
  return { json: json as unknown as GlbDoc['json'], bin: new Uint8Array(0) };
}

const vrm = (d: GlbDoc) => d.json.extensions.VRMC_vrm;
const mat = (d: GlbDoc, n: string) => d.json.materials.find((m: { name: string }) => m.name === n);

test('a valid base has no problems', () => {
  expect(validateBase(validBaseDoc())).toEqual([]);
});

test('a missing required bone is named', () => {
  const d = validBaseDoc();
  delete vrm(d).humanoid.humanBones.leftFoot;
  expect(validateBase(d).join('\n')).toContain('leftFoot');
});

test('an expression with no binds is named', () => {
  const d = validBaseDoc();
  vrm(d).expressions.preset.blinkLeft.morphTargetBinds = [];
  expect(validateBase(d).join('\n')).toContain('blinkLeft');
});

test('a missing body target is named', () => {
  const d = validBaseDoc();
  const m = d.json.meshes[0];
  m.extras.targetNames = m.extras.targetNames.filter((n: string) => n !== 'body_legLength_max');
  expect(validateBase(d).join('\n')).toContain('body_legLength_max');
});

test('an MToon material is rejected', () => {
  const d = validBaseDoc();
  mat(d, 'Skin').extensions = { VRMC_materials_mtoon: {} };
  expect(validateBase(d).join('\n')).toContain('MToon');
});

test('Lashes must be alphaMode MASK', () => {
  const d = validBaseDoc();
  mat(d, 'Lashes').alphaMode = 'BLEND';
  const problems = validateBase(d).filter((p) => p.includes('Lashes'));
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.join('\n')).toContain('MASK');
});

test('a non-1.0 specVersion or a VRM 0.x file is rejected', () => {
  const d = validBaseDoc();
  vrm(d).specVersion = '0.0';
  expect(validateBase(d).join('\n')).toContain('1.0');
  const old = validBaseDoc();
  old.json.extensions = { VRM: {} };
  expect(validateBase(old).join('\n')).toContain('1.0');
});

test('a disabled check is skipped', () => {
  const d = validBaseDoc();
  vrm(d).expressions.preset.blinkLeft.morphTargetBinds = [];
  expect(validateBase(d, { expressions: false })).toEqual([]);
});
