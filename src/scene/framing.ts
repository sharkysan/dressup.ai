import type { AvatarParams } from '../catalog/params';

export type AvatarMetrics = { headY: number; height: number };

export type CameraPose = { position: [number, number, number]; target: [number, number, number] };

const FOV_DEG = 30;

/**
 * Camera pose for a framing (spec §9): `full` fits the whole body with margin, `portrait` frames
 * head and shoulders. Falls back to a ~1.6 m avatar when metrics are unknown.
 */
export function cameraFor(
  framing: AvatarParams['scene']['framing'],
  metrics: AvatarMetrics | null,
): CameraPose {
  const height = metrics?.height ?? 1.6;
  const headY = metrics?.headY ?? height * 0.89;
  const halfFov = (FOV_DEG / 2) * (Math.PI / 180);
  if (framing === 'portrait') {
    const y = headY + 0.08; // eyes sit a little above the head bone
    const distance = 0.32 / Math.tan(halfFov); // ~0.64 m of vertical coverage
    return { position: [0, y, distance], target: [0, y, 0] };
  }
  const y = height * 0.53;
  const distance = (height * 1.15) / 2 / Math.tan(halfFov);
  return { position: [0, y, distance], target: [0, y, 0] };
}
