import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { AvatarModel } from '../avatar/AvatarModel';
import { BASE_A_URL } from '../avatar/loadVrm';
import { useAppStore } from '../store/useAppStore';
import { strings } from '../ui/strings';
import { setViewerHandle } from './viewerHandle';

/** Publishes the live renderer/scene/camera for the export module. */
function HandlePublisher() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    setViewerHandle({ gl, scene, camera });
    return () => setViewerHandle(null);
  }, [gl, scene, camera]);
  return null;
}

const BACKDROP_COLOR = '#e9e5dc';

export function Viewer() {
  const status = useAppStore((s) => s.avatarStatus);

  return (
    <div
      data-testid="viewer"
      data-status={status}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.0, 3.2], fov: 30 }} gl={{ antialias: true }}>
        {/* The backdrop lives in the GL scene so exports show exactly what the screen shows. */}
        <color attach="background" args={[BACKDROP_COLOR]} />
        <hemisphereLight intensity={1.2} groundColor="#8a8070" />
        <directionalLight position={[2, 4, 3]} intensity={1.5} />
        <OrbitControls enablePan={false} target={[0, 0.85, 0]} minDistance={0.8} maxDistance={5} />
        <AvatarModel key={BASE_A_URL} url={BASE_A_URL} />
        <HandlePublisher />
      </Canvas>
      {status === 'loading' && <p style={overlayStyle}>{strings.loadingAvatar}</p>}
      {status === 'error' && (
        <p role="alert" style={overlayStyle}>
          {strings.avatarLoadFailed}
        </p>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  margin: 0,
  padding: '8px 14px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.85)',
  fontSize: 14,
};
