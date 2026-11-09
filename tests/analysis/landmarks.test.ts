import {
  faceBox,
  headPose,
  LM,
  polygonMask,
  rollCorrected,
  toPixels,
} from '../../src/analysis/landmarks';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('headPose of the identity matrix is zero', () => {
  expect(headPose(identity)).toEqual({ yaw: 0, pitch: 0, roll: 0 });
});

test('headPose recovers the roll and yaw the fixture applied', () => {
  expect(headPose(synthFace({ rollDeg: 20 }).face.matrix).roll).toBeCloseTo(20, 5);
  expect(headPose(synthFace({ yawDeg: 25 }).face.matrix).yaw).toBeCloseTo(25, 5);
});

test('rollCorrected puts the chin directly below the forehead again', () => {
  const { face } = synthFace({ rollDeg: 20 });
  const px = toPixels(face);
  const tilted = Math.abs(px[LM.chin]!.x - px[LM.faceTop]!.x);
  expect(tilted).toBeGreaterThan(20);
  const box = faceBox(px);
  const fixed = rollCorrected(px, headPose(face.matrix).roll, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  expect(Math.abs(fixed[LM.chin]!.x - fixed[LM.faceTop]!.x)).toBeLessThan(0.5);
});

test('faceBox is centred where the fixture placed the face', () => {
  const { face } = synthFace({ width: 800, height: 800, centre: { x: 400, y: 380 } });
  const box = faceBox(toPixels(face));
  // The oval's bounding box is not perfectly centred on the model origin; allow 10% of the face height.
  expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThan(box.height * 0.1);
  expect(Math.abs(box.y + box.height / 2 - 380)).toBeLessThan(box.height * 0.1);
  expect(box.width).toBeGreaterThan(100);
});

test('polygonMask fills an inscribed circle to ~π/4 of its square', () => {
  const pts = Array.from({ length: 64 }, (_, i) => ({
    x: 50 + 40 * Math.cos((i / 64) * 2 * Math.PI),
    y: 50 + 40 * Math.sin((i / 64) * 2 * Math.PI),
  }));
  const mask = polygonMask(
    pts,
    pts.map((_, i) => i),
    100,
    100,
  );
  let ones = 0;
  for (const v of mask) ones += v;
  expect(ones / (80 * 80)).toBeCloseTo(Math.PI / 4, 1);
});
