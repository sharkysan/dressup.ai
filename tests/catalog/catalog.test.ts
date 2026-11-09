import { catalogSchema, findHair, type Catalog } from '../../src/catalog/catalog';

const valid: Catalog = {
  version: 2,
  base: { name: 'MakeHuman base', url: '/assets/base/base.vrm', meta: '/assets/base/base.json' },
  hair: [
    {
      id: 'hair_twist_01',
      name: 'Long straight with bangs',
      url: '/assets/hair/hair_twist_01.glb',
      tags: { length: 'long', volume: 'medium', bangs: true, parting: 'center' },
    },
  ],
};

test('accepts a valid catalog', () => {
  expect(catalogSchema.safeParse(valid).success).toBe(true);
});

test('rejects catalog version 1', () => {
  expect(catalogSchema.safeParse({ ...valid, version: 1 }).success).toBe(false);
});

test('rejects a hair entry with an unknown tag value', () => {
  const bad = structuredClone(valid) as unknown as { hair: { tags: { length: string } }[] };
  bad.hair[0]!.tags.length = 'enormous';
  expect(catalogSchema.safeParse(bad).success).toBe(false);
});

test('findHair returns the entry or undefined', () => {
  expect(findHair(valid, 'hair_twist_01')?.name).toBe('Long straight with bangs');
  expect(findHair(valid, 'nope')).toBeUndefined();
});
