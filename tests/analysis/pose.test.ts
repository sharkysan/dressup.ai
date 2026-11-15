import {
  faceFromCrop,
  HEAD_CROP,
  headCropRect,
  pickPose,
  POSE,
  posePixels,
} from '../../src/analysis/pose';
import type { Box, FaceObservation, Point2, PoseObservation } from '../../src/analysis/types';

/** The analysed (downscaled) copy of a 3000×4000 photo. */
const ANALYSED = { width: 768, height: 1024 };
const FULL = { width: 3000, height: 4000 };

/**
 * A pose in an image of `size` whose head landmarks 0–10 lie at `head` (pixels of that image; the rest
 * at the origin), each visible.
 */
function poseWith(head: Point2[], size = ANALYSED): PoseObservation {
  const landmarks = Array.from({ length: 33 }, (_, i) => {
    const p = head[i] ?? { x: 0, y: 0 };
    return { x: p.x / size.width, y: p.y / size.height, z: 0, visibility: 1 };
  });
  return {
    landmarks,
    world: landmarks.map(() => ({ x: 0, y: 0, z: 0 })),
    imageWidth: size.width,
    imageHeight: size.height,
  };
}

/** A pose whose nose is at `nose` (analysed pixels), its other head landmarks beside it. */
const poseAtNose = (nose: Point2) =>
  poseWith(Array.from({ length: 11 }, (_, i) => (i === 0 ? nose : { x: nose.x + 3, y: nose.y })));

/**
 * A head in full-resolution pixels: landmarks 0–10 spread unevenly about `centre` (so their mean is not
 * the nose), the ears (7, 8) `ear` px apart on a slight tilt.
 */
function headAt(centre: Point2, ear: number): Point2[] {
  const dx = (ear / 2) * Math.cos(0.1);
  const dy = (ear / 2) * Math.sin(0.1);
  const head: Point2[] = [
    { x: centre.x + 2, y: centre.y + 6 }, // nose
    { x: centre.x + 5, y: centre.y - 4 },
    { x: centre.x + 8, y: centre.y - 4 },
    { x: centre.x + 11, y: centre.y - 4 },
    { x: centre.x - 5, y: centre.y - 4 },
    { x: centre.x - 8, y: centre.y - 4 },
    { x: centre.x - 11, y: centre.y - 4 },
    { x: centre.x + dx, y: centre.y + dy }, // left ear
    { x: centre.x - dx, y: centre.y - dy }, // right ear
    { x: centre.x + 4, y: centre.y + 14 },
    { x: centre.x - 4, y: centre.y + 14 },
  ];
  // As landmarks normalised by the full-resolution size, which poseWith expects in analysed pixels.
  return head.map((p) => ({
    x: (p.x * ANALYSED.width) / FULL.width,
    y: (p.y * ANALYSED.height) / FULL.height,
  }));
}

function meanOfHead(head: Point2[]): Point2 {
  const n = 11;
  let x = 0;
  let y = 0;
  for (const p of head.slice(0, n)) {
    x += (p.x * FULL.width) / ANALYSED.width;
    y += (p.y * FULL.height) / ANALYSED.height;
  }
  return { x: x / n, y: y / n };
}

const centreOf = (r: Box): Point2 => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test('POSE names the MediaPipe landmarks the analysis reads, L/R the subject’s', () => {
  expect(POSE.nose).toBe(0);
  expect(POSE.head).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect([POSE.earL, POSE.earR]).toEqual([7, 8]);
  expect([POSE.shoulderL, POSE.shoulderR, POSE.elbowL, POSE.elbowR]).toEqual([11, 12, 13, 14]);
  expect([POSE.wristL, POSE.wristR, POSE.hipL, POSE.hipR]).toEqual([15, 16, 23, 24]);
  expect([POSE.kneeL, POSE.kneeR, POSE.ankleL, POSE.ankleR]).toEqual([25, 26, 27, 28]);
});

test('posePixels gives the landmarks in analysed pixels', () => {
  const pose = poseAtNose({ x: 120, y: 340 });
  const px = posePixels(pose);
  expect(px).toHaveLength(33);
  expect(px[POSE.nose]!.x).toBeCloseTo(120, 9);
  expect(px[POSE.nose]!.y).toBeCloseTo(340, 9);
});

describe('pickPose', () => {
  const box: Box = { x: 100, y: 100, width: 100, height: 120 };

  test('returns the pose whose nose lies inside the face box', () => {
    const outside = poseAtNose({ x: 400, y: 400 });
    const inside = poseAtNose({ x: 130, y: 190 });
    expect(pickPose([outside, inside], box)).toBe(inside);
  });

  test('with two noses inside, returns the one nearest the box centre', () => {
    const edge = poseAtNose({ x: 105, y: 110 });
    const centre = poseAtNose({ x: 152, y: 158 });
    expect(pickPose([edge, centre], box)).toBe(centre);
    expect(pickPose([centre, edge], box)).toBe(centre);
  });

  test('with no nose inside, returns null', () => {
    expect(pickPose([poseAtNose({ x: 99, y: 150 }), poseAtNose({ x: 150, y: 221 })], box)).toBe(
      null,
    );
    expect(pickPose([], box)).toBeNull();
  });
});

describe('headCropRect on a 3000×4000 photo', () => {
  test('is a square centred on the mean of landmarks 0–10, its side 3 × the ear distance', () => {
    expect(HEAD_CROP.earMultiple).toBe(3);
    const head = headAt({ x: 1500, y: 600 }, 60);
    const rect = headCropRect(poseWith(head), FULL);
    const mean = meanOfHead(head);
    expect(centreOf(rect).x).toBeCloseTo(mean.x, 6);
    expect(centreOf(rect).y).toBeCloseTo(mean.y, 6);
    expect(rect.width).toBeCloseTo(180, 6);
    expect(rect.height).toBe(rect.width);
  });

  test('is 96 px square when 3 × the ear distance is smaller', () => {
    expect(HEAD_CROP.minSidePx).toBe(96);
    const head = headAt({ x: 1500, y: 600 }, 20);
    const rect = headCropRect(poseWith(head), FULL);
    expect([rect.width, rect.height]).toEqual([96, 96]);
    expect(centreOf(rect).x).toBeCloseTo(meanOfHead(head).x, 6);
  });

  test('a head 20 px from the left edge: the rect is shifted inside, not shrunk', () => {
    const rect = headCropRect(poseWith(headAt({ x: 20, y: 600 }, 100)), FULL);
    expect(rect.x).toBe(0);
    expect(rect.width).toBeCloseTo(300, 6);
    expect(rect.height).toBe(rect.width);
  });

  test('a head at the bottom-right corner: the rect is shifted inside', () => {
    const rect = headCropRect(poseWith(headAt({ x: 2990, y: 3995 }, 100)), FULL);
    expect(rect.x + rect.width).toBeCloseTo(FULL.width, 6);
    expect(rect.y + rect.height).toBeCloseTo(FULL.height, 6);
    expect(rect.width).toBeCloseTo(300, 6);
  });
});

describe('faceFromCrop', () => {
  const rect: Box = { x: 1000, y: 400, width: 300, height: 300 };
  const inCrop: FaceObservation = {
    landmarks: [{ x: 0.5, y: 0.5, z: 0.1 }],
    matrix: Array.from({ length: 16 }, (_, i) => i),
    blendshapes: { jawOpen: 0.25 },
    imageWidth: 300,
    imageHeight: 300,
  };

  test('maps crop landmarks into the photo: x, y by the rect, z by its width over the photo’s', () => {
    const face = faceFromCrop(inCrop, rect, FULL, ANALYSED);
    const p = face.landmarks[0]!;
    expect(p.x).toBeCloseTo(1150 / 3000, 12);
    expect(p.y).toBeCloseTo(550 / 4000, 12);
    expect(p.z).toBeCloseTo((0.1 * 300) / 3000, 12);
  });

  test('takes the analysed size and keeps the matrix and blendshapes', () => {
    const face = faceFromCrop(inCrop, rect, FULL, ANALYSED);
    expect([face.imageWidth, face.imageHeight]).toEqual([ANALYSED.width, ANALYSED.height]);
    expect(face.matrix).toEqual(inCrop.matrix);
    expect(face.blendshapes).toEqual(inCrop.blendshapes);
  });
});
