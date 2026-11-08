import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import { useFrame } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { loadVrm } from './loadVrm';

/** Loads a VRM, reports status to the store, and ticks the VRM every frame. Mount with `key={url}`. */
export function AvatarModel({ url }: { url: string }) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const setAvatarStatus = useAppStore((s) => s.setAvatarStatus);

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

  useFrame((_, delta) => {
    vrm?.update(delta);
  });

  return vrm ? <primitive object={vrm.scene} /> : null;
}
