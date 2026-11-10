import { avatarParamsSchema, BODY_MORPHS, defaultParams, SLOTS } from '../../src/catalog/params';

test('defaultParams satisfies the schema', () => {
  expect(avatarParamsSchema.safeParse(defaultParams).success).toBe(true);
});

test('SLOTS matches spec §8', () => {
  expect([...SLOTS]).toEqual(['top', 'bottom', 'full', 'shoes', 'outer', 'head']);
});

test.each(['skin', 'hairColor'])('%s must be a 6-digit hex colour', (key) => {
  expect(avatarParamsSchema.safeParse({ ...defaultParams, [key]: '#abc' }).success).toBe(false);
  expect(avatarParamsSchema.safeParse({ ...defaultParams, [key]: 'red' }).success).toBe(false);
  expect(avatarParamsSchema.safeParse({ ...defaultParams, [key]: '#A1B2C3' }).success).toBe(true);
});

test('body ranges: heightCm 140..210, gender 0..1, other morphs -1..1', () => {
  const withBody = (patch: object) => ({
    ...defaultParams,
    body: { ...defaultParams.body, ...patch },
  });
  expect(avatarParamsSchema.safeParse(withBody({ heightCm: 139 })).success).toBe(false);
  expect(avatarParamsSchema.safeParse(withBody({ heightCm: 211 })).success).toBe(false);
  expect(avatarParamsSchema.safeParse(withBody({ heightCm: 140 })).success).toBe(true);
  expect(avatarParamsSchema.safeParse(withBody({ gender: -0.1 })).success).toBe(false);
  expect(avatarParamsSchema.safeParse(withBody({ weight: 1.01 })).success).toBe(false);
  expect(avatarParamsSchema.safeParse(withBody({ weight: -1 })).success).toBe(true);
});

test('defaultParams.body is 165 cm, neutral', () => {
  expect(defaultParams.body.heightCm).toBe(165);
  expect(defaultParams.face).toBe('default');
  for (const m of BODY_MORPHS) expect(defaultParams.body[m]).toBe(0);
});

test('face is photo or default', () => {
  expect(avatarParamsSchema.safeParse({ ...defaultParams, face: 'photo' }).success).toBe(true);
  expect(avatarParamsSchema.safeParse({ ...defaultParams, face: 'other' }).success).toBe(false);
});

test('a v1-shaped object (with faceShape) is rejected', () => {
  const v1 = {
    ...defaultParams,
    version: 1,
    faceShape: { faceWidth: 0, jawWidth: 0 },
  };
  expect(avatarParamsSchema.safeParse(v1).success).toBe(false);
  const v2WithLegacy = { ...defaultParams, faceShape: { faceWidth: 0 } };
  expect(avatarParamsSchema.safeParse(v2WithLegacy).success).toBe(false);
});

test('poseTweak range', () => {
  expect(
    avatarParamsSchema.safeParse({
      ...defaultParams,
      poseTweak: { headTurn: -2, headTilt: 0, torsoLean: 0 },
    }).success,
  ).toBe(false);
});

test('version is the literal 2', () => {
  expect(avatarParamsSchema.safeParse({ ...defaultParams, version: 1 }).success).toBe(false);
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
