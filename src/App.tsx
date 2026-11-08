import { supportsWebGL2 } from './scene/supportsWebGL2';
import { Viewer } from './scene/Viewer';
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
    <main style={{ height: '100%' }}>
      <Viewer />
    </main>
  );
}
