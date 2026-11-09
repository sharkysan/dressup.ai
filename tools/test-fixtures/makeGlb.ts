import { PNG } from 'pngjs';
import { appendAccessor } from '../glb/accessors';
import type { GlbDoc } from '../glb/types';

/**
 * Builds a tiny VRoid-shaped GLB for unit tests: skinned 'Body' and 'Face' meshes (optional 'Hair'),
 * a 3-joint skeleton (J_Bip_C_Hips → J_Bip_C_Head → J_Sec_Hair1_01), one 2×2 PNG per material,
 * VRMC_vrm humanoid/meta/expressions, and a VRMC_springBone spring on the hair joint.
 */
export function makeGlb(opts: { withHair?: boolean; morphTargets?: number } = {}): GlbDoc {
  const { withHair = false, morphTargets = 0 } = opts;
  const doc: GlbDoc = {
    json: {
      asset: { version: '2.0', generator: 'makeGlb' },
      extensionsUsed: ['VRMC_vrm', 'VRMC_materials_mtoon', 'VRMC_springBone'],
      scene: 0,
      scenes: [{ nodes: [0, 1, 2, 3] }],
      nodes: [
        { name: 'Body', mesh: 0, skin: 0 },
        { name: 'Face', mesh: 1, skin: 0 },
        { name: 'Hair', ...(withHair ? { mesh: 2, skin: 0 } : {}) },
        { name: 'J_Bip_C_Hips', translation: [0, 1, 0], children: [4] },
        { name: 'J_Bip_C_Head', translation: [0, 0.5, 0], children: [5] },
        { name: 'J_Sec_Hair1_01', translation: [0, 0.1, 0] },
      ],
      buffers: [{ byteLength: 0 }],
      bufferViews: [],
      accessors: [],
      meshes: [],
      skins: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [{ magFilter: 9729, minFilter: 9729 }],
      extensions: {
        VRMC_vrm: {
          specVersion: '1.0',
          meta: { name: 'fixture', licenseUrl: 'https://vrm.dev/licenses/1.0/', thumbnailImage: 0 },
          humanoid: { humanBones: { hips: { node: 3 }, head: { node: 4 } } },
          expressions: {
            preset: {
              happy:
                morphTargets > 0 ? { morphTargetBinds: [{ node: 1, index: 0, weight: 1 }] } : {},
            },
          },
        },
        VRMC_springBone: {
          specVersion: '1.0',
          springs: [{ name: 'hair', joints: [{ node: 5, hitRadius: 0.01 }] }],
        },
      },
    },
    bin: new Uint8Array(0),
  };

  // Thumbnail image first (index 0), as VRoid does.
  addImage(doc, 'Thumbnail', [0, 0, 0, 255]);

  const ibm = appendAccessor(
    doc,
    new Float32Array(identity().concat(identity(), identity())),
    'MAT4',
  );
  doc.json.skins.push({ joints: [3, 4, 5], inverseBindMatrices: ibm });

  const bodyPrims = [
    prim(doc, 'Body_00_SKIN', [200, 150, 130, 255]),
    prim(doc, 'Tops_01_CLOTH', [40, 40, 200, 255]),
  ];
  if (withHair) bodyPrims.push(prim(doc, 'HairBack_00_HAIR', [90, 50, 20, 255]));
  doc.json.meshes.push({ name: 'Body', primitives: bodyPrims });

  const facePrim = prim(doc, 'Face_00_SKIN', [210, 160, 140, 255]);
  const faceMesh: Record<string, unknown> = { name: 'Face', primitives: [facePrim] };
  if (morphTargets > 0) {
    const names: string[] = [];
    facePrim.targets = [];
    for (let i = 0; i < morphTargets; i++) {
      names.push(`Fcl_ALL_${i}`);
      const zeros = new Float32Array(4 * 3);
      facePrim.targets.push({ POSITION: appendAccessor(doc, zeros, 'VEC3', { minMax: true }) });
    }
    faceMesh.extras = { targetNames: names };
  }
  doc.json.meshes.push(faceMesh);

  if (withHair) {
    doc.json.meshes.push({
      name: 'Hair',
      primitives: [prim(doc, 'Hair_00_HAIR', [90, 50, 20, 255])],
    });
  }

  return doc;
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** A single quad (4 vertices, 2 triangles) skinned to joint 1 (head) with weight 1. */
function prim(doc: GlbDoc, materialName: string, rgba: [number, number, number, number]) {
  const positions = new Float32Array([-0.1, 0, 0, 0.1, 0, 0, 0.1, 0.2, 0, -0.1, 0.2, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const joints = new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const materialIndex = addMaterial(doc, materialName, rgba);
  return {
    attributes: {
      POSITION: appendAccessor(doc, positions, 'VEC3', { minMax: true, target: 34962 }),
      NORMAL: appendAccessor(doc, normals, 'VEC3', { target: 34962 }),
      TEXCOORD_0: appendAccessor(doc, uvs, 'VEC2', { target: 34962 }),
      JOINTS_0: appendAccessor(doc, joints, 'VEC4', { target: 34962 }),
      WEIGHTS_0: appendAccessor(doc, weights, 'VEC4', { target: 34962 }),
    },
    indices: appendAccessor(doc, indices, 'SCALAR', { target: 34963 }),
    material: materialIndex,
    mode: 4,
  } as {
    attributes: Record<string, number>;
    indices: number;
    material: number;
    mode: number;
    targets?: Record<string, number>[];
  };
}

function addMaterial(doc: GlbDoc, name: string, rgba: [number, number, number, number]): number {
  const imageIndex = addImage(doc, name.replace(/_[A-Z]+$/, ''), rgba);
  doc.json.textures.push({ source: imageIndex, sampler: 0 });
  const textureIndex = doc.json.textures.length - 1;
  doc.json.materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: { index: textureIndex },
    },
    alphaMode: 'OPAQUE',
    extensions: {
      VRMC_materials_mtoon: {
        specVersion: '1.0',
        shadeColorFactor: [0.9, 0.6, 0.7],
        shadeMultiplyTexture: { index: textureIndex },
      },
    },
  });
  return doc.json.materials.length - 1;
}

function addImage(doc: GlbDoc, name: string, rgba: [number, number, number, number]): number {
  const png = solidPng(2, 2, rgba);
  const bufferView = appendBytes(doc, png);
  doc.json.images.push({ name, mimeType: 'image/png', bufferView });
  return doc.json.images.length - 1;
}

/** Appends raw bytes as a bufferView (4-byte aligned) and returns its index. */
export function appendBytes(doc: GlbDoc, bytes: Uint8Array): number {
  const offset = doc.bin.byteLength;
  const padded = (bytes.byteLength + 3) & ~3;
  const next = new Uint8Array(offset + padded);
  next.set(doc.bin, 0);
  next.set(bytes, offset);
  doc.bin = next;
  doc.json.buffers[0]!.byteLength = next.byteLength;
  doc.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
  return doc.json.bufferViews.length - 1;
}

export function solidPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set(rgba, i * 4);
  return new Uint8Array(PNG.sync.write(png));
}

export function decodePng(png: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const out = PNG.sync.read(Buffer.from(png));
  return { width: out.width, height: out.height, data: new Uint8Array(out.data) };
}
