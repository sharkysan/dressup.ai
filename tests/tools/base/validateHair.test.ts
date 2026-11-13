// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ALL_BODY_TARGETS } from '../../../src/avatar/baseContract';
import { HEADBIND_IDX, HEADBIND_W } from '../../../src/likeness/headBinding';
import { HAIR_BUDGET_BYTES } from '../../../tools/base/buildHair';
import { validateHair } from '../../../tools/base/validateHair';
import { appendAccessor } from '../../../tools/glb/accessors';
import { readGlb } from '../../../tools/glb/glb';
import type { GlbDoc } from '../../../tools/glb/types';
import { appendBytes, solidPng } from '../../../tools/test-fixtures/makeGlb';

const BASE_BONES = ['root', 'pelvis', 'neck_01', 'head'];
const BODY_VERTICES = 10;
const UNSIGNED_SHORT = 5123;
const FLOAT = 5126;

/**
 * A minimal built hairstyle: the mesh Hair skinned to base bones, every body target, a head binding, a
 * MASK material.
 */
function validHairDoc(image: Uint8Array = solidPng(1024, 1024, [90, 50, 20, 255])): GlbDoc {
  const doc: GlbDoc = {
    json: {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 0 }],
      bufferViews: [],
      accessors: [],
      nodes: [
        { name: 'Hair', mesh: 0, skin: 0 },
        { name: 'root', children: [2] },
        { name: 'neck_01', children: [3] },
        { name: 'head' },
      ],
      skins: [{ joints: [1, 2, 3] }],
      meshes: [
        {
          name: 'Hair',
          primitives: [],
          extras: { targetNames: [...ALL_BODY_TARGETS] },
        },
      ],
      materials: [
        {
          name: 'Hair',
          alphaMode: 'MASK',
          pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        },
      ],
      textures: [{ source: 0 }],
      images: [],
      samplers: [],
    },
    bin: new Uint8Array(0),
  };
  doc.json.images.push({
    name: 'long01_diffuse',
    mimeType: 'image/png',
    bufferView: appendBytes(doc, image),
  });
  addPrimitive(doc);
  return doc;
}

/**
 * Appends a primitive of two vertices bound to Body vertices 0..3 (VEC4 indices, the 4th 0) to the hair
 * mesh; returns it.
 */
function addPrimitive(doc: GlbDoc) {
  const primitive: { attributes: Record<string, number>; material: number } = {
    attributes: {
      POSITION: appendAccessor(doc, new Float32Array(6), 'VEC3'),
      [HEADBIND_IDX]: appendAccessor(doc, Uint16Array.of(0, 1, 2, 0, 3, 2, 1, 0), 'VEC4'),
      [HEADBIND_W]: appendAccessor(doc, Float32Array.of(0.5, 0.25, 0.25, 1, 0, 0), 'VEC3'),
    },
    material: 0,
  };
  doc.json.meshes[0].primitives.push(primitive);
  return primitive;
}

test('a valid hairstyle has no problems', () => {
  expect(validateHair(validHairDoc(), BASE_BONES, BODY_VERTICES)).toEqual([]);
});

test('a missing body target is named', () => {
  const doc = validHairDoc();
  const mesh = doc.json.meshes[0];
  mesh.extras.targetNames = mesh.extras.targetNames.filter((n: string) => n !== 'body_hips_max');
  const problems = validateHair(doc, BASE_BONES, BODY_VERTICES);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('body_hips_max');
});

test('a joint that is not a bone of the base is named', () => {
  const doc = validHairDoc();
  doc.json.nodes[3].name = 'not_a_bone';
  expect(validateHair(doc, BASE_BONES, BODY_VERTICES).join('\n')).toContain('not_a_bone');
});

test('an image over 1024² is named', async () => {
  expect(
    validateHair(
      validHairDoc(solidPng(2048, 2048, [90, 50, 20, 255])),
      BASE_BONES,
      BODY_VERTICES,
    ).join('\n'),
  ).toContain('long01_diffuse');
  // The build converts textures to WebP before it validates them.
  const webp = await sharp({
    create: { width: 2048, height: 1024, channels: 4, background: '#5a3214' },
  })
    .webp()
    .toBuffer();
  const doc = validHairDoc(new Uint8Array(webp));
  doc.json.images[0].mimeType = 'image/webp';
  expect(validateHair(doc, BASE_BONES, BODY_VERTICES).join('\n')).toContain('long01_diffuse');
});

test('a mesh with no skin is a problem', () => {
  const doc = validHairDoc();
  delete doc.json.nodes[0].skin;
  expect(validateHair(doc, BASE_BONES, BODY_VERTICES).join('\n')).toMatch(/skin/);
});

test('a material that is not alphaMode MASK is a problem', () => {
  const doc = validHairDoc();
  doc.json.materials[0].alphaMode = 'BLEND';
  expect(validateHair(doc, BASE_BONES, BODY_VERTICES).join('\n')).toContain('MASK');
});

test.each([HEADBIND_IDX, HEADBIND_W])('a primitive without %s is named', (attribute) => {
  const doc = validHairDoc();
  delete addPrimitive(doc).attributes[attribute];
  const problems = validateHair(doc, BASE_BONES, BODY_VERTICES);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('primitive 1');
  expect(problems[0]).toContain('head binding');
});

test('a head binding with a count other than the vertex count is named', () => {
  const doc = validHairDoc();
  const primitive = doc.json.meshes[0].primitives[0];
  primitive.attributes[HEADBIND_IDX] = appendAccessor(doc, Uint16Array.of(0, 1, 2, 0), 'VEC4');
  const problems = validateHair(doc, BASE_BONES, BODY_VERTICES);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(HEADBIND_IDX);
});

test('a head binding index past the Body vertices is named', () => {
  const doc = validHairDoc();
  const primitive = doc.json.meshes[0].primitives[0];
  primitive.attributes[HEADBIND_IDX] = appendAccessor(
    doc,
    Uint16Array.of(0, 1, 2, 0, BODY_VERTICES + 5, 0, 0, 0),
    'VEC4',
  );
  const problems = validateHair(doc, BASE_BONES, BODY_VERTICES);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(`${BODY_VERTICES + 5}`);
});

test.each([
  [
    HEADBIND_IDX,
    'UNSIGNED_SHORT VEC3',
    (d: GlbDoc) => appendAccessor(d, new Uint16Array(6), 'VEC3'),
  ],
  [HEADBIND_W, 'UNSIGNED_SHORT VEC3', (d: GlbDoc) => appendAccessor(d, new Uint16Array(6), 'VEC3')],
])('a head binding %s of %s is named', (attribute, format, accessor) => {
  const doc = validHairDoc();
  doc.json.meshes[0].primitives[0].attributes[attribute] = accessor(doc);
  const problems = validateHair(doc, BASE_BONES, BODY_VERTICES);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(`${attribute} is ${format}`);
});

// Built with the base by npm run assets:base; public/assets/hair may also hold files of other origins,
// so the catalog's hairstyles (assets/source/hair) are the ones checked, and the built base gates them.
const BUILT = 'public/assets/base/base.vrm';
const HAIRSTYLES = fs.readdirSync('assets/source/hair').sort();

describe.skipIf(!fs.existsSync(BUILT))('built hairstyles (public/assets/hair)', () => {
  test.each(HAIRSTYLES)('%s carries the head binding and is within its budget', (id) => {
    const file = path.join('public/assets/hair', `${id}.glb`);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(HAIR_BUDGET_BYTES);
    const doc = readGlb(new Uint8Array(fs.readFileSync(file)));
    const format = (accessor: number) => {
      const { componentType, type } = doc.json.accessors[accessor];
      return [componentType, type];
    };
    for (const p of doc.json.meshes.flatMap((m: { primitives: unknown[] }) => m.primitives)) {
      const attributes = (p as { attributes: Record<string, number> }).attributes;
      expect(Object.keys(attributes)).toEqual(expect.arrayContaining([HEADBIND_IDX, HEADBIND_W]));
      expect(format(attributes[HEADBIND_IDX]!)).toEqual([UNSIGNED_SHORT, 'VEC4']);
      expect(format(attributes[HEADBIND_W]!)).toEqual([FLOAT, 'VEC3']);
    }
  });
});
