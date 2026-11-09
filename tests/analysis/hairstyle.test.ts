import {
  hairDistance,
  nearestHairstyle,
  rankHairstyles,
} from '../../src/analysis/mapping/hairstyle';
import type { HairTags } from '../../src/analysis/mapping/hair';
import type { Catalog, HairStyle } from '../../src/catalog/catalog';

const style = (id: string, base: 'a' | 'b', tags: HairStyle['tags']): HairStyle => ({
  id,
  name: id,
  base,
  url: `/${id}.glb`,
  tags,
});
const catalog: Catalog = {
  version: 1,
  bases: [{ id: 'a', name: 'A', url: '/a.vrm' }],
  hair: [
    style('long_bangs', 'a', { length: 'long', volume: 'medium', bangs: true, parting: 'center' }),
    style('short_crop', 'a', { length: 'short', volume: 'low', bangs: false, parting: 'none' }),
    style('bob_b', 'b', { length: 'medium', volume: 'medium', bangs: true, parting: 'left' }),
  ],
};
const longTags: HairTags = {
  present: true,
  length: 'long',
  volume: 'medium',
  bangs: true,
  parting: 'center',
};

test('distance is 0 for matching tags and 4 for long vs short alone', () => {
  expect(hairDistance(longTags, catalog.hair[0]!)).toBe(0);
  expect(
    hairDistance({ ...longTags, volume: 'low', bangs: false, parting: 'none' }, catalog.hair[1]!),
  ).toBe(4);
});

test('rankHairstyles sorts ascending and filters by base', () => {
  const ranked = rankHairstyles(longTags, catalog, 'a');
  expect(ranked.map((r) => r.style.id)).toEqual(['long_bangs', 'short_crop']);
  expect(ranked[0]!.distance).toBe(0);
});

test('nearestHairstyle returns the closest id, none without hair or catalog', () => {
  expect(nearestHairstyle(longTags, catalog, 'a')).toBe('long_bangs');
  expect(nearestHairstyle({ ...longTags, present: false }, catalog, 'a')).toBe('none');
  expect(nearestHairstyle(longTags, null, 'a')).toBe('none');
  expect(nearestHairstyle(longTags, { ...catalog, hair: [] }, 'a')).toBe('none');
});
