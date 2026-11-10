import type { Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Loads a plain GLB (hairstyles, garments) as a scene graph. */
export async function loadGlb(url: string): Promise<Group> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to load GLB ${url}: ${detail}`, { cause });
  }
}
