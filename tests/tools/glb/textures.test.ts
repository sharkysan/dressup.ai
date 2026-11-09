// @vitest-environment node
import { PNG } from 'pngjs';
import {
  getImage,
  neutralizeImage,
  replaceImage,
  resizeImage,
  resizeImages,
} from '../../../tools/glb/textures';
import type { GlbDoc } from '../../../tools/glb/types';
import { appendBytes, decodePng, makeGlb, solidPng } from '../../../tools/test-fixtures/makeGlb';

/** A doc with one material per entry, each using its own base-colour image named after the material. */
function docWithMaterials(images: Record<string, Uint8Array>): GlbDoc {
  const doc: GlbDoc = {
    json: {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 0 }],
      bufferViews: [],
      accessors: [],
      meshes: [],
      nodes: [],
      skins: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [],
    },
    bin: new Uint8Array(0),
  };
  for (const [name, png] of Object.entries(images)) {
    doc.json.images.push({
      name: `${name}_image`,
      mimeType: 'image/png',
      bufferView: appendBytes(doc, png),
    });
    doc.json.textures.push({ source: doc.json.images.length - 1 });
    doc.json.materials.push({
      name,
      pbrMetallicRoughness: { baseColorTexture: { index: doc.json.textures.length - 1 } },
    });
  }
  return doc;
}

test('divideByMedian lifts a skin texture to a neutral tone and keeps alpha', () => {
  const out = decodePng(neutralizeImage(solidPng(8, 8, [200, 150, 130, 255]), 'divideByMedian'));
  expect(out.data[0]).toBeCloseTo(0.85 * 255, -1);
  expect(out.data[1]).toBeCloseTo(0.85 * 255, -1);
  expect(out.data[2]).toBeCloseTo(0.85 * 255, -1);
  expect(out.data[3]).toBe(255);
});

test('luminance produces grey pixels with the median at 0.75', () => {
  const out = decodePng(neutralizeImage(solidPng(4, 4, [120, 60, 30, 255]), 'luminance'));
  expect(out.data[0]).toBe(out.data[1]);
  expect(out.data[1]).toBe(out.data[2]);
  expect(out.data[0]).toBeCloseTo(0.75 * 255, -1);
});

test('luminance turns a black texture, its shape only in alpha, flat grey at 0.75', () => {
  // MakeHuman's brows and lashes: black (0–2) where opaque. Dividing by a ~0 median would amplify the
  // noise to speckle, and plain black can't take a tint.
  const img = new PNG({ width: 2, height: 2 });
  img.data.set([2, 1, 0, 255, 0, 0, 0, 200, 1, 0, 0, 255, 0, 0, 0, 0]);
  const out = decodePng(neutralizeImage(new Uint8Array(PNG.sync.write(img)), 'luminance'));
  const g = Math.round(0.75 * 255);
  expect([...out.data]).toEqual([g, g, g, 255, g, g, g, 200, g, g, g, 255, g, g, g, 0]);
});

test('resizeImage caps the long edge and leaves small images alone', () => {
  const big = decodePng(resizeImage(solidPng(2048, 1024, [1, 2, 3, 255]), 1024));
  expect([big.width, big.height]).toEqual([1024, 512]);
  const small = solidPng(16, 8, [1, 2, 3, 255]);
  expect(resizeImage(small, 1024)).toBe(small);
});

test('replaceImage swaps bytes for a named image', () => {
  const doc = makeGlb();
  const png = solidPng(2, 2, [9, 9, 9, 255]);
  replaceImage(doc, 'Body_00', png);
  expect(Buffer.from(getImage(doc, 'Body_00')).equals(Buffer.from(png))).toBe(true);
  expect(() => getImage(doc, 'Nope')).toThrow(/Nope/);
});

test('resizeImages caps each image at the size its material allows', () => {
  const doc = docWithMaterials({
    Skin: solidPng(2048, 2048, [200, 150, 130, 255]),
    Brows: solidPng(2048, 2048, [40, 30, 20, 255]),
  });
  resizeImages(doc, (_image, material) => (material === 'Skin' ? 2048 : 1024));
  const size = (name: string) => {
    const { width, height } = decodePng(getImage(doc, name));
    return [width, height];
  };
  expect(size('Skin_image')).toEqual([2048, 2048]);
  expect(size('Brows_image')).toEqual([1024, 1024]);
});
