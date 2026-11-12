// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import {
  ALL_BODY_TARGETS,
  EXPRESSION_TARGETS,
  MASKED_MATERIALS,
  MATERIALS,
  REQUIRED_HUMAN_BONES,
} from '../../../src/avatar/baseContract';
import { HEADBIND_IDX, HEADBIND_W } from '../../../src/likeness/headBinding';
import { HEAD_MESHES, validateBase } from '../../../tools/base/validateBase';
import { appendAccessor } from '../../../tools/glb/accessors';
import { readGlb } from '../../../tools/glb/glb';
import type { GlbDoc } from '../../../tools/glb/types';

const BUILT = 'public/assets/base/base.vrm';
const BODY_VERTICES = 10;
const UNSIGNED_SHORT = 5123;
const FLOAT = 5126;

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
      ...(MASKED_MATERIALS.includes(name) ? { alphaMode: 'MASK' } : {}),
    })),
  };
  const doc: GlbDoc = { json: json as unknown as GlbDoc['json'], bin: new Uint8Array(0) };
  const positions = (count: number) => appendAccessor(doc, new Float32Array(3 * count), 'VEC3');
  // Four triangles that between them use every one of the Body's vertices.
  const indices = appendAccessor(
    doc,
    Uint16Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1),
    'SCALAR',
    {
      target: 34963,
    },
  );
  doc.json.meshes[0].primitives.push({
    attributes: { POSITION: positions(BODY_VERTICES) },
    indices,
  });
  // Each head mesh: two vertices bound to the Body's last vertices (VEC4 indices, the 4th 0).
  for (const name of HEAD_MESHES) {
    doc.json.meshes.push({
      name,
      primitives: [
        {
          attributes: {
            POSITION: positions(2),
            [HEADBIND_IDX]: appendAccessor(doc, Uint16Array.of(7, 8, 9, 0, 9, 8, 7, 0), 'VEC4'),
            [HEADBIND_W]: appendAccessor(doc, Float32Array.of(1, 0, 0, 0.5, 0.5, 0), 'VEC3'),
          },
        },
      ],
    });
  }
  return doc;
}

const vrm = (d: GlbDoc) => d.json.extensions.VRMC_vrm;
const primitive = (d: GlbDoc, mesh: string) =>
  d.json.meshes.find((m: { name: string }) => m.name === mesh).primitives[0];
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

test.each([HEADBIND_IDX, HEADBIND_W])('a head mesh without %s is named', (attribute) => {
  const d = validBaseDoc();
  delete primitive(d, MATERIALS.lashes).attributes[attribute];
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(MATERIALS.lashes);
  expect(problems[0]).toContain('head binding');
});

test('a missing head mesh is named', () => {
  const d = validBaseDoc();
  d.json.meshes = d.json.meshes.filter((m: { name: string }) => m.name !== MATERIALS.teeth);
  expect(validateBase(d).join('\n')).toContain(MATERIALS.teeth);
});

test('a head binding with a count other than the vertex count is named', () => {
  const d = validBaseDoc();
  const p = primitive(d, MATERIALS.eyes);
  p.attributes[HEADBIND_W] = appendAccessor(d, Float32Array.of(1, 0, 0), 'VEC3');
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(MATERIALS.eyes);
  expect(problems[0]).toContain(HEADBIND_W);
});

test('a head binding index past the Body vertices is named', () => {
  const d = validBaseDoc();
  const p = primitive(d, MATERIALS.tongue);
  p.attributes[HEADBIND_IDX] = appendAccessor(
    d,
    Uint16Array.of(0, 1, 2, 0, 3, 4, BODY_VERTICES, 0),
    'VEC4',
  );
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(MATERIALS.tongue);
  expect(problems[0]).toContain(`${BODY_VERTICES}`);
});

// glTF 2.0 §3.6.2.4: a vertex attribute's elements start on 4-byte boundaries, so the indices are VEC4.
test.each([
  [
    HEADBIND_IDX,
    'UNSIGNED_SHORT VEC3',
    (d: GlbDoc) => appendAccessor(d, new Uint16Array(6), 'VEC3'),
  ],
  [HEADBIND_IDX, 'UNSIGNED_INT VEC4', (d: GlbDoc) => appendAccessor(d, new Uint32Array(8), 'VEC4')],
  [HEADBIND_IDX, 'FLOAT VEC4', (d: GlbDoc) => appendAccessor(d, new Float32Array(8), 'VEC4')],
  [HEADBIND_W, 'FLOAT VEC4', (d: GlbDoc) => appendAccessor(d, new Float32Array(8), 'VEC4')],
  [HEADBIND_W, 'UNSIGNED_SHORT VEC3', (d: GlbDoc) => appendAccessor(d, new Uint16Array(6), 'VEC3')],
])('a head binding %s of %s is named', (attribute, format, accessor) => {
  const d = validBaseDoc();
  primitive(d, MATERIALS.teeth).attributes[attribute] = accessor(d);
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(MATERIALS.teeth);
  expect(problems[0]).toContain(`${attribute} is ${format}`);
  expect(problems[0]).toContain(
    attribute === HEADBIND_IDX ? 'expected UNSIGNED_SHORT VEC4' : 'expected FLOAT VEC3',
  );
});

test('a head binding index with a 4th component other than 0 is named', () => {
  const d = validBaseDoc();
  const p = primitive(d, MATERIALS.brows);
  p.attributes[HEADBIND_IDX] = appendAccessor(d, Uint16Array.of(7, 8, 9, 0, 9, 8, 7, 1), 'VEC4');
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(MATERIALS.brows);
  expect(problems[0]).toContain('4th component');
});

test('the head binding check can be disabled', () => {
  const d = validBaseDoc();
  delete primitive(d, MATERIALS.brows).attributes[HEADBIND_IDX];
  expect(validateBase(d, { headBinding: false })).toEqual([]);
});

test('a Body vertex in no triangle is named: three-vrm would renumber the Body at load', () => {
  const d = validBaseDoc();
  primitive(d, 'Body').indices = appendAccessor(
    d,
    Uint16Array.of(0, 1, 2, 3, 4, 5, 6, 8, 9),
    'SCALAR',
  );
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('Body');
  expect(problems[0]).toContain('1 vertices (the first 7) are in no triangle');
});

test('a Body without indices is named', () => {
  const d = validBaseDoc();
  delete primitive(d, 'Body').indices;
  const problems = validateBase(d);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('Body primitive 0 has no indices');
});

test('the Body index check can be disabled', () => {
  const d = validBaseDoc();
  delete primitive(d, 'Body').indices;
  expect(validateBase(d, { bodyIndexed: false })).toEqual([]);
});

describe.skipIf(!fs.existsSync(BUILT))('built base (public/assets/base/base.vrm)', () => {
  test('passes every check, every Body vertex in a triangle among them', () => {
    const doc = readGlb(new Uint8Array(fs.readFileSync(BUILT)));
    expect(validateBase(doc)).toEqual([]);
  });

  test('its five head meshes carry the head binding on every primitive', () => {
    const doc = readGlb(new Uint8Array(fs.readFileSync(BUILT)));
    const format = (accessor: number) => {
      const { componentType, type } = doc.json.accessors[accessor];
      return [componentType, type];
    };
    for (const name of HEAD_MESHES) {
      const mesh = doc.json.meshes.find((m: any) => m.name === name);
      expect(mesh, name).toBeDefined();
      for (const p of mesh.primitives) {
        expect(Object.keys(p.attributes), name).toEqual(
          expect.arrayContaining([HEADBIND_IDX, HEADBIND_W]),
        );
        expect(format(p.attributes[HEADBIND_IDX]), name).toEqual([UNSIGNED_SHORT, 'VEC4']);
        expect(format(p.attributes[HEADBIND_W]), name).toEqual([FLOAT, 'VEC3']);
      }
    }
  });
});
