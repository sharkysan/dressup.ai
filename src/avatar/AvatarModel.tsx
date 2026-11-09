import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useFrame } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { useAppStore } from '../store/useAppStore';
import { applyParams } from './applyParams';
import { BASE_META_URL, baseMetaSchema, type BaseMeta } from './baseContract';
import { applyBody } from './body';
import { HairModel } from './HairModel';
import { loadVrm } from './loadVrm';

/**
 * Loads a VRM, reports status to the store, applies AvatarParams whenever they change, mounts the
 * hairstyle, and ticks the VRM every frame. Mount with `key={url}` so a URL change remounts.
 */
export function AvatarModel({ url }: { url: string }) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [meta, setMeta] = useState<BaseMeta | null>(null);
  const setAvatarStatus = useAppStore((s) => s.setAvatarStatus);
  const setAvatarMetrics = useAppStore((s) => s.setAvatarMetrics);
  const hair = useAppStore((s) => s.params.hair);
  const hairColor = useAppStore((s) => s.params.hairColor);

  useEffect(() => {
    let cancelled = false;
    let loaded: VRM | null = null;
    setAvatarStatus('loading');

    Promise.all([loadVrm(url), loadMeta()])
      .then(([result, baseMeta]) => {
        if (cancelled) {
          VRMUtils.deepDispose(result.scene);
          return;
        }
        loaded = result;
        const { params } = useAppStore.getState();
        applyParams(result, params);
        applyBody(result, params.body, baseMeta);
        setAvatarMetrics(measure(result, params.body.heightCm));
        setMeta(baseMeta);
        setVrm(result);
        setAvatarStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAvatarStatus('error', error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      if (loaded) VRMUtils.deepDispose(loaded.scene);
    };
  }, [url, setAvatarStatus, setAvatarMetrics]);

  // Re-apply params on every store change once the model exists (cheap: absolute sets only).
  useEffect(() => {
    if (!vrm) return;
    return useAppStore.subscribe((state, previous) => {
      if (state.params !== previous.params) applyParams(vrm, state.params);
    });
  }, [vrm]);

  // Body shape, height and grounding; metrics follow because Box3 ignores morph targets.
  useEffect(() => {
    if (!vrm || !meta) return;
    return useAppStore.subscribe((state, previous) => {
      if (state.params.body === previous.params.body) return;
      applyBody(vrm, state.params.body, meta);
      setAvatarMetrics(measure(vrm, state.params.body.heightCm));
    });
  }, [vrm, meta, setAvatarMetrics]);

  useFrame((_, delta) => {
    vrm?.update(delta);
  });

  if (!vrm) return null;
  return (
    <>
      <primitive object={vrm.scene} />
      <HairModel vrm={vrm} hairId={hair} hairColor={hairColor} />
    </>
  );
}

async function loadMeta(): Promise<BaseMeta> {
  const response = await fetch(BASE_META_URL);
  if (!response.ok) throw new Error(`Failed to load ${BASE_META_URL}: HTTP ${response.status}`);
  return baseMetaSchema.parse(await response.json());
}

/** Head-bone world height and requested height in metres, for camera framing. */
function measure(vrm: VRM, heightCm: number): { headY: number; height: number } {
  vrm.scene.updateMatrixWorld(true);
  const head = vrm.humanoid?.getRawBoneNode('head');
  const headY = head ? head.getWorldPosition(new Vector3()).y : (heightCm / 100) * 0.89;
  return { headY, height: heightCm / 100 };
}
