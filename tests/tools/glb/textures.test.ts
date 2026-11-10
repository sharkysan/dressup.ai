// @vitest-environment node
import { PNG } from 'pngjs';
import {
  bleedAlpha,
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

/** A 1-row PNG of the given RGBA pixels. */
function rowPng(pixels: number[][]): Uint8Array {
  const img = new PNG({ width: pixels.length, height: 1 });
  pixels.forEach((p, i) => img.data.set(p, i * 4));
  return new Uint8Array(PNG.sync.write(img));
}
const repeat = (n: number, p: number[]) => Array.from({ length: n }, () => p);

test('divideByMedian measures the tone on the covered texels only, not the UV gutter', () => {
  // Most texels are gutter (no face covers them), a darker, redder fill: measured with it, the skin
  // would keep a colour cast instead of turning neutral grey.
  const skin = [200, 150, 130, 255] as [number, number, number, number];
  const png = rowPng([...repeat(3, skin), ...repeat(7, [90, 60, 50, 255])]);
  const coverage = rowPng([...repeat(3, [255, 0, 0, 255]), ...repeat(7, [0, 0, 0, 255])]);
  const level = Math.round(0.85 * 255);
  expect([
    ...decodePng(neutralizeImage(png, 'divideByMedian', { coverage })).data.slice(0, 4),
  ]).toEqual([level, level, level, 255]);
  const [r, g, b] = decodePng(neutralizeImage(png, 'divideByMedian')).data;
  expect(r === g && g === b).toBe(false);
  expect(() => neutralizeImage(png, 'divideByMedian', { coverage: solidPng(2, 2, skin) })).toThrow(
    /size/,
  );
});

test('divideByMedian lowers the tone only as far as keeps all but 0.5% of the texels below 255', () => {
  const clipped = (png: Uint8Array) => {
    const { data } = decodePng(png);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data.slice(i, i + 3).includes(255)) n++;
    return n;
  };
  // 1% highlights at twice the median: at 0.85 they clip, so the tone comes down until they don't.
  const bright = neutralizeImage(
    rowPng([...repeat(990, [100, 80, 60, 255]), ...repeat(10, [200, 160, 120, 255])]),
    'divideByMedian',
  );
  expect(clipped(bright)).toBe(0);
  expect(decodePng(bright).data[0]).toBe(127);
  expect(decodePng(bright).data[990 * 4]).toBe(254);
  // 0.4% highlights may clip: the tone stays at 0.85.
  const few = neutralizeImage(
    rowPng([...repeat(996, [100, 80, 60, 255]), ...repeat(4, [200, 160, 120, 255])]),
    'divideByMedian',
  );
  expect(clipped(few)).toBe(4);
  expect(decodePng(few).data[0]).toBe(Math.round(0.85 * 255));
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

function rgbaPng(
  width: number,
  height: number,
  texel: (x: number, y: number) => number[],
): Uint8Array {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      png.data.set(texel(x, y), (y * width + x) * 4);
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

describe('bleedAlpha', () => {
  test('transparent texels take the colour of the opaque ones, alpha unchanged', () => {
    const out = PNG.sync.read(
      Buffer.from(
        bleedAlpha(
          rgbaPng(4, 4, (x, y) => (x === 1 && y === 1 ? [255, 0, 0, 255] : [255, 255, 255, 0])),
        ),
      ),
    );
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const o = (y * 4 + x) * 4;
        expect([...out.data.subarray(o, o + 3)]).toEqual([255, 0, 0]);
        expect(out.data[o + 3]).toBe(x === 1 && y === 1 ? 255 : 0);
      }
    }
  });

  test('averages the opaque neighbours and never touches opaque texels', () => {
    const src = rgbaPng(
      3,
      1,
      (x) =>
        [
          [100, 0, 0, 255],
          [9, 9, 9, 0],
          [200, 50, 0, 255],
        ][x]!,
    );
    const out = PNG.sync.read(Buffer.from(bleedAlpha(src)));
    expect([...out.data.subarray(0, 4)]).toEqual([100, 0, 0, 255]);
    expect([...out.data.subarray(4, 8)]).toEqual([150, 25, 0, 0]);
    expect([...out.data.subarray(8, 12)]).toEqual([200, 50, 0, 255]);
  });

  test('texels beyond maxIterations get the mean of the opaque texels, alpha unchanged', () => {
    const src = rgbaPng(
      5,
      1,
      (x) =>
        [
          [100, 0, 0, 255],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [200, 50, 10, 255],
        ][x]!,
    );
    const out = PNG.sync.read(Buffer.from(bleedAlpha(src, 1)));
    // Pass 1 fills texels 1 and 3 from one opaque neighbour each; texel 2 is beyond reach: the opaque mean.
    expect([...out.data.subarray(4, 8)]).toEqual([100, 0, 0, 0]);
    expect([...out.data.subarray(8, 12)]).toEqual([150, 25, 5, 0]);
    expect([...out.data.subarray(12, 16)]).toEqual([200, 50, 10, 0]);
  });

  test('an image with no opaque texel, or no transparent one, comes back unchanged', () => {
    const clear = rgbaPng(2, 2, () => [7, 8, 9, 0]);
    expect(bleedAlpha(clear)).toBe(clear);
    const solid = rgbaPng(2, 2, () => [7, 8, 9, 255]);
    expect(bleedAlpha(solid)).toBe(solid);
  });
});
