import { MToonMaterial } from '@pixiv/three-vrm';
import { Mesh, type Material, type Object3D } from 'three';
import { hexToOklab, oklabToHex, shadeFor } from '../color/oklab';

/** Unique MToon materials on meshes under `root` whose name ends with `suffix` (VRoid naming). */
export function materialsBySuffix(root: Object3D, suffix: string): MToonMaterial[] {
  return uniqueMaterials(root).filter(
    (m): m is MToonMaterial => m instanceof MToonMaterial && m.name.endsWith(suffix),
  );
}

/** Unique MToon materials whose name starts with `prefix`. */
export function materialsByPrefix(root: Object3D, prefix: string): MToonMaterial[] {
  return uniqueMaterials(root).filter(
    (m): m is MToonMaterial => m instanceof MToonMaterial && m.name.startsWith(prefix),
  );
}

function uniqueMaterials(root: Object3D): Material[] {
  const seen = new Set<Material>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) seen.add(m);
  });
  return [...seen];
}

/** Sets the lit colour and a derived darker shade colour (spec §7). */
export function tintMaterial(material: MToonMaterial, hex: string): void {
  material.color.set(hex);
  material.shadeColorFactor.set(shadeFor(hex));
}

/** Perceptual (OKLab) mix of two hex colours; t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  return oklabToHex({
    L: la.L + (lb.L - la.L) * t,
    a: la.a + (lb.a - la.a) * t,
    b: la.b + (lb.b - la.b) * t,
  });
}
