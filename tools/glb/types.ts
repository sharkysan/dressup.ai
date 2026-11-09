/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Loose glTF 2.0 JSON. Only the parts the toolkit touches are typed; everything else passes through.
 * All top-level arrays are present (readGlb and the fixtures normalise them) so callers need no null checks.
 */
export type GltfJson = Record<string, any> & {
  asset: { version: string; generator?: string };
  buffers: { byteLength: number; uri?: string }[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
  }[];
  accessors: any[];
  meshes: any[];
  nodes: any[];
  skins: any[];
  materials: any[];
  textures: any[];
  images: any[];
  samplers: any[];
  animations?: any[];
  extensions?: any;
  extensionsUsed?: string[];
};

export type GlbDoc = { json: GltfJson; bin: Uint8Array };

export const GLTF_ARRAYS = [
  'buffers',
  'bufferViews',
  'accessors',
  'meshes',
  'nodes',
  'skins',
  'materials',
  'textures',
  'images',
  'samplers',
] as const;

/** Ensures every top-level array exists. */
export function normalizeJson(json: Record<string, any>): GltfJson {
  for (const key of GLTF_ARRAYS) json[key] ??= [];
  if (json.buffers.length === 0) json.buffers.push({ byteLength: 0 });
  return json as GltfJson;
}
