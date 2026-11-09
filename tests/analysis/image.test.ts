import { DecodeError, decodePhoto, fitWithin } from '../../src/analysis/image';

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
  vi.unstubAllGlobals();
});
