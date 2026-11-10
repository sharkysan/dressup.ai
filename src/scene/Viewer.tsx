import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { WebGLRenderer } from 'three';
import { loadCatalog } from '../catalog/catalog';
import { AvatarModel } from '../avatar/AvatarModel';
import { BASE_URL } from '../avatar/baseContract';
import { useAppStore } from '../store/useAppStore';
import { strings } from '../ui/strings';
import { Framing } from './Framing';
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

/**
 * A renderer on a context without an alpha channel. three always asks for one, and with alpha-to-coverage
 * (the hair's soft edges) the fragment alpha is also written to it: the page then shows through every
 * partly covered strand edge as a pale line, on screen and in the exported PNG. The backdrop is opaque anyway.
 */
function createRenderer(defaults: { canvas: unknown }) {
  const canvas = defaults.canvas as HTMLCanvasElement;
  const context = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
  }) as WebGL2RenderingContext;
  return new WebGLRenderer({ canvas, context, antialias: true });
}

const BACKDROP_COLOR = '#e9e5dc';

export function Viewer() {
  const status = useAppStore((s) => s.avatarStatus);
  const setCatalog = useAppStore((s) => s.setCatalog);

  useEffect(() => {
    loadCatalog()
      .then(setCatalog)
      .catch((error: unknown) => console.warn('catalog unavailable; hairstyles disabled:', error));
  }, [setCatalog]);

  return (
    <div
      data-testid="viewer"
      data-status={status}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.85, 3.3], fov: 30 }} gl={createRenderer}>
        {/* The backdrop lives in the GL scene so exports show exactly what the screen shows. */}
        <color attach="background" args={[BACKDROP_COLOR]} />
        <hemisphereLight intensity={1.2} groundColor="#8a8070" />
        <directionalLight position={[2, 4, 3]} intensity={1.5} />
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping={false}
          minDistance={0.4}
          maxDistance={5}
        />
        <Framing />
        <AvatarModel key={BASE_URL} url={BASE_URL} />
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
