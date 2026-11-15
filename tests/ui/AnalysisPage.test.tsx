import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnalysisError, analyzePhoto, type AnalyzeResult } from '../../src/analysis/analyze';
import { analyzeToParams } from '../../src/analysis/mapping';
import { faceBox, toPixels } from '../../src/analysis/landmarks';
import { FACE_LANDMARKS, type Correspondence } from '../../src/likeness/correspondence';
import type { Likeness } from '../../src/likeness/types';
import { useAppStore } from '../../src/store/useAppStore';
import { AnalysisPage } from '../../src/ui/dev/AnalysisPage';
import { strings } from '../../src/ui/strings';
import { downloadBlob } from '../../src/export/download';
import { BODY_FEATURES, type BodyMeasurement } from '../../src/analysis/body/measure';
import type { BodyGate } from '../../src/analysis/body/gate';
import type { PoseObservation } from '../../src/analysis/types';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

vi.mock('../../src/analysis/analyze', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/analysis/analyze')>();
  return { ...mod, analyzePhoto: vi.fn() };
});
vi.mock('../../src/export/download', () => ({ downloadBlob: vi.fn() }));
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

test.each([
  [new AnalysisError('face_too_small', 'face 87 px wide'), 'face_too_small'],
  [new AnalysisError('face_turned', 'yaw 31°, pitch -4°'), 'face_turned'],
  [new Error('segmenter failed'), 'segmenter failed'],
])(
  'a failure logs only the AnalysisError’s code, or another error’s message: %s',
  async (error, logged) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(analyzePhoto).mockRejectedValue(error);
    render(<AnalysisPage />);
    await act(async () => upload());
    await screen.findByText(strings.analysis.retry);
    expect(warn.mock.calls).toEqual([['analysis failed:', logged]]);
  },
);

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

const GATES: BodyGate[] = ['ok', 'no_pose', 'not_visible', 'turned'];

const pose: PoseObservation = {
  landmarks: Array.from({ length: 33 }, (_, i) => ({
    x: 0.5,
    y: i / 40,
    z: 0,
    visibility: 1,
  })),
  world: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 })),
  imageWidth: 100,
  imageHeight: 200,
};

const measurement: BodyMeasurement = {
  features: Object.fromEntries(
    BODY_FEATURES.map((f, i) => [f, 0.1234 + i]),
  ) as BodyMeasurement['features'],
  heightPx: 150,
  headTopY: 10,
  ankleY: 160,
  region: { x: 0, y: 0, width: 100, height: 200 },
  armsTouching: { left: false, right: false },
  lines: [],
};

const measured: AnalyzeResult = {
  ...base,
  pose,
  body: { gate: 'ok', measurement },
  params: {
    ...base.params,
    body: { ...base.params.body, gender: 0.25, weight: 0.5, muscle: -0.5, heightCm: 172 },
  },
};

test('the height input defaults to the store height and reaches analyzePhoto', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(base);
  render(<AnalysisPage />);
  const input = screen.getByTestId('height-input') as HTMLInputElement;
  expect(input).toHaveAttribute('min', '140');
  expect(input).toHaveAttribute('max', '210');
  expect(input.value).toBe(String(useAppStore.getState().params.body.heightCm));
  fireEvent.change(input, { target: { value: '182' } });
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(vi.mocked(analyzePhoto).mock.calls[0]![1]).toMatchObject({ heightCm: 182 });
});

test.each([
  ['', useAppStore.getState().params.body.heightCm],
  ['300', 210],
  ['100', 140],
])('the height input value %j reaches analyzePhoto as %d', async (typed, expected) => {
  vi.mocked(analyzePhoto).mockResolvedValue(base);
  render(<AnalysisPage />);
  fireEvent.change(screen.getByTestId('height-input'), { target: { value: typed } });
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(vi.mocked(analyzePhoto).mock.calls[0]![1]).toMatchObject({ heightCm: expected });
});

test.each(GATES)('the body gate line for %s', async (gate) => {
  vi.mocked(analyzePhoto).mockResolvedValue({ ...base, body: { gate, measurement: null } });
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(screen.getByTestId('body-gate')).toHaveTextContent(strings.analysis.bodyGate[gate]);
});

test('with a measurement, the body panel lists the ten features and the body parameters', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(measured);
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  BODY_FEATURES.forEach((f, i) =>
    expect(screen.getByTestId(`feature-${f}`)).toHaveTextContent((0.1234 + i).toFixed(3)),
  );
  expect(screen.getByTestId('body-morph-gender')).toHaveTextContent('0.25');
  expect(screen.getByTestId('body-morph-weight')).toHaveTextContent('0.50');
  expect(screen.getByTestId('body-morph-muscle')).toHaveTextContent('-0.50');
  expect(screen.getAllByTestId(/^body-morph-/)).toHaveLength(9);
});

test('without a measurement, no feature rows show', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(base);
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  expect(screen.queryAllByTestId(/^feature-/)).toHaveLength(0);
});

test('the recorded fixture includes the pose and the body gate', async () => {
  vi.mocked(analyzePhoto).mockResolvedValue(measured);
  render(<AnalysisPage />);
  await act(async () => upload());
  await screen.findByText('Apply to avatar');
  fireEvent.click(screen.getByText('Record fixture'));
  const blob = vi.mocked(downloadBlob).mock.calls[0]![0];
  const text = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsText(blob);
  });
  const fixture = JSON.parse(text);
  expect(fixture.pose).toEqual(pose);
  expect(fixture.body).toEqual({ gate: 'ok' });
});
