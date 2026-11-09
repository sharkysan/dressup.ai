import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useFrame } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { applyParams } from './applyParams';
import { HairModel } from './HairModel';
import { loadVrm } from './loadVrm';

/**
 * Loads a VRM, reports status to the store, applies AvatarParams whenever they change, mounts the
 * hairstyle, and ticks the VRM every frame. Mount with `key={url}` so a URL change remounts.
 */
export function AvatarModel({ url }: { url: string }) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const setAvatarStatus = useAppStore((s) => s.setAvatarStatus);
  const hair = useAppStore((s) => s.params.hair);
  const hairColor = useAppStore((s) => s.params.hairColor);

  useEffect(() => {
    let cancelled = false;
    let loaded: VRM | null = null;
    setAvatarStatus('loading');

    loadVrm(url)
      .then((result) => {
        if (cancelled) {
          VRMUtils.deepDispose(result.scene);
          return;
        }
        loaded = result;
        applyParams(result, useAppStore.getState().params);
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
  }, [url, setAvatarStatus]);

  // Re-apply params on every store change once the model exists (cheap: absolute sets only).
  useEffect(() => {
    if (!vrm) return;
    return useAppStore.subscribe((state, previous) => {
      if (state.params !== previous.params) applyParams(vrm, state.params);
    });
  }, [vrm]);

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
