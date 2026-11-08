import { render, screen } from '@testing-library/react';
import App from '../src/App';
import { supportsWebGL2 } from '../src/scene/supportsWebGL2';
import { strings } from '../src/ui/strings';

vi.mock('../src/scene/supportsWebGL2', () => ({ supportsWebGL2: vi.fn() }));
vi.mock('../src/scene/Viewer', () => ({ Viewer: () => <div data-testid="viewer" /> }));

const mocked = vi.mocked(supportsWebGL2);

test('shows the WebGL message when unsupported', () => {
  mocked.mockReturnValue(false);
  render(<App />);
  expect(screen.getByText(strings.webglUnsupported)).toBeInTheDocument();
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('renders the viewer when supported', () => {
  mocked.mockReturnValue(true);
  render(<App />);
  expect(screen.getByTestId('viewer')).toBeInTheDocument();
});
