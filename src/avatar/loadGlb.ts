import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import type { Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Loads a plain GLB whose materials may use VRMC_materials_mtoon (hairstyles, garments). */
export async function loadGlbWithMToon(url: string): Promise<Group> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  try {
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to load GLB ${url}: ${detail}`, { cause });
  }
}
