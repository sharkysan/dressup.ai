import type { VRM } from '@pixiv/three-vrm';

/** The avatar's VRM while one is shown, published by AvatarModel for the dev calibration hook. */
let current: VRM | null = null;

export function setAvatarVrm(vrm: VRM | null): void {
  current = vrm;
}

export function getAvatarVrm(): VRM | null {
  return current;
}
