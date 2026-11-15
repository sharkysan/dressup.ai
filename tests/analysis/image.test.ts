import {
  cropCanvas,
  cropFace,
  DecodeError,
  decodePhoto,
  fitWithin,
} from '../../src/analysis/image';
import { HEAD_CROP } from '../../src/analysis/pose';

/** A stand-in ImageBitmap: its size and a spy on close(). */
function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };
}

/**
 * Stubs the canvas 2D context (jsdom has none): drawImage is recorded, and getImageData returns a
 * buffer of the requested size.
 */
function stubContext() {
  const drawImage = vi.fn();
  const context = {
    drawImage,
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(4 * width * height),
    }),
    imageSmoothingQuality: 'low',
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  return { context, drawImage };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('fitWithin downsizes the long edge to 1024 and keeps aspect', () => {
  expect(fitWithin(4032, 3024)).toEqual({ width: 1024, height: 768 });
});

test('fitWithin never upscales', () => {
  expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
});

test('fitWithin handles portrait', () => {
  expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024 });
});

test('decodePhoto rejects with DecodeError when the bitmap cannot be created', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('nope')));
  await expect(decodePhoto(new Blob([new Uint8Array([1])]))).rejects.toBeInstanceOf(DecodeError);
});

test('decodePhoto returns the downscaled copy and the full-resolution bitmap, still open', async () => {
  const bitmap = fakeBitmap(3000, 4000);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const { drawImage } = stubContext();
  const decoded = await decodePhoto(new Blob([new Uint8Array([1])]));
  expect(decoded.bitmap).toBe(bitmap);
  expect(bitmap.close).not.toHaveBeenCalled();
  expect([decoded.canvas.width, decoded.canvas.height]).toEqual([768, 1024]);
  expect([decoded.image.width, decoded.image.height]).toEqual([768, 1024]);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 768, 1024);
});

test('decodePhoto closes the bitmap when it cannot draw it', async () => {
  const bitmap = fakeBitmap(100, 100);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  await expect(decodePhoto(new Blob([new Uint8Array([1])]))).rejects.toBeInstanceOf(DecodeError);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

test('cropFace copies the rect at full resolution when it fits', () => {
  const { drawImage } = stubContext();
  const bitmap = fakeBitmap(3000, 4000);
  const rect = { x: 1000, y: 1200, width: 640, height: 800 };
  const { image, scale } = cropFace(bitmap, rect);
  expect(scale).toBe(1);
  expect([image.width, image.height]).toEqual([640, 800]);
  expect(image.data).toHaveLength(4 * 640 * 800);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 1000, 1200, 640, 800, 0, 0, 640, 800);
});

test('cropFace scales a rect larger than maxEdge down to it', () => {
  const { drawImage } = stubContext();
  const bitmap = fakeBitmap(6000, 8000);
  const rect = { x: 500, y: 600, width: 3000, height: 4000 };
  const { image, scale } = cropFace(bitmap, rect, 2048);
  expect(scale).toBeCloseTo(2048 / 4000, 12);
  expect([image.width, image.height]).toEqual([1536, 2048]);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 500, 600, 3000, 4000, 0, 0, 1536, 2048);
});

test('cropCanvas draws the rect at full resolution when it fits', () => {
  const { drawImage } = stubContext();
  const bitmap = fakeBitmap(3000, 4000);
  const canvas = cropCanvas(bitmap, { x: 1000.5, y: 400, width: 300, height: 300 });
  expect([canvas.width, canvas.height]).toEqual([300, 300]);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 1000.5, 400, 300, 300, 0, 0, 300, 300);
});

test('cropCanvas scales a rect larger than the head crop’s maxEdge down to it', () => {
  expect(HEAD_CROP.maxEdge).toBe(1024);
  const { drawImage } = stubContext();
  const bitmap = fakeBitmap(6000, 8000);
  const canvas = cropCanvas(bitmap, { x: 500, y: 600, width: 2048, height: 2048 });
  expect([canvas.width, canvas.height]).toEqual([1024, 1024]);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 500, 600, 2048, 2048, 0, 0, 1024, 1024);
});
