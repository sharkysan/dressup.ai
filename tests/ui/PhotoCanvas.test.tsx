import { fireEvent, render, screen } from '@testing-library/react';
import { measureBody, personRegion, type BodyMeasurement } from '../../src/analysis/body/measure';
import type { PoseObservation } from '../../src/analysis/types';
import { PhotoCanvas } from '../../src/ui/dev/PhotoCanvas';
import { synthBody } from '../../tools/test-fixtures/body';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

/** A full-length figure in a 300 × 400 analysed image. */
const W = 300;
const H = 400;
const fx = synthBody({ width: W, height: H, centreX: 150, headTopY: 20, heightPx: 360 });
const face = synthFace().face;
/** The pose overlay's skeleton: 12 segments, each one moveTo. */
const SKELETON_SEGMENTS = 12;

/**
 * jsdom has no 2D canvas: a context that records the calls the overlays make. getImageData gives blank
 * pixels, so a tint's putImageData holds only that tint.
 */
function recordingContext() {
  return {
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(4 * w * h),
      width: w,
      height: h,
    })),
    putImageData: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
  };
}

let ctx: ReturnType<typeof recordingContext>;

beforeEach(() => {
  ctx = recordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function draw(pose: PoseObservation | null, measurement: BodyMeasurement | null) {
  const preview = document.createElement('canvas');
  preview.width = W;
  preview.height = H;
  render(
    <PhotoCanvas
      preview={preview}
      face={face}
      mask={fx.mask}
      faceBox={fx.faceBox}
      pose={pose}
      measurement={measurement}
    />,
  );
}

const boxOf = (b: { x: number; y: number; width: number; height: number }) => [
  b.x,
  b.y,
  b.width,
  b.height,
];

/** The pixels a tint's putImageData changed, as indices into the W × H image. */
function tinted(call: unknown[]): number[] {
  const data = (call[0] as { data: Uint8ClampedArray }).data;
  const out: number[] = [];
  for (let i = 0; i < W * H; i++) if (data[4 * i]! !== 0) out.push(i);
  return out;
}

test('without a measurement, a pose and a face box still draw the person region, and the silhouette tint within it', () => {
  draw(fx.pose, null);
  const region = personRegion(fx.pose, fx.faceBox, W, H);
  // The face box and the person region.
  expect(ctx.strokeRect.mock.calls).toEqual([boxOf(fx.faceBox), boxOf(region)]);
  // No measurement lines: only the skeleton's segments.
  expect(ctx.moveTo).toHaveBeenCalledTimes(SKELETON_SEGMENTS);
  // The hair tint only: the silhouette is off by default.
  expect(ctx.putImageData).toHaveBeenCalledTimes(1);

  ctx.putImageData.mockClear();
  fireEvent.click(screen.getByLabelText('silhouette'));
  expect(ctx.putImageData).toHaveBeenCalledTimes(2); // the hair, then the silhouette
  const silhouette = tinted(ctx.putImageData.mock.calls[1]!);
  expect(silhouette.length).toBeGreaterThan(0);
  for (const i of silhouette) {
    const [x, y] = [i % W, Math.floor(i / W)];
    expect(x + 1 > region.x && x < region.x + region.width).toBe(true);
    expect(y + 1 > region.y && y < region.y + region.height).toBe(true);
  }
});

test('with a measurement, its head-top, ankle and width lines are drawn too', () => {
  const measurement = measureBody({
    pose: fx.pose,
    mask: fx.mask,
    faceBox: fx.faceBox,
    headTopY: fx.headTopY,
    width: W,
    height: H,
  })!;
  draw(fx.pose, measurement);
  expect(ctx.strokeRect.mock.calls).toEqual([boxOf(fx.faceBox), boxOf(measurement.region)]);
  expect(ctx.moveTo).toHaveBeenCalledTimes(SKELETON_SEGMENTS + 2 + measurement.lines.length);
});

test('without a pose there is no region and no silhouette', () => {
  draw(null, null);
  expect(ctx.strokeRect.mock.calls).toEqual([boxOf(fx.faceBox)]);
  ctx.putImageData.mockClear();
  fireEvent.click(screen.getByLabelText('silhouette'));
  expect(ctx.putImageData).toHaveBeenCalledTimes(1); // the hair only
});
