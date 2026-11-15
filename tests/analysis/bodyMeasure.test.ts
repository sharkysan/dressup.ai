import { checkBodyGate } from '../../src/analysis/body/gate';
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
import { POSE } from '../../src/analysis/pose';
import {
  MASK,
  type CategoryMask,
  type FaceObservation,
  type PoseObservation,
} from '../../src/analysis/types';
import {
  headCorrespondence,
  synthBody,
  type SynthBody,
  type SynthBodyOptions,
} from '../../tools/test-fixtures/body';

/** measureBody on the figure at its analysed size, with its own mask, pose and head top unless given. */
function measureOf(
  fx: SynthBody,
  over: { mask?: CategoryMask; pose?: PoseObservation; headTopY?: number } = {},
) {
  return measureBody({
    pose: over.pose ?? fx.pose,
    mask: over.mask ?? fx.mask,
    faceBox: fx.faceBox,
    headTopY: over.headTopY ?? fx.headTopY,
    width: fx.mask.width,
    height: fx.mask.height,
  });
}

function measure(opts: SynthBodyOptions = {}) {
  const fx = synthBody(opts);
  const m = measureOf(fx);
  if (!m) throw new Error('measureBody: no measurement of the figure');
  return { fx, m };
}

/** The figure's mask with a background stripe `w` px wide down its midline (x 300), on rows y0..y1 − 1. */
function striped(fx: SynthBody, w: number, ...rows: [number, number][]): CategoryMask {
  const data = fx.mask.data.slice();
  for (const [y0, y1] of rows) {
    for (let y = y0; y < y1; y++) {
      for (let x = 300 - w / 2; x < 300 + w / 2; x++) data[y * fx.mask.width + x] = MASK.background;
    }
  }
  return { ...fx.mask, data };
}

/**
 * The figure's mask with a 3 px hole in its clothes at columns x0..x0 + 2 on rows y0..y1 − 1: a strap
 * or an accessory the segmenter labels 'others', which is not the body.
 */
function holed(fx: SynthBody, x0: number, [y0, y1]: [number, number]): CategoryMask {
  const data = fx.mask.data.slice();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x0 + 3; x++) {
      const i = y * fx.mask.width + x;
      if (data[i] === MASK.clothes) data[i] = MASK.others;
    }
  }
  return { ...fx.mask, data };
}

/** The rows y0..y1 − 1 that hold the band's (t from the shoulder line to the hip line), and 2 more each way. */
function bandRows(fx: SynthBody, band: keyof typeof MEASURE.bands): [number, number] {
  const lineY = (i: number, j: number) =>
    ((fx.pose.landmarks[i]!.y + fx.pose.landmarks[j]!.y) / 2) * fx.mask.height;
  const shoulderY = lineY(POSE.shoulderL, POSE.shoulderR);
  const length = lineY(POSE.hipL, POSE.hipR) - shoulderY;
  const [t0, t1] = MEASURE.bands[band];
  return [Math.floor(shoulderY + t0 * length) - 2, Math.ceil(shoulderY + t1 * length) + 2];
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

test.each([5, 20])(
  'arms %i px off the torso’s side, either side of the 8 px bridge: the bust, waist and hip widths within 1 px of the clear figure’s',
  (armGapPx) => {
    const clear = measure().m;
    const { m } = measure({ arms: 'bothTouching', armGapPx });
    expect(MEASURE.gapFraction * m.heightPx).toBe(8);
    // The span bridges a gap under the bridge, but the side still ends at it, as it does past the
    // bridge: the width is the torso's either way, not the torso's and the gaps.
    for (const f of TORSO) {
      expect(Math.abs(m.features[f] - clear.features[f]), f).toBeLessThanOrEqual(1 / m.heightPx);
    }
  },
);

test('a row where both arms touch is left out of a band with a row where the torso’s side shows', () => {
  const clear = measure().m;
  const fx = synthBody({ arms: 'bothTouching' });
  // The pose's shoulders and elbows 4 px further out than the drawn arms (the subject's left on the
  // image's right). Where the arms merge with the torso, the rule from the axes reads each side ~8 px
  // wide: the axis is 4 px out, and the upper arm, measured from it, ~8 px narrow. The bust band's top
  // rows show background between arm and torso; its lower rows, the majority, merge.
  const dx = 4 / fx.mask.width;
  const pose: PoseObservation = {
    ...fx.pose,
    landmarks: fx.pose.landmarks.map((p, i) =>
      i === POSE.shoulderL || i === POSE.elbowL
        ? { ...p, x: p.x + dx }
        : i === POSE.shoulderR || i === POSE.elbowR
          ? { ...p, x: p.x - dx }
          : p,
    ),
  };
  const m = measureOf(fx, { pose })!;
  expect(m.armsTouching).toEqual({ left: true, right: true });
  expect(Math.abs(m.features.bustWidth - clear.features.bustWidth)).toBeLessThanOrEqual(
    1 / m.heightPx,
  );
});

test.each([
  ['leftTouching', 'a strap down the torso', 'all'],
  ['bothTouching', 'a strap down the torso', 'all'],
  ['bothTouching', 'a speckle on one waist row', 'waist'],
] as const)(
  'arms %s, with %s 20 px off the midline on the subject’s left: a hole in the torso is not the gap to the arm, and the bust, waist and hip widths stay within 1 px of the clear figure’s',
  (arms, _, where) => {
    const clear = measure().m;
    const fx = synthBody({ arms });
    const [w0, w1] = bandRows(fx, 'waist');
    const mid = Math.floor((w0 + w1) / 2);
    const rows: [number, number] = where === 'all' ? [0, fx.mask.height] : [mid, mid + 1];
    // The hole (x 320..322) starts 65–81 px in from the touching arm's axis: past 1.5 × the upper
    // arm's 36 px, so it is the torso's own, and the arm touches. One such row, seen, would otherwise
    // be the waist's narrowest, or outvote every row read from both arm axes.
    const m = measureOf(fx, { mask: holed(fx, 320, rows) })!;
    expect(m.features.upperArmWidth * m.heightPx).toBeCloseTo(36, 0);
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
  expect(MEASURE.gapFraction * m.heightPx).toBe(8);
  expect(bandRows(fx, 'bust')).toEqual([324, 357]); // the bust band's rows are 327..353
  expect(measureOf(fx, { mask: striped(fx, 6, [300, 380]) })!.features.bustWidth).toBe(
    m.features.bustWidth,
  );
  // Past the bridge, a row whose span would not hold the midline is skipped: with 18 of the bust's 27
  // rows striped, its median is the other 9 rows' width (each the full bust), not half of it.
  const partial = measureOf(fx, { mask: striped(fx, 12, [300, 345]) })!;
  expect(partial.features.bustWidth).toBe(m.features.bustWidth);
  expect(partial.lines.find((l) => l.feature === 'bustWidth')!.a.y).toBeGreaterThan(345);
});

test.each(['shoulder', 'bust', 'waist', 'hip'] as const)(
  'a midline gap past the bridge across the whole %s band leaves it no row: no measurement',
  (band) => {
    const fx = synthBody();
    expect(measureOf(fx, { mask: striped(fx, 12, bandRows(fx, band)) })).toBeNull();
    expect(measureOf(fx, { mask: striped(fx, 6, bandRows(fx, band)) })).not.toBeNull();
  },
);

test('hair down the midline with the body on one side only: once it is trimmed, the span misses the midline and the row is skipped', () => {
  const fx = synthBody();
  const [y0, y1] = bandRows(fx, 'bust');
  const data = fx.mask.data.slice();
  // Over the bust band: hair on x 294..305 (the midline at 300) and the background left of it.
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < 306; x++)
      data[y * fx.mask.width + x] = x >= 294 ? MASK.hair : MASK.background;
  }
  expect(measureOf(fx, { mask: { ...fx.mask, data } })).toBeNull();
});

test.each(['leftTouching', 'bothTouching'] as const)(
  'arms %s, a midline gap past the bridge over part of the bust and waist bands: every torso width positive, and within 1 px of the clear figure’s',
  (arms) => {
    const clear = measure().m;
    const fx = synthBody({ arms });
    // The bust band's rows are 327..353 and the waist's 396..478. Striped: 14 of the bust's 27 rows,
    // more than half, so a row measured on one side would be its median (the middle 13 are left, where
    // the touching arms meet the torso), and the waist's top rows, ahead of its narrowest row at y 437.
    const m = measureOf(fx, { mask: striped(fx, 12, [300, 334], [347, 420]) })!;
    expect(m).not.toBeNull();
    for (const f of ['shoulderWidth', ...TORSO] as const) {
      expect(m.features[f], f).toBeGreaterThan(0);
    }
    for (const f of TORSO) {
      expect(Math.abs(m.features[f] - clear.features[f]), f).toBeLessThanOrEqual(1 / m.heightPx);
    }
    expect(m.armsTouching).toEqual({ left: true, right: arms === 'bothTouching' });
  },
);

test('no measurement when the hip line is not below the shoulder line, or the height is not positive', () => {
  const fx = synthBody();
  /** The pose with the hips' y (analysed px) moved to `y`. */
  const hipsAt = (y: number): PoseObservation => ({
    ...fx.pose,
    landmarks: fx.pose.landmarks.map((p, i) =>
      i === POSE.hipL || i === POSE.hipR ? { ...p, y: y / fx.mask.height } : p,
    ),
  });
  const shoulderY = fx.pose.landmarks[POSE.shoulderL]!.y * fx.mask.height; // 244, both level
  for (const y of [shoulderY - 50, shoulderY]) {
    const pose = hipsAt(y);
    expect(checkBodyGate(pose)).toBe('ok'); // the gate passes such a pose
    expect(measureOf(fx, { pose })).toBeNull();
  }
  // The head top at the ankle line (y 900), or below it.
  for (const top of [900, 950]) expect(measureOf(fx, { headTopY: top })).toBeNull();
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
  const coarse = measureOf(fx, { mask: half })!;
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
