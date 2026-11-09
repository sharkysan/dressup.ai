/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeJson, type GlbDoc } from './types';

const MTOON_TEXTURES = [
  'shadeMultiplyTexture',
  'shadingShiftTexture',
  'matcapTexture',
  'rimMultiplyTexture',
  'outlineWidthMultiplyTexture',
  'uvAnimationMaskTexture',
];
const PBR_TEXTURES = ['baseColorTexture', 'metallicRoughnessTexture'];
const MATERIAL_TEXTURES = ['normalTexture', 'occlusionTexture', 'emissiveTexture'];

/**
 * Removes materials, textures, images, samplers, accessors and bufferViews nothing references,
 * rebuilds the BIN, and remaps every known reference site (glTF core + VRM extensions).
 * Nodes, meshes and skins are never removed.
 */
export function pruneUnused(input: GlbDoc): GlbDoc {
  const json = normalizeJson(structuredClone(input.json));

  // 1. Materials referenced by primitives.
  const usedMaterials = new Set<number>();
  for (const mesh of json.meshes)
    for (const p of mesh.primitives) if (p.material !== undefined) usedMaterials.add(p.material);
  const materialMap = remap(json.materials.length, usedMaterials);
  // VRM 0.x keeps a materialProperties array aligned with materials — filter it identically.
  const vrm0 = json.extensions?.VRM;
  if (Array.isArray(vrm0?.materialProperties)) {
    vrm0.materialProperties = vrm0.materialProperties.filter((_: unknown, i: number) =>
      usedMaterials.has(i),
    );
  }
  json.materials = json.materials.filter((_: unknown, i: number) => usedMaterials.has(i));
  for (const mesh of json.meshes)
    for (const p of mesh.primitives)
      if (p.material !== undefined) p.material = materialMap.get(p.material)!;

  // 2. Textures referenced by surviving materials.
  const usedTextures = new Set<number>();
  forEachTextureInfo(json.materials, (info) => usedTextures.add(info.index));
  forEachVrm0TextureRef(json, (i) => usedTextures.add(i));
  const textureMap = remap(json.textures.length, usedTextures);
  json.textures = json.textures.filter((_: unknown, i: number) => usedTextures.has(i));
  forEachTextureInfo(json.materials, (info) => (info.index = textureMap.get(info.index)!));
  forEachVrm0TextureRef(json, (i, set) => set(textureMap.get(i)!));

  // 3. Images and samplers referenced by surviving textures, plus the VRM thumbnail.
  const usedImages = new Set<number>();
  const usedSamplers = new Set<number>();
  for (const t of json.textures) {
    if (t.source !== undefined) usedImages.add(t.source);
    if (t.sampler !== undefined) usedSamplers.add(t.sampler);
  }
  const meta = json.extensions?.VRMC_vrm?.meta;
  if (meta?.thumbnailImage !== undefined) usedImages.add(meta.thumbnailImage);
  const imageMap = remap(json.images.length, usedImages);
  const samplerMap = remap(json.samplers.length, usedSamplers);
  json.images = json.images.filter((_: unknown, i: number) => usedImages.has(i));
  json.samplers = json.samplers.filter((_: unknown, i: number) => usedSamplers.has(i));
  for (const t of json.textures) {
    if (t.source !== undefined) t.source = imageMap.get(t.source)!;
    if (t.sampler !== undefined) t.sampler = samplerMap.get(t.sampler)!;
  }
  if (meta?.thumbnailImage !== undefined) meta.thumbnailImage = imageMap.get(meta.thumbnailImage)!;

  // 4. Accessors referenced by primitives, skins and animations.
  const usedAccessors = new Set<number>();
  forEachAccessorRef(json, (i) => usedAccessors.add(i));
  const accessorMap = remap(json.accessors.length, usedAccessors);
  json.accessors = json.accessors.filter((_: unknown, i: number) => usedAccessors.has(i));
  forEachAccessorRef(json, (i, set) => set(accessorMap.get(i)!));

  // 5. BufferViews referenced by surviving accessors and images → rebuild BIN.
  const usedViews = new Set<number>();
  for (const a of json.accessors) {
    if (a.bufferView !== undefined) usedViews.add(a.bufferView);
    if (a.sparse) {
      usedViews.add(a.sparse.indices.bufferView);
      usedViews.add(a.sparse.values.bufferView);
    }
  }
  for (const im of json.images) if (im.bufferView !== undefined) usedViews.add(im.bufferView);
  for (const key of Object.keys(json)) {
    if (['accessors', 'images', 'bufferViews', 'buffers'].includes(key)) continue;
    const value = json[key];
    if (
      Array.isArray(value) &&
      value.some((v) => v && typeof v === 'object' && 'bufferView' in v)
    ) {
      throw new Error(`pruneUnused: unsupported bufferView reference in "${key}"`);
    }
  }
  const viewMap = remap(json.bufferViews.length, usedViews);
  const newViews: any[] = [];
  let bin = new Uint8Array(0);
  for (const [oldIndex] of [...viewMap.entries()].sort((a, b) => a[1] - b[1])) {
    const bv = json.bufferViews[oldIndex]!;
    const start = bv.byteOffset ?? 0;
    const bytes = input.bin.subarray(start, start + bv.byteLength);
    const offset = bin.byteLength;
    const padded = (bytes.byteLength + 3) & ~3;
    const next = new Uint8Array(offset + padded);
    next.set(bin, 0);
    next.set(bytes, offset);
    bin = next;
    newViews.push({ ...bv, byteOffset: offset });
  }
  json.bufferViews = newViews;
  for (const a of json.accessors) {
    if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView)!;
    if (a.sparse) {
      a.sparse.indices.bufferView = viewMap.get(a.sparse.indices.bufferView)!;
      a.sparse.values.bufferView = viewMap.get(a.sparse.values.bufferView)!;
    }
  }
  for (const im of json.images)
    if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView)!;
  json.buffers = [{ byteLength: bin.byteLength }];

  return { json, bin };
}

/** old index → new index for the kept members, in ascending old order. */
function remap(length: number, kept: Set<number>): Map<number, number> {
  const map = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < length; i++) if (kept.has(i)) map.set(i, next++);
  return map;
}

function forEachTextureInfo(materials: any[], fn: (info: { index: number }) => void): void {
  for (const m of materials) {
    for (const k of PBR_TEXTURES) if (m.pbrMetallicRoughness?.[k]) fn(m.pbrMetallicRoughness[k]);
    for (const k of MATERIAL_TEXTURES) if (m[k]) fn(m[k]);
    const mtoon = m.extensions?.VRMC_materials_mtoon;
    if (mtoon) for (const k of MTOON_TEXTURES) if (mtoon[k]) fn(mtoon[k]);
  }
}

/** VRM 0.x stores texture indices in materialProperties[].textureProperties and meta.texture. */
function forEachVrm0TextureRef(
  json: any,
  fn: (index: number, set: (v: number) => void) => void,
): void {
  const vrm0 = json.extensions?.VRM;
  if (!vrm0) return;
  if (vrm0.meta?.texture !== undefined && vrm0.meta.texture >= 0)
    fn(vrm0.meta.texture, (v) => (vrm0.meta.texture = v));
  for (const mp of vrm0.materialProperties ?? []) {
    const tp = mp.textureProperties ?? {};
    for (const k of Object.keys(tp))
      if (typeof tp[k] === 'number' && tp[k] >= 0) fn(tp[k], (v) => (tp[k] = v));
  }
}

function forEachAccessorRef(
  json: any,
  fn: (index: number, set: (v: number) => void) => void,
): void {
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      for (const k of Object.keys(p.attributes)) fn(p.attributes[k], (v) => (p.attributes[k] = v));
      if (p.indices !== undefined) fn(p.indices, (v) => (p.indices = v));
      for (const t of p.targets ?? []) for (const k of Object.keys(t)) fn(t[k], (v) => (t[k] = v));
    }
  }
  for (const s of json.skins ?? [])
    if (s.inverseBindMatrices !== undefined)
      fn(s.inverseBindMatrices, (v) => (s.inverseBindMatrices = v));
  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers) {
      fn(s.input, (v) => (s.input = v));
      fn(s.output, (v) => (s.output = v));
    }
  }
}
