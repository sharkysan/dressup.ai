/* eslint-disable @typescript-eslint/no-explicit-any */
import { appendAccessor, readAccessor } from './accessors';
import { isHairMaterialName, isHairMeshName } from './hairNames';
import { findHumanBoneNode, HUMAN_BONE_EXTRA } from './humanoid';
import { pruneUnused } from './prune';
import { getImage, neutralizeImage, replaceImage, resizeAllImages } from './textures';
import { normalizeJson, type GlbDoc } from './types';

const HAIR_MESH = 'Hair';
const KEPT_EXTENSIONS = [
  'VRMC_materials_mtoon',
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'EXT_texture_webp',
];

/**
 * Builds a standalone hairstyle GLB from a VRoid VRM (spec §7/§8): the 'Hair' mesh primitives plus
 * Body primitives with *_HAIR materials, re-skinned so every vertex follows the head bone only
 * (no spring-bone physics in v1), with greyscale textures for runtime tinting.
 *
 * Output structure: nodes [0: scene root, 1: joint 'head' tagged extras.humanBone='head', 2: 'Hair' mesh node],
 * one skin { joints: [1], inverseBindMatrices: the source head joint's IBM }, one mesh.
 */
export function extractHair(
  input: GlbDoc,
  opts: { headBoneName?: string; maxTexture?: number } = {},
): GlbDoc {
  const headBoneName = opts.headBoneName ?? 'J_Bip_C_Head';
  const maxTexture = opts.maxTexture ?? 1024;
  const src = input.json;

  // 1. Collect hair primitives from every mesh.
  type Prim = {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
    targets?: unknown[];
  };
  const hairPrims: { prim: Prim; meshIndex: number }[] = [];
  src.meshes.forEach((mesh: { name?: string; primitives: Prim[] }, meshIndex: number) => {
    for (const prim of mesh.primitives) {
      const materialName =
        prim.material === undefined ? '' : String(src.materials[prim.material].name ?? '');
      if (isHairMeshName(mesh.name) || isHairMaterialName(materialName))
        hairPrims.push({ prim, meshIndex });
    }
  });
  if (hairPrims.length === 0)
    throw new Error('no hair found (no "Hair" mesh and no *_HAIR materials)');

  // 2. Find the head joint's inverse bind matrix in the skin that drives a hair mesh.
  // Resolve the head via the VRM humanoid map (works for any bone naming); fall back to the VRoid name.
  let headNodeIndex = findHumanBoneNode(src, 'head');
  if (headNodeIndex < 0)
    headNodeIndex = src.nodes.findIndex((n: { name?: string }) => n.name === headBoneName);
  if (headNodeIndex < 0) throw new Error(`no humanoid head bone and no node named ${headBoneName}`);
  // Any hair mesh's skin that contains the head joint gives us the head's inverse bind matrix.
  const hairMeshIndices = new Set(hairPrims.map((h) => h.meshIndex));
  const hairSkins = src.nodes
    .filter(
      (n: { mesh?: number; skin?: number }) =>
        n.mesh !== undefined && hairMeshIndices.has(n.mesh) && n.skin !== undefined,
    )
    .map((n: { skin: number }) => src.skins[n.skin]);
  const skin = hairSkins.find((s: { joints: number[] }) => s.joints.includes(headNodeIndex));
  if (!skin) throw new Error(`${headBoneName} is not a joint of any hair skin`);
  const headSlot = skin.joints.indexOf(headNodeIndex);
  const ibms = readAccessor(input, skin.inverseBindMatrices) as Float32Array;
  const headIbm = ibms.slice(headSlot * 16, headSlot * 16 + 16);

  // 3. Assemble the output document, copying the referenced resources by index (prune compacts later).
  const json = normalizeJson({
    asset: { version: '2.0', generator: 'kiss build-hair' },
    extensionsUsed: (src.extensionsUsed ?? []).filter((e: string) => KEPT_EXTENSIONS.includes(e)),
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'HairRoot', children: [1, 2] },
      { name: 'head', extras: { [HUMAN_BONE_EXTRA]: 'head' } },
      { name: HAIR_MESH, mesh: 0, skin: 0 },
    ],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
    materials: structuredClone(src.materials),
    textures: structuredClone(src.textures),
    images: structuredClone(src.images),
    samplers: structuredClone(src.samplers),
  });
  const doc: GlbDoc = { json, bin: new Uint8Array(0) };
  // Images keep their bytes: copy every image bufferView into the new BIN.
  for (const image of doc.json.images) {
    if (image.bufferView === undefined) continue;
    const bytes = getImage(input, image.name);
    replaceImage(doc, image.name, bytes);
  }

  const ibmAccessor = appendAccessor(doc, headIbm, 'MAT4');
  doc.json.skins.push({ joints: [1], inverseBindMatrices: ibmAccessor });

  const primitives = hairPrims.map(({ prim }) => {
    const attributes: Record<string, number> = {};
    for (const [key, accessorIndex] of Object.entries(prim.attributes)) {
      if (key === 'JOINTS_0' || key === 'WEIGHTS_0') continue;
      const data = readAccessor(input, accessorIndex);
      const type = src.accessors[accessorIndex].type;
      attributes[key] = appendAccessor(doc, data, type, {
        minMax: key === 'POSITION',
        target: 34962,
      });
    }
    const vertexCount = src.accessors[prim.attributes.POSITION!].count as number;
    const joints = new Uint16Array(vertexCount * 4); // all zeros → joint 0 = head
    const weights = new Float32Array(vertexCount * 4);
    for (let v = 0; v < vertexCount; v++) weights[v * 4] = 1;
    attributes.JOINTS_0 = appendAccessor(doc, joints, 'VEC4', { target: 34962 });
    attributes.WEIGHTS_0 = appendAccessor(doc, weights, 'VEC4', { target: 34962 });
    const out: Prim = { attributes, material: prim.material, mode: prim.mode ?? 4 };
    if (prim.indices !== undefined) {
      out.indices = appendAccessor(doc, readAccessor(input, prim.indices), 'SCALAR', {
        target: 34963,
      });
    }
    return out;
  });
  doc.json.meshes.push({ name: HAIR_MESH, primitives });

  // 4. Greyscale + resize the hair textures (base colour of each hair material).
  const done = new Set<string>();
  for (const prim of primitives) {
    if (prim.material === undefined) continue;
    const material = doc.json.materials[prim.material];
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (textureIndex === undefined) continue;
    const image = doc.json.images[doc.json.textures[textureIndex].source];
    if (!image?.name || done.has(image.name)) continue;
    replaceImage(doc, image.name, neutralizeImage(getImage(doc, image.name), 'luminance'));
    done.add(image.name);
  }

  resizeAllImages(doc, maxTexture);

  // 5. Drop VRM-only material extensions that reference nothing here, then compact.
  for (const material of doc.json.materials) {
    if (material.extensions) {
      for (const key of Object.keys(material.extensions)) {
        if (!KEPT_EXTENSIONS.includes(key)) delete material.extensions[key];
      }
      if (Object.keys(material.extensions).length === 0) delete material.extensions;
    }
  }
  return pruneUnused(doc);
}
