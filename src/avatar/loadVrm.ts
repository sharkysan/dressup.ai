import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads a VRM 0.x/1.0 file and prepares it for the viewer: unnecessary vertices removed,
 * skeletons combined, scene rotated to face +Z. Rejects with an Error naming the URL.
 */
export async function loadVrm(url: string, onProgress?: (fraction: number) => void): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(url, (event) => {
      if (onProgress && event.total > 0) onProgress(event.loaded / event.total);
    });
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error('file contains no VRM extension');

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    return vrm;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to load VRM ${url}: ${detail}`, { cause });
  }
}
