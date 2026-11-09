import { getImage, replaceImage } from './textures';
import type { GlbDoc } from './types';

type SharpFactory = (input: Buffer) => {
  webp(opts: { quality: number }): { toBuffer(): Promise<Buffer> };
};

/**
 * Converts every embedded image to WebP (EXT_texture_webp, supported by three.js GLTFLoader).
 * Returns false and leaves PNGs in place when `sharp` is unavailable.
 */
export async function convertImagesToWebp(doc: GlbDoc, quality = 90): Promise<boolean> {
  let sharp: SharpFactory;
  try {
    sharp = ((await import('sharp')) as unknown as { default: SharpFactory }).default;
  } catch {
    console.warn('WebP requested but `sharp` is not installed; keeping PNG textures');
    return false;
  }
  for (const image of doc.json.images) {
    if (!image.name || image.bufferView === undefined || image.mimeType === 'image/webp') continue;
    const webp = new Uint8Array(
      await sharp(Buffer.from(getImage(doc, image.name)))
        .webp({ quality })
        .toBuffer(),
    );
    replaceImage(doc, image.name, webp);
    image.mimeType = 'image/webp';
  }
  doc.json.extensionsUsed = Array.from(
    new Set([...(doc.json.extensionsUsed ?? []), 'EXT_texture_webp']),
  );
  for (const texture of doc.json.textures) {
    texture.extensions = {
      ...(texture.extensions ?? {}),
      EXT_texture_webp: { source: texture.source },
    };
  }
  return true;
}
