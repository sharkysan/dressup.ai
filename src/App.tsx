import { useEffect } from 'react';
import { analyzePhoto } from './analysis/analyze';
import { loadModels } from './analysis/mediapipe';
import { supportsWebGL2 } from './scene/supportsWebGL2';
import { Viewer } from './scene/Viewer';
import { nodeScreenPoint } from './scene/viewerHandle';
import { useAppStore } from './store/useAppStore';
import { AnalysisPage } from './ui/dev/AnalysisPage';
import { isAnalysisRoute, isDevPanelEnabled } from './ui/dev/devFlag';
import { ParamsPanel } from './ui/dev/ParamsPanel';
import { ExportButton } from './ui/ExportButton';
import { strings } from './ui/strings';

declare global {
  interface Window {
    __kiss?: {
      store: typeof useAppStore;
      /** Dev/e2e hook into the analysis pipeline (only present with the dev flag). */
      analysis: { analyzePhoto: typeof analyzePhoto; loadModels: typeof loadModels };
      /** Dev/e2e: a scene node's position in canvas CSS pixels, with the canvas size. */
      nodeScreenPoint: typeof nodeScreenPoint;
    };
  }
}

export default function App() {
  const dev = isDevPanelEnabled();
  useEffect(() => {
    if (dev) {
      window.__kiss = {
        store: useAppStore,
        analysis: { analyzePhoto, loadModels },
        nodeScreenPoint,
      };
    }
  }, [dev]);

  if (!supportsWebGL2()) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <p>{strings.webglUnsupported}</p>
      </main>
    );
  }
  if (isAnalysisRoute()) {
    return (
      <main style={{ height: '100%' }}>
        <AnalysisPage />
      </main>
    );
  }
  return (
    <main style={{ height: '100%', position: 'relative' }}>
      <Viewer />
      {dev && <ParamsPanel />}
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <ExportButton />
      </div>
    </main>
  );
}
