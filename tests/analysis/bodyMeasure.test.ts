import {
  BODY_FEATURES,
  headTopFactor,
  headTopY,
  MEASURE,
  measureBody,
  personRegion,
  WIDTH_FEATURES,
  type BodyFeature,
} from '../../src/analysis/body/measure';
import { MASK, type FaceObservation, type PoseObservation } from '../../src/analysis/types';
import {
  headCorrespondence,
  synthBody,
  type SynthBodyOptions,
} from '../../tools/test-fixtures/body';

function measure(opts: SynthBodyOptions = {}) {
  const fx = synthBody(opts);
  const m = measureBody({
    pose: fx.pose,
    mask: fx.mask,
    faceBox: fx.faceBox,
    headTopY: fx.headTopY,
    width: fx.mask.width,
    height: fx.mask.height,
  });
  return { fx, m };
}

const LINEAR = BODY_FEATURES.filter((f) => f !== 'area');
const TORSO: BodyFeature[] = ['bustWidth', 'waistWidth', 'hipWidth'];

test('the feature lists: ten features, the first seven widths', () => {
  expect(BODY_FEATURES).toHaveLength(10);
  expect(WIDTH_FEATURES).toEqual(BODY_FEATURES.slice(0, 7));
  expect(MEASURE.gapFraction).toBe(0.01);
});

test('a clear figure: every width and length within 1 px of the drawn one, the area within 1 %', () => {
  const { fx, m } = measure();
  expect(m.heightPx).toBe(800);
  expect(m.headTopY).toBe(100);
  expect(m.ankleY).toBeCloseTo(900, 9);
  for (const f of LINEAR) {
    expect(Math.abs(m.features[f] - fx.expected[f]), f).toBeLessThanOrEqual(1 / m.heightPx);
  }
  expect(Math.abs(m.features.area / fx.expected.area - 1)).toBeLessThan(0.01);
  expect(m.armsTouching).toEqual({ left: false, right: false });
  // Where each width was measured: a row per torso band, the perpendicular on each side per limb.
  const lines = (f: BodyFeature) => m.lines.filter((l) => l.feature === f).length;
  expect(WIDTH_FEATURES.map(lines)).toEqual([1, 1, 1, 1, 2, 2, 2]);
});

test.each(['leftTouching', 'bothTouching'] as const)(
  'arms %s: the bust, waist and hip widths stay within 1 px of the clear figure’s',
  (arms) => {
    const clear = measure().m;
    const { m } = measure({ arms });
    for (const f of TORSO) {
      expect(Math.abs(m.features[f] - clear.features[f]), f).toBeLessThanOrEqual(1 / m.heightPx);
    }
    expect(m.armsTouching).toEqual({ left: true, right: arms === 'bothTouching' });
  },
);

test('hair past the shoulders leaves the shoulder and bust widths and the area unchanged', () => {
  const bald = measure().m;
  const { fx, m } = measure({ hairPastShoulders: true });
  expect(fx.mask.data).not.toEqual(synthBody().mask.data);
  expect(m.features.shoulderWidth).toBe(bald.features.shoulderWidth);
  expect(m.features.bustWidth).toBe(bald.features.bustWidth);
  expect(m.features.area).toBe(bald.features.area);
});

test('a second person beside the figure, outside its region, changes no feature', () => {
  const alone = measure().m;
  const { fx, m } = measure({ secondPerson: true });
  expect(fx.mask.data).not.toEqual(synthBody().mask.data);
  expect(m.features).toEqual(alone.features);
});

test('touching legs: the thigh width is still the thigh’s', () => {
  const { fx, m } = measure({ legsTouching: true });
  expect(Math.abs(m.features.thighWidth - fx.expected.thighWidth)).toBeLessThanOrEqual(
    1 / m.heightPx,
  );
});

test('a background gap down the torso is bridged up to 1 % of the height, even at the midline', () => {
  const { fx, m } = measure();
  /** The bust width with a background stripe `w` px wide down the midline (x 300), over the bust band. */
  const striped = (w: number) => {
    const data = fx.mask.data.slice();
    for (let y = 300; y < 380; y++) {
      for (let x = 300 - w / 2; x < 300 + w / 2; x++) data[y * fx.mask.width + x] = MASK.background;
    }
    const mask = { ...fx.mask, data };
    const input = { pose: fx.pose, mask, faceBox: fx.faceBox, headTopY: fx.headTopY };
    return measureBody({ ...input, width: mask.width, height: mask.height }).features.bustWidth;
  };
  expect(MEASURE.gapFraction * m.heightPx).toBe(8);
  expect(striped(6)).toBe(m.features.bustWidth);
  // Past the gap, the span ends at the stripe: only the half beside the nearest pixel is left.
  expect(striped(12) * m.heightPx).toBeLessThan((m.features.bustWidth * m.heightPx) / 2);
});

test('a mask at half the analysed size is resampled to it', () => {
  const { fx, m } = measure();
  const half = {
    width: fx.mask.width / 2,
    height: fx.mask.height / 2,
    data: new Uint8Array((fx.mask.width / 2) * (fx.mask.height / 2)),
  };
  for (let y = 0; y < half.height; y++) {
    for (let x = 0; x < half.width; x++) {
      half.data[y * half.width + x] = fx.mask.data[2 * y * fx.mask.width + 2 * x]!;
    }
  }
  const coarse = measureBody({
    pose: fx.pose,
    mask: half,
    faceBox: fx.faceBox,
    headTopY: fx.headTopY,
    width: fx.mask.width,
    height: fx.mask.height,
  });
  // Each edge moves by at most one analysed pixel.
  for (const f of WIDTH_FEATURES) {
    expect(Math.abs(coarse.features[f] - m.features[f]), f).toBeLessThanOrEqual(2 / m.heightPx);
  }
  expect(Math.abs(coarse.features.area / m.features.area - 1)).toBeLessThan(0.01);
});

test('headTopFactor: the skull top above landmark 10, over the distance from 152 to 10', () => {
  expect(headTopFactor(headCorrespondence())).toBeCloseTo(0.4, 12);
});

test('headTopY raises landmark 10 by the factor × the distance from 10 to 152', () => {
  const face = (top: { x: number; y: number }, chin: { x: number; y: number }): FaceObservation => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
    landmarks[10] = { x: top.x / 400, y: top.y / 500, z: 0 };
    landmarks[152] = { x: chin.x / 400, y: chin.y / 500, z: 0 };
    return { landmarks, matrix: [], blendshapes: {}, imageWidth: 400, imageHeight: 500 };
  };
  expect(headTopY(face({ x: 100, y: 200 }, { x: 100, y: 300 }), 0.4)).toBeCloseTo(160, 9);
  // A tilted head: the distance, not its height, is scaled.
  expect(headTopY(face({ x: 130, y: 200 }, { x: 100, y: 240 }), 0.4)).toBeCloseTo(180, 9);
});

test('personRegion: the 2.5× face box ∪ the landmarks’ box, grown by 10 % of its height', () => {
  const pose: PoseObservation = {
    landmarks: Array.from({ length: 33 }, (_, i) => ({
      x: (i % 2 ? 400 : 600) / 1000,
      y: (i < 11 ? 150 : 900) / 1000,
      z: 0,
      visibility: 1,
    })),
    world: [],
    imageWidth: 1000,
    imageHeight: 1000,
  };
  // The face box grown 2.5×: x 375..625, y 25..275. With the landmarks: y 25..900, 875 px high.
  const region = personRegion(pose, { x: 450, y: 100, width: 100, height: 100 }, 1000, 1000);
  expect(region.x).toBeCloseTo(287.5, 9);
  expect(region.y).toBe(0); // 25 − 87.5, inside the image
  expect(region.x + region.width).toBeCloseTo(712.5, 9);
  expect(region.y + region.height).toBeCloseTo(987.5, 9);
});
