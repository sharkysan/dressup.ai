import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { Mesh, MeshStandardMaterial, SkinnedMesh, type Object3D } from 'three';
import { useEffect, useRef } from 'react';
import { findHair } from '../catalog/catalog';
import { applyLikeness } from '../likeness/likenessMorph';
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

/** The meshes attachSkinned moves onto the avatar. */
function skinnedMeshes(root: Object3D): SkinnedMesh[] {
  const found: SkinnedMesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof SkinnedMesh) found.push(obj);
  });
  return found;
}

/**
 * The likeness morph on the hair (spec §7), through each mesh's head binding. A failure leaves the hair
 * as it was (applyLikeness checks before it changes anything) and warns.
 */
function followLikeness(hairId: string, meshes: SkinnedMesh[], offsets: Float32Array | null) {
  try {
    for (const mesh of meshes) applyLikeness(mesh, offsets);
  } catch (error) {
    console.warn(`hairstyle "${hairId}" cannot follow the photo face:`, error);
  }
}

const warned = new Set<string>();

/**
 * Loads the hairstyle `hairId` from the catalog, attaches it to the avatar's head, tints it and gives
 * it the body shape and the likeness morph (`likenessOffsets`: the likeness's offsets of every Body
 * vertex, or null). 'none' or an unknown id → bald (unknown ids warn once). Re-tints on colour change
 * and follows a new likeness without reloading.
 */
export function HairModel({
  vrm,
  hairId,
  hairColor,
  likenessOffsets,
}: {
  vrm: VRM;
  hairId: string;
  hairColor: string;
  likenessOffsets: Float32Array | null;
}) {
  const catalog = useAppStore((s) => s.catalog);
  // Captured before attach: attachSkinned re-parents the meshes out of the loaded root.
  const current = useRef<{
    attachment: Attachment;
    materials: MeshStandardMaterial[];
    meshes: SkinnedMesh[];
  } | null>(null);
  // Latest colour and likeness, readable from the load callback so a change mid-load is not lost.
  const colorRef = useRef(hairColor);
  colorRef.current = hairColor;
  const likenessRef = useRef(likenessOffsets);
  likenessRef.current = likenessOffsets;

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
        const meshes = skinnedMeshes(root);
        for (const m of materials) tintHair(m, colorRef.current);
        const attachment = attachSkinned(vrm, root);
        current.current = { attachment, materials, meshes };
        applyBodyMorphs(vrm.scene, useAppStore.getState().params.body);
        followLikeness(hairId, meshes, likenessRef.current);
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

  useEffect(() => {
    if (current.current) followLikeness(hairId, current.current.meshes, likenessOffsets);
    // A new hairId reloads, and its attach applies the latest likeness itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likenessOffsets]);

  return null;
}
