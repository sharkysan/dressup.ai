import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnalysisError, analyzePhoto } from '../../src/analysis/analyze';
import { DEFAULT_CALIBRATION } from '../../src/analysis/calibration';
import { analyzeToParams } from '../../src/analysis/mapping';
import { faceBox, toPixels } from '../../src/analysis/landmarks';
import { useAppStore } from '../../src/store/useAppStore';
import { AnalysisPage } from '../../src/ui/dev/AnalysisPage';
import { strings } from '../../src/ui/strings';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

vi.mock('../../src/analysis/analyze', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/analysis/analyze')>();
  return { ...mod, analyzePhoto: vi.fn() };
});
vi.mock('../../src/scene/Viewer', () => ({ Viewer: () => <div data-testid="viewer" /> }));

const fx = synthFace();
const box = faceBox(toPixels(fx.face));
const result = analyzeToParams(
  { face: fx.face, mask: fx.mask, image: fx.image, faceBox: box },
  { calibration: DEFAULT_CALIBRATION, catalog: null, base: 'a' },
);

function upload() {
  const input = screen.getByTestId('photo-input') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'me.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.mocked(analyzePhoto).mockReset();
});

test('idle state shows the privacy line and the input', () => {
  render(<AnalysisPage />);
  expect(screen.getByText(strings.analysis.privacy)).toBeInTheDocument();
  expect(screen.getByTestId('photo-input')).toBeInTheDocument();
  expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-analysis', 'idle');
});

test('a models failure shows the message and a retry button', async () => {
  vi.mocked(analyzePhoto).mockRejectedValue(new AnalysisError('models', 'offline'));
  render(<AnalysisPage />);
  await act(async () => upload());
  expect(await screen.findByText(strings.analysis.modelsFailed)).toBeInTheDocument();
  expect(screen.getByText(strings.analysis.retry)).toBeInTheDocument();
  expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-analysis', 'error');
});

test('a successful analysis applies params, shows ratios and marks done', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue({
    ...result,
    face: fx.face,
    mask: fx.mask,
    preview: document.createElement('canvas'),
    faceBox: box,
  });
  render(<AnalysisPage />);
  await act(async () => upload());
  expect(await screen.findByTestId('ratio-faceAspect')).toBeInTheDocument();
  expect(screen.getAllByTestId(/^ratio-/)).toHaveLength(8);
  expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-analysis', 'done');
  // Whole-object equality: skin alone is vacuous because the fixture's default skin equals defaultParams.skin.
  expect(useAppStore.getState().params).toEqual(result.params);
});

test('Add to calibration set increments the counter', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue({
    ...result,
    face: fx.face,
    mask: fx.mask,
    preview: document.createElement('canvas'),
    faceBox: box,
  });
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByTestId('ratio-faceAspect');
  fireEvent.click(screen.getByText('Add to calibration set'));
  expect(screen.getByTestId('calibration-count')).toHaveTextContent('1');
});
