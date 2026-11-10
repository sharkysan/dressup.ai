// @vitest-environment node
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { getImage, replaceImage } from '../../../tools/glb/textures';
import type { GlbDoc } from '../../../tools/glb/types';
import { convertImagesToWebp } from '../../../tools/glb/webp';

/** An image whose left half is opaque grey and whose right half is transparent with varying RGB under it. */
function docWithCutout(): GlbDoc {
  const size = 64;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const opaque = x < size / 2 && y % 8 < 4;
      png.data.set(
        opaque ? [180, 180, 180, 255] : [120 + ((x * 7 + y * 3) % 40), 100, 90, 0],
        (y * size + x) * 4,
      );
    }
  }
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
      images: [{ name: 'cutout' }],
      textures: [{ source: 0 }],
      samplers: [],
    },
    bin: new Uint8Array(0),
  };
  replaceImage(doc, 'cutout', new Uint8Array(PNG.sync.write(png)));
  return doc;
}

/** Mean absolute difference of R under the transparent texels, source vs the encoded WebP. */
async function drift(opts?: { exact: boolean }): Promise<number> {
  const doc = docWithCutout();
  const source = PNG.sync.read(Buffer.from(getImage(doc, 'cutout'))).data;
  expect(await convertImagesToWebp(doc, 90, opts)).toBe(true);
  const { data } = await sharp(Buffer.from(getImage(doc, 'cutout')))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < source.length; i += 4) {
    if (source[i + 3] !== 0) continue;
    sum += Math.abs(data[i]! - source[i]!);
    n++;
  }
  return sum / n;
}

test('exact keeps the colour under transparent texels; the default lets the encoder replace it', async () => {
  const lossy = await drift();
  const exact = await drift({ exact: true });
  expect(exact).toBeLessThan(10);
  expect(lossy).toBeGreaterThan(exact * 2);
});
