import {
  SkinTexture,
  bodyRoughness,
  composeBodyAlbedo,
  skinGain,
  type FaceComposite,
  type Pixels,
} from '../../src/avatar/bodyTexture';

/** The test's own transfer functions: an sRGB byte → linear, and linear → an sRGB byte (unrounded). */
const lin = (byte: number) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const enc = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const bytes = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const pixel = (out: Pixels, i: number) => [...out.data.slice(i * 4, i * 4 + 4)];
/** What the renderer shows at canvas texel `i`: the texel decoded, times the material colour (the gain). */
const rendered = (out: Pixels, i: number, gain: readonly number[]) =>
  [0, 1, 2].map((c) => enc(lin(out.data[i * 4 + c]!) * gain[c]!));

/** Each channel of `actual` within `tolerance` (bytes) of `expected`. */
function expectNear(actual: number[], expected: number[], tolerance: number, label?: string) {
  expected.forEach((v, c) =>
    expect(
      Math.abs(actual[c]! - v),
      `${label ?? ''} channel ${c}: ${actual} vs ${expected}`,
    ).toBeLessThanOrEqual(tolerance),
  );
}

describe('composeBodyAlbedo on a 2×1 image', () => {
  /** A 2×1 RGBA image (no canvas needed: composeBodyAlbedo only reads data, width and height). */
  const image = (a: number[], b: number[]) => ({
    data: new Uint8ClampedArray([...a, ...b]),
    width: 2,
    height: 1,
  });
  const skin = image([200, 100, 50, 255], [200, 100, 50, 255]);
  const clear = image([0, 0, 0, 0], [0, 0, 0, 0]);
  const gain = [1.5, 2, 2.5] as const;

  test('a clear base layer under a white tint leaves the skin as it is, opaque, whatever the gain', () => {
    const out = composeBodyAlbedo(skin, clear, '#ffffff', gain);
    expect(pixel(out, 0)).toEqual([200, 100, 50, 255]);
    expect(pixel(out, 1)).toEqual([200, 100, 50, 255]);
  });

  test('the tint multiplies the skin in linear light', () => {
    const out = composeBodyAlbedo(skin, clear, '#808080', gain);
    expectNear(
      pixel(out, 0),
      [200, 100, 50].map((v) => enc(lin(v) * lin(128))),
      0.5,
    );
    expect(out.data[3]).toBe(255);
  });

  test('an opaque base-layer texel renders as its own colour, whatever the tint', () => {
    const layer = image([233, 230, 225, 255], [0, 0, 0, 0]);
    for (const tint of ['#ffffff', '#5a3a24', '#000000']) {
      const out = composeBodyAlbedo(skin, layer, tint, gain);
      expectNear(rendered(out, 0, gain), [233, 230, 225], 2, tint);
      expect(out.data[3]).toBe(255);
    }
    expect(pixel(composeBodyAlbedo(skin, layer, '#000000', gain), 1)).toEqual([0, 0, 0, 255]);
  });

  test('a half-transparent base-layer texel lands halfway (sRGB) between the tinted skin and itself ÷ the gain', () => {
    const layer = image([0, 200, 250, 128], [0, 0, 0, 0]);
    const a = 128 / 255;
    const out = composeBodyAlbedo(skin, layer, '#ffffff', gain);
    expectNear(
      pixel(out, 0),
      [0, 1, 2].map(
        (c) => [200, 100, 50][c]! * (1 - a) + enc(lin([0, 200, 250][c]!) / gain[c]!) * a,
      ),
      0.5,
    );
    expect(out.data[3]).toBe(255);
  });

  test('writes into a given output and leaves the inputs untouched', () => {
    const layer = image([233, 230, 225, 255], [0, 0, 0, 0]);
    const out = image([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(composeBodyAlbedo(skin, layer, '#808080', gain, out)).toBe(out);
    expectNear(rendered(out, 0, gain), [233, 230, 225], 2);
    expect(pixel(skin, 0)).toEqual([200, 100, 50, 255]);
    expect(pixel(layer, 0)).toEqual([233, 230, 225, 255]);
  });

  test('rejects images of different sizes', () => {
    const wide = { data: new Uint8ClampedArray(16), width: 4, height: 1 };
    expect(() => composeBodyAlbedo(skin, wide, '#ffffff', gain)).toThrow(/size/);
    expect(() => skinGain(skin, wide)).toThrow(/size/);
  });
});

/**
 * A 16×16 synthetic body. The base layer: row 0 opaque (the light top left of x = 8, the dark shorts
 * from it), row 1 at half alpha, rows 2–15 clear. Under the clear rows the neutral skin spreads
 * symmetrically around MEDIAN, which exactly two of its 224 texels (the middle two) hold, so MEDIAN is
 * every channel's median; the two brightest are white highlights, above the 99th percentile. Under the
 * base layer the skin is black: the gain must not count it.
 */
const N = 16;
const at = (x: number, y: number) => y * N + x;
const MEDIAN = [188, 150, 120];
const SPREAD = [60, 50, 40];
const CLEAR = 2 * N;
const CLEAR_COUNT = N * N - CLEAR;
const MEDIAN_TEXEL = CLEAR + CLEAR_COUNT / 2 - 1;
const TOP = [233, 230, 225];
const SHORTS = [47, 47, 51];
const HALF = [40, 60, 200];

const neutral: Pixels = {
  data: new Uint8ClampedArray(N * N * 4),
  width: N,
  height: N,
};
for (let k = 0; k < CLEAR_COUNT; k++) {
  const d = (k - (CLEAR_COUNT - 1) / 2) / ((CLEAR_COUNT - 1) / 2);
  const texel =
    k >= CLEAR_COUNT - 2 ? [255, 255, 255] : MEDIAN.map((m, c) => m + Math.round(SPREAD[c]! * d));
  neutral.data.set([...texel, 255], (CLEAR + k) * 4);
}
for (let i = 0; i < CLEAR; i++) neutral.data[i * 4 + 3] = 255;

const baseLayer: Pixels = { data: new Uint8ClampedArray(N * N * 4), width: N, height: N };
for (let x = 0; x < N; x++) {
  baseLayer.data.set([...(x < 8 ? TOP : SHORTS), 255], at(x, 0) * 4);
  baseLayer.data.set([...HALF, 128], at(x, 1) * 4);
}
const gain = skinGain(neutral, baseLayer);

const TINTS = ['#c68642', '#8d5524', '#f1c27d'];

/**
 * The face: 8×8 texels on the canvas's top-right 8×8 square, one texel per canvas texel (canvas
 * (8 + x, y) is face (x, y)). Opaque FACE, but its left column is clear.
 */
const RECT = { u: 0.5, v: 0, size: 0.5 };
const FACE = [205, 150, 120];
const facePixels = (width: number, height: number, texel: (x: number, y: number) => number[]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(texel(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
};
const PLAIN_FACE = facePixels(8, 8, (x) => [...FACE, x === 0 ? 0 : 255]);
const face = (sourceSkin: string, pixels: Pixels = PLAIN_FACE, rect = RECT): FaceComposite => ({
  pixels,
  sourceSkin,
  rect,
});
/** The synthetic body composited for `tint`, with `withFace` over its skin if given. */
const compose = (tint: string, withFace?: FaceComposite) =>
  composeBodyAlbedo(neutral, baseLayer, tint, gain, undefined, withFace);
/** Two face colours for the resampling tests. */
const A = [220, 120, 90];
const B = [90, 160, 210];

test('skin gain: per channel, 1 / the median linear value under the clear base layer', () => {
  expect(pixel(neutral, MEDIAN_TEXEL).slice(0, 3)).toEqual(MEDIAN);
  gain.forEach((g, c) => expect(g).toBeCloseTo(1 / lin(MEDIAN[c]!), 12));
  expect(Math.min(...gain)).toBeGreaterThanOrEqual(1);
});

test('skin gain needs a clear texel', () => {
  const covered = { ...baseLayer, data: baseLayer.data.map((v, i) => (i % 4 === 3 ? 255 : v)) };
  expect(() => skinGain(neutral, covered)).toThrow(/clear/);
});

test("skin: the neutral's median texel renders as the tint", () => {
  for (const tint of TINTS) {
    const out = compose(tint);
    expectNear(rendered(out, MEDIAN_TEXEL, gain), bytes(tint), 2, tint);
  }
});

test('base layer: an opaque texel renders as the base layer, for any tint', () => {
  for (const tint of [...TINTS, '#ffffff', '#000000']) {
    const out = compose(tint);
    expectNear(rendered(out, at(3, 0), gain), TOP, 2, tint);
    expectNear(rendered(out, at(12, 0), gain), SHORTS, 2, tint);
  }
});

test('face: an opaque face texel at tint = sourceSkin renders as the face texel', () => {
  for (const tint of TINTS) {
    const out = compose(tint, face(tint));
    expectNear(rendered(out, at(12, 4), gain), FACE, 2, tint);
  }
});

test('face: at another tint it renders as face × tint / sourceSkin, in linear light', () => {
  for (const [tint, sourceSkin] of [
    ['#8d5524', '#c68642'],
    ['#c68642', '#f1c27d'],
    ['#f1c27d', '#c68642'],
  ] as const) {
    const out = compose(tint, face(sourceSkin));
    const t = bytes(tint);
    const s = bytes(sourceSkin);
    const expected = FACE.map((f, c) => enc((lin(f) * lin(t[c]!)) / lin(s[c]!)));
    expectNear(rendered(out, at(12, 4), gain), expected, 2, `${tint} from ${sourceSkin}`);
  }
});

test('face: over the skin by its alpha, only inside its square', () => {
  const bare = compose('#c68642');
  const out = compose('#c68642', face('#c68642'));
  expect(pixel(out, at(8, 4))).toEqual(pixel(bare, at(8, 4))); // the face's clear column
  for (const [x, y] of [
    [7, 4],
    [12, 8],
    [3, 12],
  ] as const) {
    expect(pixel(out, at(x, y)), `${x},${y}`).toEqual(pixel(bare, at(x, y)));
  }
  expect(pixel(out, at(12, 4))).not.toEqual(pixel(bare, at(12, 4)));
});

test('face: the base layer still wins where both are opaque', () => {
  for (const [tint, sourceSkin] of [
    ['#c68642', '#c68642'],
    ['#8d5524', '#f1c27d'],
  ] as const) {
    const out = compose(tint, face(sourceSkin));
    expectNear(rendered(out, at(12, 0), gain), SHORTS, 2, tint);
  }
});

test('face: resampled into its square of the canvas, rows down the canvas as down the texture', () => {
  // 16×16 texels on the 8×8 square: left half A, right half B; the top half opaque, the bottom clear.
  const pixels = facePixels(16, 16, (x, y) => [...(x < 8 ? A : B), y < 8 ? 255 : 0]);
  const bare = compose('#c68642');
  const out = compose('#c68642', face('#c68642', pixels));
  expectNear(rendered(out, at(9, 2), gain), A, 2, 'top left');
  expectNear(rendered(out, at(14, 3), gain), B, 2, 'top right');
  expect(pixel(out, at(9, 4))).toEqual(pixel(bare, at(9, 4)));
  expect(pixel(out, at(14, 6))).toEqual(pixel(bare, at(14, 6)));
});

test('face: resampled bilinearly, premultiplied, in linear light', () => {
  // The square half a canvas texel left of the grid: canvas x = 10 samples halfway between face
  // columns 2 and 3.
  const shifted = { u: 0.5 - 0.5 / N, v: 0, size: 0.5 };
  const stripes = facePixels(8, 8, (x) => [...(x % 2 ? B : A), 255]);
  const out = compose('#c68642', face('#c68642', stripes, shifted));
  expectNear(
    rendered(out, at(10, 4), gain),
    A.map((a, c) => enc((lin(a) + lin(B[c]!)) / 2)),
    2,
    'opaque',
  );
  // A clear texel's colour carries no weight: halfway to it is A at half alpha, over the skin.
  const holes = facePixels(8, 8, (x) => (x % 2 ? [0, 0, 0, 0] : [...A, 255]));
  const bare = compose('#c68642');
  const half = compose('#c68642', face('#c68642', holes, shifted));
  expectNear(
    pixel(half, at(10, 4)),
    A.map((a, c) => (pixel(bare, at(10, 4))[c]! + enc(lin(a) / gain[c]!)) / 2),
    1,
    'half alpha',
  );
});

test("no clipping: no skin texel at or below the neutral's 99th percentile reaches 255", () => {
  const clear = Array.from({ length: CLEAR_COUNT }, (_, k) => CLEAR + k);
  const p99 = [0, 1, 2].map((c) => {
    const sorted = clear.map((i) => neutral.data[i * 4 + c]!).sort((a, b) => a - b);
    return sorted[Math.floor(0.99 * (sorted.length - 1))]!;
  });
  expect(Math.max(...p99)).toBeLessThan(255);
  for (const tint of [...TINTS, '#f1d7c8', '#ffffff']) {
    const out = compose(tint);
    for (const i of clear) {
      for (let c = 0; c < 3; c++) {
        if (neutral.data[i * 4 + c]! <= p99[c]!) {
          expect(out.data[i * 4 + c], `${tint} texel ${i}`).toBeLessThan(255);
        }
      }
    }
  }
});

describe('SkinTexture', () => {
  /** jsdom has no 2D canvas: a stand-in context whose canvas holds the neutral skin; it records puts. */
  function stubCanvas() {
    const context = {
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: neutral.data.slice(),
        width,
        height,
      }),
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      putImageData: vi.fn<(image: Pixels) => void>(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
    return context;
  }

  afterEach(() => vi.restoreAllMocks());

  test('its gain is the skin gain of the skin image under the base layer', () => {
    stubCanvas();
    const skin = new SkinTexture({} as CanvasImageSource, baseLayer as ImageData, 0.5);
    expect(skin.gain).toEqual(gain);
  });

  test('update recomposites when the tint or the face object changes, and only then', () => {
    const context = stubCanvas();
    const skin = new SkinTexture({} as CanvasImageSource, baseLayer as ImageData, 0.5);
    const puts = () => context.putImageData.mock.calls.length;
    const version = () => skin.texture.version;

    const texture = skin.update('#c68642');
    expect(puts()).toBe(1);
    const v1 = version();
    expect(skin.update('#c68642')).toBe(texture);
    skin.update('#c68642', null);
    expect(puts()).toBe(1);
    expect(version()).toBe(v1);

    const f = face('#c68642');
    skin.update('#c68642', f);
    expect(puts()).toBe(2);
    expect(version()).toBeGreaterThan(v1);
    expect(context.putImageData.mock.calls[1]![0].data).toEqual(compose('#c68642', f).data);
    skin.update('#c68642', f);
    expect(puts()).toBe(2);
    const copy = { ...f }; // equal content, a new object
    skin.update('#c68642', copy);
    expect(puts()).toBe(3);
    skin.update('#8d5524', copy);
    expect(puts()).toBe(4);
    skin.update('#8d5524', copy);
    expect(puts()).toBe(4);
    skin.update('#8d5524');
    expect(puts()).toBe(5);
    expect(context.putImageData.mock.calls[4]![0].data).toEqual(compose('#8d5524').data);
  });
});

test('body roughness: the skin value where the base layer is clear, the garment value where it is opaque, by alpha between', () => {
  const layer = {
    data: new Uint8ClampedArray([0, 0, 0, 0, 47, 47, 51, 255, 233, 230, 225, 128]),
    width: 3,
    height: 1,
  };
  // RG pairs, the same roughness × 255 in both (G is the channel glTF and three.js read).
  expect([...bodyRoughness(layer, 0.5, 0.9)]).toEqual([128, 128, 230, 230, 179, 179]);
});

test('body roughness ignores the base-layer colour: only its alpha counts', () => {
  const a = { data: new Uint8ClampedArray([0, 0, 0, 200]), width: 1, height: 1 };
  const b = { data: new Uint8ClampedArray([255, 10, 99, 200]), width: 1, height: 1 };
  expect(bodyRoughness(a, 0.4, 0.9)).toEqual(bodyRoughness(b, 0.4, 0.9));
});
