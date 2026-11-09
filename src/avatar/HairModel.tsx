import { VRMUtils, type MToonMaterial, type VRM } from '@pixiv/three-vrm';
import { useEffect, useRef } from 'react';
import { findHair } from '../catalog/catalog';
import { useAppStore } from '../store/useAppStore';
import { loadGlbWithMToon } from './loadGlb';
import { materialsBySuffix, tintMaterial } from './materials';
import { attachSkinned, type Attachment } from './skinnedAttach';

/** VRoid names hair materials '*_HAIR'; other tools often just 'hair'. */
function hairMaterials(root: Parameters<typeof materialsBySuffix>[0]): MToonMaterial[] {
  return [...new Set([...materialsBySuffix(root, '_HAIR'), ...materialsBySuffix(root, 'hair')])];
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
  const current = useRef<{ attachment: Attachment; materials: MToonMaterial[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const entry = hairId === 'none' || !catalog ? undefined : findHair(catalog, hairId);
    if (hairId !== 'none' && catalog && !entry && !warned.has(hairId)) {
      console.warn(`hairstyle "${hairId}" is not in the catalog; showing no hair`);
      warned.add(hairId);
    }
    if (!entry) return;

    loadGlbWithMToon(entry.url)
      .then((root) => {
        if (cancelled) {
          VRMUtils.deepDispose(root);
          return;
        }
        const materials = hairMaterials(root);
        for (const m of materials) tintMaterial(m, hairColor);
        const attachment = attachSkinned(vrm, root);
        current.current = { attachment, materials };
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn(`hairstyle "${hairId}" could not be attached:`, error);
      });

    return () => {
      cancelled = true;
      current.current?.attachment.detach();
      current.current = null;
    };
    // hairColor is applied in the effect below so a colour change never reloads the mesh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vrm, hairId, catalog]);

  useEffect(() => {
    for (const m of current.current?.materials ?? []) tintMaterial(m, hairColor);
  }, [hairColor]);

  return null;
}
