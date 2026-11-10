/* eslint-disable @typescript-eslint/no-explicit-any */
import { ALL_BODY_TARGETS } from '../../src/avatar/baseContract';
import type { GlbDoc } from '../glb/types';

/** The mesh and the material of a built hairstyle (build_base.py export_hair). */
export const HAIR = 'Hair';
/** Spec §12: textures ≤1024². */
export const HAIR_TEXTURE_SIZE = 1024;

/** The names of the nodes the doc's skins use as joints: the bones of the rig it was exported with. */
export function jointNames(doc: GlbDoc): string[] {
  const joints = new Set<number>(doc.json.skins.flatMap((skin: any) => skin.joints));
  return [...joints].map((j) => doc.json.nodes[j]?.name).filter((n) => typeof n === 'string');
}

/** [width, height] from a PNG's or WebP's header, or null for any other format. */
function imageSize(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.byteLength >= 24 && ascii(1, 3) === 'PNG') {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes.byteLength >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const u24 = (at: number) => view.getUint16(at, true) | (view.getUint8(at + 2) << 16);
    switch (ascii(12, 4)) {
      case 'VP8X': // extended (alpha): the canvas size, minus one, in 24 bits each
        return [u24(24) + 1, u24(27) + 1];
      case 'VP8 ': // lossy: 14 bits each after the frame tag and start code
        return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
      case 'VP8L': {
        // lossless: 14 bits each, minus one, after the signature byte
        const bits = view.getUint32(21, true);
        return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      }
    }
  }
  return null;
}

/**
 * Validates a built hairstyle: one mesh, Hair, skinned to bones of the base (`baseBoneNames`), with every
 * body target; one material, Hair, alphaMode MASK; images ≤1024². Returns one line per problem; empty =
 * valid.
 */
export function validateHair(doc: GlbDoc, baseBoneNames: string[]): string[] {
  const json = doc.json;
  const problems: string[] = [];

  const meshes: any[] = json.meshes;
  if (meshes.length !== 1 || meshes[0].name !== HAIR) {
    problems.push(`expected one mesh, ${HAIR}; found [${meshes.map((m) => m.name).join(', ')}]`);
  }
  const mesh = meshes[0];
  if (!mesh) return problems;

  const node = json.nodes.find((n: any) => n.mesh === 0);
  if (node?.skin === undefined) problems.push(`mesh ${mesh.name} has no skin`);
  else {
    const bones = new Set(baseBoneNames);
    for (const j of json.skins[node.skin].joints) {
      const name = json.nodes[j]?.name;
      if (!bones.has(name)) problems.push(`joint ${name} is not a bone of the base`);
    }
  }

  const targetNames: string[] = mesh.extras?.targetNames ?? [];
  for (const t of ALL_BODY_TARGETS) {
    if (!targetNames.includes(t))
      problems.push(`body morph target ${t} is missing on ${mesh.name}`);
  }

  const used = new Set<number>(mesh.primitives.map((p: any) => p.material));
  const materials = [...used].map((i) => json.materials[i]);
  if (materials.length !== 1 || materials[0]?.name !== HAIR) {
    problems.push(
      `expected one material, ${HAIR}; found [${materials.map((m) => m?.name).join(', ')}]`,
    );
  }
  for (const m of materials) {
    if (m && m.alphaMode !== 'MASK') {
      problems.push(`material ${m.name} alphaMode is ${m.alphaMode ?? 'OPAQUE'}, expected MASK`);
    }
  }

  json.images.forEach((image: any, index: number) => {
    const name = image.name ?? `#${index}`;
    const view = json.bufferViews[image.bufferView];
    if (!view) {
      problems.push(`image ${name} is not embedded`);
      return;
    }
    const start = view.byteOffset ?? 0;
    const size = imageSize(doc.bin.subarray(start, start + view.byteLength));
    if (!size) problems.push(`image ${name} is neither PNG nor WebP`);
    else if (Math.max(...size) > HAIR_TEXTURE_SIZE) {
      problems.push(`image ${name} is ${size.join('×')}, over ${HAIR_TEXTURE_SIZE}²`);
    }
  });

  return problems;
}
