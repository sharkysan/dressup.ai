import { cameraFor } from '../../src/scene/cameraPose';

test('full framing looks at mid-body from far enough to fit the height', () => {
  const c = cameraFor('full', { headY: 1.42, height: 1.6 });
  expect(c.target[1]).toBeCloseTo(0.85, 1);
  expect(c.position[2]).toBeGreaterThan(2.5);
});

test('portrait framing looks at the head from close', () => {
  const c = cameraFor('portrait', { headY: 1.42, height: 1.6 });
  expect(c.target[1]).toBeCloseTo(1.5, 1);
  expect(c.position[2]).toBeLessThan(1.2);
});

test('falls back to sensible defaults without metrics', () => {
  const c = cameraFor('portrait', null);
  expect(c.target[1]).toBeGreaterThan(1);
});
