import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnalysisError, analyzePhoto, type AnalyzeResult } from '../../src/analysis/analyze';
import { analyzeToParams } from '../../src/analysis/mapping';
import { faceBox, toPixels } from '../../src/analysis/landmarks';
import { FACE_LANDMARKS, type Correspondence } from '../../src/likeness/correspondence';
import type { Likeness } from '../../src/likeness/types';
import { useAppStore } from '../../src/store/useAppStore';
import { AnalysisPage } from '../../src/ui/dev/AnalysisPage';
import { strings } from '../../src/ui/strings';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

vi.mock('../../src/analysis/analyze', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/analysis/analyze')>();
  return { ...mod, analyzePhoto: vi.fn() };
});
vi.mock('../../src/scene/Viewer', () => ({ Viewer: () => <div data-testid="viewer" /> }));
vi.mock('../../src/likeness/correspondence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/likeness/correspondence')>()),
  loadCorrespondence: () =>
    Promise.resolve({ canonical: new Array(3 * 468).fill(0) } as unknown as Correspondence),
}));

const fx = synthFace();
const box = faceBox(toPixels(fx.face));
const result = analyzeToParams(
  { face: fx.face, mask: fx.mask, image: fx.image, faceBox: box },
  { catalog: null },
);

const base: AnalyzeResult = {
  ...result,
  face: fx.face,
  mask: fx.mask,
  preview: document.createElement('canvas'),
  faceBox: box,
  pose: null,
  body: { gate: 'no_pose', measurement: null },
  likeness: null,
  likenessGate: 'too_small',
  likenessDebug: null,
};

const likeness = (n: number): Likeness => ({
  version: 1,
  faceTexture: new Blob([new Uint8Array([n])], { type: 'image/webp' }),
  headOffsets: new Float32Array(3),
  sourceSkin: '#c68642',
});

const withLikeness = (l: Likeness): AnalyzeResult => ({
  ...base,
  params: { ...base.params, face: 'photo' },
  likeness: l,
  likenessGate: 'ok',
  likenessDebug: {
    residualRmsMm: 3.25,
    maxOffsetMm: 7.5,
    aligned: new Float32Array(3 * FACE_LANDMARKS),
    ms: { fit: 118.4, project: 96.6, encode: 31.2 },
  },
});

function upload() {
  const input = screen.getByTestId('photo-input') as HTMLInputElement;
  const file = new File([new Uint8Array([1])], 'me.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
}

let urls = 0;

beforeEach(() => {
  useAppStore.getState().reset();
  vi.mocked(analyzePhoto).mockReset();
  // jsdom has neither object URLs nor a 2D canvas.
  urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:face-${++urls}`);
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
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

test('a successful analysis applies params and marks done', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(base);
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-analysis', 'done');
  // Whole-object equality: skin alone is vacuous because the fixture's default skin equals defaultParams.skin.
  expect(useAppStore.getState().params).toEqual(result.params);
});

test('the calibration controls and ratio table are gone', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(base);
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(screen.queryByText('Add to calibration set')).toBeNull();
  expect(screen.queryByText('Export calibration.json')).toBeNull();
  expect(screen.queryByTestId('calibration-count')).toBeNull();
  expect(screen.queryAllByTestId(/^ratio-/)).toHaveLength(0);
});

test('with a likeness, the page shows the face texture, the gate line, the timings and the fit overlay', async () => {
  const l = likeness(1);
  vi.mocked(analyzePhoto).mockResolvedValue(withLikeness(l));
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');

  expect(URL.createObjectURL).toHaveBeenCalledWith(l.faceTexture);
  const texture = screen.getByTestId('face-texture');
  expect(texture).toHaveAttribute('src', 'blob:face-1');
  expect(screen.getByText(/the face lies on its side/i)).toBeInTheDocument();
  expect(screen.getByTestId('likeness-gate')).toHaveTextContent(strings.analysis.likenessOk);
  const timings = screen.getByTestId('likeness-timings');
  expect(timings).toHaveTextContent('fit 118 ms');
  expect(timings).toHaveTextContent('project 97 ms');
  expect(timings).toHaveTextContent('encode 31 ms');
  expect(timings).toHaveTextContent('residual RMS 3.3 mm');
  expect(timings).toHaveTextContent('max offset 7.5 mm');
  const overlay = screen.getByTestId('fit-overlay') as HTMLCanvasElement;
  expect([overlay.width, overlay.height]).toEqual([256, 256]);
  // The analysis puts the likeness on the avatar.
  expect(useAppStore.getState().likeness).toBe(l);
  expect(useAppStore.getState().params.face).toBe('photo');
});

test('a face too small for a photo face says so, and shows no face texture', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(base);
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(strings.analysis.likenessTooSmall).toBe(
    'Face too small for a photo face — using the default face',
  );
  expect(screen.getByTestId('likeness-gate')).toHaveTextContent(strings.analysis.likenessTooSmall);
  expect(screen.queryByTestId('face-texture')).toBeNull();
  expect(screen.queryByTestId('fit-overlay')).toBeNull();
  expect(useAppStore.getState().likeness).toBeNull();
});

test('a photo face that failed to build says so; the params still apply, with the default face', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue({ ...base, likenessGate: 'failed' });
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(strings.analysis.likenessFailed).toBe(
    "Couldn't build a photo face — using the default face",
  );
  expect(screen.getByTestId('likeness-gate')).toHaveTextContent(strings.analysis.likenessFailed);
  expect(screen.queryByTestId('face-texture')).toBeNull();
  expect(screen.queryByTestId('fit-overlay')).toBeNull();
  expect(screen.getByTestId('analysis-status')).toHaveAttribute('data-analysis', 'done');
  expect(useAppStore.getState().likeness).toBeNull();
  expect(useAppStore.getState().params).toEqual(base.params);
  expect(base.params.face).toBe('default');
});

test('Apply to avatar also sets the likeness', async () => {
  const l = likeness(1);
  vi.mocked(analyzePhoto).mockResolvedValue(withLikeness(l));
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  act(() => useAppStore.getState().setLikeness(null));
  act(() => useAppStore.getState().setParams({ skin: '#010203' }));
  fireEvent.click(screen.getByText('Apply to avatar'));
  expect(useAppStore.getState().likeness).toBe(l);
  expect(useAppStore.getState().params.face).toBe('photo');
  expect(useAppStore.getState().params.skin).toBe(withLikeness(l).params.skin);
});

test("the face texture's object URL is revoked when the result changes and on unmount", async () => {
  vi.mocked(analyzePhoto)
    .mockResolvedValueOnce(withLikeness(likeness(1)))
    .mockResolvedValueOnce(withLikeness(likeness(2)));
  const view = render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => upload());
  expect(screen.getByTestId('face-texture')).toHaveAttribute('src', 'blob:face-2');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:face-1');
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:face-2');
});
