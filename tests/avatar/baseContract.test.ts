import {
  ALL_BODY_TARGETS,
  REGION_CODES,
  contractJson,
  morphTargetNames,
} from '../../src/avatar/baseContract';

test('gender has a single max target, other morphs have min and max', () => {
  expect(morphTargetNames('gender')).toEqual(['body_gender_max']);
  expect(morphTargetNames('waist')).toEqual(['body_waist_min', 'body_waist_max']);
});

test('ALL_BODY_TARGETS lists 17 targets', () => {
  expect(ALL_BODY_TARGETS).toHaveLength(17);
  expect(new Set(ALL_BODY_TARGETS).size).toBe(17);
});

test('REGION_CODES are unique and within 1..8', () => {
  const codes = Object.values(REGION_CODES);
  expect(new Set(codes).size).toBe(codes.length);
  for (const c of codes) expect(c).toBeGreaterThanOrEqual(1);
  for (const c of codes) expect(c).toBeLessThanOrEqual(8);
});

test('contractJson is plain JSON carrying names, regions, bones and expressions', () => {
  const j = contractJson() as Record<string, unknown>;
  expect(JSON.parse(JSON.stringify(j))).toEqual(j);
  expect(Object.keys(j)).toEqual(
    expect.arrayContaining([
      'bodyMesh',
      'materials',
      'maskedMaterials',
      'regions',
      'bodyTargets',
      'expressionTargets',
      'humanBones',
    ]),
  );
});
