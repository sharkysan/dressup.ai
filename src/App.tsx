import { supportsWebGL2 } from './scene/supportsWebGL2';
import { Viewer } from './scene/Viewer';
import { ExportButton } from './ui/ExportButton';
import { strings } from './ui/strings';

export default function App() {
  if (!supportsWebGL2()) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <p>{strings.webglUnsupported}</p>
      </main>
    );
  }
  return (
    <main style={{ height: '100%', position: 'relative' }}>
      <Viewer />
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <ExportButton />
      </div>
    </main>
  );
}
