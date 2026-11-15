import type { VRM } from '@pixiv/three-vrm';
import { MathUtils } from 'three';

/**
 * Lowers the arms from the base's T-pose by `degrees`, for the body calibration's renders: the
 * normalised left upper arm turns by −degrees about z and the right by +degrees, replacing their
 * rotation. `vrm.update()` copies the normalised bones to the raw ones on the next frame.
 */
export function setArmsDown(vrm: VRM, degrees: number): void {
  const angle = MathUtils.degToRad(degrees);
  vrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0, 0, -angle);
  vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0, 0, angle);
}
