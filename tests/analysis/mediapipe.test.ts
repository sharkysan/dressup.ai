import { toPoseObservations } from '../../src/analysis/mediapipe';

const point = (i: number) => ({ x: i / 100, y: i / 50, z: i / 200, visibility: 0.9 });
const pose = () => Array.from({ length: 33 }, (_, i) => point(i));

test('PoseLandmarker results become poses in the analysed image', () => {
  const [p] = toPoseObservations({ landmarks: [pose()], worldLandmarks: [pose()] }, 640, 800);
  expect(p!.landmarks[3]).toEqual({ x: 0.03, y: 0.06, z: 0.015, visibility: 0.9 });
  expect(p!.world[3]).toEqual({ x: 0.03, y: 0.06, z: 0.015 });
  expect([p!.imageWidth, p!.imageHeight]).toEqual([640, 800]);
});

test('a pose without its 33 world landmarks is skipped', () => {
  const poses = toPoseObservations(
    { landmarks: [pose(), pose(), pose()], worldLandmarks: [pose(), pose().slice(0, 12)] },
    640,
    800,
  );
  expect(poses).toHaveLength(1);
  expect(poses[0]!.world).toHaveLength(33);
});
