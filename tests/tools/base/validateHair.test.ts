// @vitest-environment node
import sharp from 'sharp';
import { ALL_BODY_TARGETS } from '../../../src/avatar/baseContract';
import { validateHair } from '../../../tools/base/validateHair';
import type { GlbDoc } from '../../../tools/glb/types';
import { appendBytes, solidPng } from '../../../tools/test-fixtures/makeGlb';

const BASE_BONES = ['root', 'pelvis', 'neck_01', 'head'];

/** A minimal built hairstyle: the mesh Hair skinned to base bones, every body target, a MASK material. */
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
          primitives: [{ attributes: {}, material: 0 }],
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
  return doc;
}

test('a valid hairstyle has no problems', () => {
  expect(validateHair(validHairDoc(), BASE_BONES)).toEqual([]);
});

test('a missing body target is named', () => {
  const doc = validHairDoc();
  const mesh = doc.json.meshes[0];
  mesh.extras.targetNames = mesh.extras.targetNames.filter((n: string) => n !== 'body_hips_max');
  const problems = validateHair(doc, BASE_BONES);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('body_hips_max');
});

test('a joint that is not a bone of the base is named', () => {
  const doc = validHairDoc();
  doc.json.nodes[3].name = 'not_a_bone';
  expect(validateHair(doc, BASE_BONES).join('\n')).toContain('not_a_bone');
});

test('an image over 1024² is named', async () => {
  expect(
    validateHair(validHairDoc(solidPng(2048, 2048, [90, 50, 20, 255])), BASE_BONES).join('\n'),
  ).toContain('long01_diffuse');
  // The build converts textures to WebP before it validates them.
  const webp = await sharp({
    create: { width: 2048, height: 1024, channels: 4, background: '#5a3214' },
  })
    .webp()
    .toBuffer();
  const doc = validHairDoc(new Uint8Array(webp));
  doc.json.images[0].mimeType = 'image/webp';
  expect(validateHair(doc, BASE_BONES).join('\n')).toContain('long01_diffuse');
});

test('a mesh with no skin is a problem', () => {
  const doc = validHairDoc();
  delete doc.json.nodes[0].skin;
  expect(validateHair(doc, BASE_BONES).join('\n')).toMatch(/skin/);
});

test('a material that is not alphaMode MASK is a problem', () => {
  const doc = validHairDoc();
  doc.json.materials[0].alphaMode = 'BLEND';
  expect(validateHair(doc, BASE_BONES).join('\n')).toContain('MASK');
});
