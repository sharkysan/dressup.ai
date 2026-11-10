import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useAppStore } from '../store/useAppStore';
import { cameraFor } from './cameraPose';

/** Applies the current framing to the camera and the default OrbitControls target. */
export function Framing() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const framing = useAppStore((s) => s.params.scene.framing);
  const metrics = useAppStore((s) => s.avatarMetrics);

  useEffect(() => {
    const pose = cameraFor(framing, metrics);
    camera.position.set(...pose.position);
    if (controls) {
      controls.target.set(...pose.target);
      controls.update();
    } else {
      camera.lookAt(...pose.target);
    }
  }, [camera, controls, framing, metrics]);

  return null;
}
