import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { useEffect, useRef } from 'react';
import { findHair } from '../catalog/catalog';
import { useAppStore } from '../store/useAppStore';
import { applyBodyMorphs } from './body';
import { loadGlb } from './loadGlb';
import { attachSkinned, type Attachment } from './skinnedAttach';

/** Every standard material in the loaded hair (the GLB's MASK cutout and double-sidedness are kept). */
function hairMaterials(root: Object3D): MeshStandardMaterial[] {
  const found = new Set<MeshStandardMaterial>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (m instanceof MeshStandardMaterial) found.add(m);
    }
  });
  return [...found];
}

/** The texture is neutral grey, so the colour multiplies it into the hair tint; the MASK cutout gets soft edges from alpha-to-coverage (the textures are alpha-bled, so no pale fringe). */
function tintHair(material: MeshStandardMaterial, hex: string): void {
  material.color.set(hex);
  material.alphaToCoverage = true;
}

const warned = new Set<string>();

/**
 * Loads the hairstyle `hairId` from the catalog, attaches it to the avatar's head and tints it.
 * 'none' or an unknown id → bald (unknown ids warn once). Re-tints on colour change without reloading.
 */
export function HairModel({
  vrm,
  hairId,
  hairColor,
}: {
  vrm: VRM;
  hairId: string;
  hairColor: string;
}) {
  const catalog = useAppStore((s) => s.catalog);
  // Materials are captured before attach: attachSkinned re-parents the meshes out of the loaded root.
  const current = useRef<{ attachment: Attachment; materials: MeshStandardMaterial[] } | null>(
    null,
  );
  // Latest colour, readable from the load callback so a change mid-load is not lost.
  const colorRef = useRef(hairColor);
  colorRef.current = hairColor;

  useEffect(() => {
    let cancelled = false;
    const entry = hairId === 'none' || !catalog ? undefined : findHair(catalog, hairId);
    if (hairId !== 'none' && catalog && !entry && !warned.has(hairId)) {
      console.warn(`hairstyle "${hairId}" is not in the catalog; showing no hair`);
      warned.add(hairId);
    }
    if (!entry) return;

    loadGlb(entry.url)
      .then((root) => {
        if (cancelled) {
          VRMUtils.deepDispose(root);
          return;
        }
        const materials = hairMaterials(root);
        for (const m of materials) tintHair(m, colorRef.current);
        const attachment = attachSkinned(vrm, root);
        current.current = { attachment, materials };
        applyBodyMorphs(vrm.scene, useAppStore.getState().params.body);
        useAppStore.getState().setAttachedHair(hairId);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn(`hairstyle "${hairId}" could not be attached:`, error);
      });

    return () => {
      cancelled = true;
      current.current?.attachment.detach();
      current.current = null;
      useAppStore.getState().setAttachedHair('none');
    };
    // hairColor is applied in the effect below so a colour change never reloads the mesh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrm, hairId, catalog]);

  useEffect(() => {
    for (const m of current.current?.materials ?? []) tintHair(m, hairColor);
  }, [hairColor]);

  return null;
}
