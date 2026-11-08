import { avatarParamsSchema, defaultParams, SLOTS } from '../../src/catalog/params';

test('defaultParams satisfies the schema', () => {
  expect(avatarParamsSchema.safeParse(defaultParams).success).toBe(true);
});

test('SLOTS matches spec §8', () => {
  expect([...SLOTS]).toEqual(['top', 'bottom', 'full', 'shoes', 'outer', 'head']);
});

test.each(['skin', 'hairColor', 'lipTint'])('%s must be a 6-digit hex colour', (key) => {
  expect(avatarParamsSchema.safeParse({ ...defaultParams, [key]: '#abc' }).success).toBe(false);
  expect(avatarParamsSchema.safeParse({ ...defaultParams, [key]: 'red' }).success).toBe(false);
  expect(avatarParamsSchema.safeParse({ ...defaultParams, [key]: '#A1B2C3' }).success).toBe(true);
});

test('faceShape weights are clamped to -1..1 by the schema', () => {
  const bad = { ...defaultParams, faceShape: { ...defaultParams.faceShape, jawWidth: 1.5 } };
  expect(avatarParamsSchema.safeParse(bad).success).toBe(false);
});

test('brows.thickness and poseTweak ranges', () => {
  expect(
    avatarParamsSchema.safeParse({ ...defaultParams, brows: { shape: 'arched', thickness: 1.2 } })
      .success,
  ).toBe(false);
  expect(
    avatarParamsSchema.safeParse({
      ...defaultParams,
      poseTweak: { headTurn: -2, headTilt: 0, torsoLean: 0 },
    }).success,
  ).toBe(false);
});

test('version is the literal 1', () => {
  expect(avatarParamsSchema.safeParse({ ...defaultParams, version: 2 }).success).toBe(false);
});

test('outfit accepts items per slot and rejects unknown slots', () => {
  expect(
    avatarParamsSchema.safeParse({
      ...defaultParams,
      outfit: { top: { id: 'tee_01', color: '#ffffff' } },
    }).success,
  ).toBe(true);
  expect(
    avatarParamsSchema.safeParse({ ...defaultParams, outfit: { hat: { id: 'x' } } }).success,
  ).toBe(false);
});
