import {
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
  type Texture,
} from 'three';
import type { AvatarParams } from '../catalog/params';
import { eyeTextureUrl } from './baseContract';

type EyePreset = AvatarParams['eyeColor'];

/** The first standard (PBR) material named `name` on any mesh under `root`. */
export function standardMaterial(root: Object3D, name: string): MeshStandardMaterial | undefined {
  let found: MeshStandardMaterial | undefined;
  root.traverse((node) => {
    if (found || !(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    found = materials.find(
      (m): m is MeshStandardMaterial => m instanceof MeshStandardMaterial && m.name === name,
    );
  });
  return found;
}

const loadTexture = (url: string) => new TextureLoader().loadAsync(url);

/**
 * The eye texture of each eye-colour preset (spec §7), loaded once and kept. `set` swaps the Eyes
 * material's map and nothing else, so its alpha mask (the cornea's alpha-0 disc) stays; the map it
 * first replaces, the base's own, is disposed. When loads finish out of order, the last preset asked
 * for wins; a failed load keeps the current map and is retried on the next request.
 */
export class EyeTextures {
  private readonly loads = new Map<EyePreset, Promise<Texture>>();
  private readonly loaded = new Set<Texture>();
  private readonly wanted = new WeakMap<MeshStandardMaterial, EyePreset>();
  private disposed = false;
  private readonly load: (url: string) => Promise<Texture>;

  /** `load` fetches one texture (injectable for tests). */
  constructor(load: (url: string) => Promise<Texture> = loadTexture) {
    this.load = load;
  }

  set(material: MeshStandardMaterial, preset: EyePreset): void {
    this.wanted.set(material, preset);
    this.texture(preset).then(
      (texture) => {
        if (this.disposed || this.wanted.get(material) !== preset) return;
        const previous = material.map;
        material.map = texture;
        if (previous && !this.loaded.has(previous)) previous.dispose();
      },
      (error: unknown) => console.warn(`eye texture "${preset}" could not be loaded:`, error),
    );
  }

  /** Disposes every loaded eye texture, and any that is still loading once it lands. */
  dispose(): void {
    this.disposed = true;
    for (const texture of this.loaded) texture.dispose();
    this.loaded.clear();
    this.loads.clear();
  }

  private texture(preset: EyePreset): Promise<Texture> {
    let load = this.loads.get(preset);
    if (!load) {
      load = this.load(eyeTextureUrl(preset)).then((texture) => {
        texture.flipY = false; // glTF UVs, as the Eyes map's were
        texture.colorSpace = SRGBColorSpace;
        if (this.disposed) texture.dispose();
        else this.loaded.add(texture);
        return texture;
      });
      load.catch(() => {
        if (this.loads.get(preset) === load) this.loads.delete(preset);
      });
      this.loads.set(preset, load);
    }
    return load;
  }
}
