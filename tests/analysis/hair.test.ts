import { hairTags } from '../../src/analysis/mapping/hair';
import { toPixels } from '../../src/analysis/landmarks';
import { categoryEquals, resampleMask } from '../../src/analysis/masks';
import { MASK } from '../../src/analysis/types';
import { synthFace, type SynthOptions } from '../../tools/test-fixtures/canonicalFace';

function tagsFor(opts: SynthOptions) {
  const fx = synthFace(opts);
  const hair = resampleMask(
    categoryEquals(fx.mask, MASK.hair),
    fx.mask.width,
    fx.mask.height,
    fx.image.width,
    fx.image.height,
  );
  return { tags: hairTags(hair, fx.image.width, fx.image.height, toPixels(fx.face)), fx };
}

test('long hair with bangs', () => {
  const { tags } = tagsFor({
    width: 800,
    height: 1100,
    hair: { length: 'long', bangs: true, parting: 'center' },
  });
  expect(tags.present).toBe(true);
  expect(tags.length).toBe('long');
  expect(tags.bangs).toBe(true);
  expect(tags.parting).toBe('center');
});

test('short hair without bangs', () => {
  const { tags } = tagsFor({ hair: { length: 'short', bangs: false } });
  expect(tags).toMatchObject({ present: true, length: 'short', bangs: false, parting: 'none' });
});

test('medium hair, left parting', () => {
  const { tags } = tagsFor({ hair: { length: 'medium', bangs: true, parting: 'left' } });
  expect(tags.length).toBe('medium');
  expect(tags.parting).toBe('left');
});

test('volume bins follow the hair strip width', () => {
  expect(tagsFor({ hair: { length: 'medium', volume: 'low' } }).tags.volume).toBe('low');
  expect(tagsFor({ hair: { length: 'medium', volume: 'medium' } }).tags.volume).toBe('medium');
  expect(tagsFor({ hair: { length: 'long', volume: 'high' } }).tags.volume).toBe('high');
});

test('no hair → present false', () => {
  expect(tagsFor({ hair: { length: 'none' } }).tags.present).toBe(false);
});

test("a second person's hair outside the 2.5× face box does not change the tags", () => {
  const alone = tagsFor({ hair: { length: 'short', volume: 'low' } }).tags;
  const crowd = tagsFor({
    hair: { length: 'short', volume: 'low' },
    secondFace: { scale: 3, centre: { x: 600, y: 720 } },
  }).tags;
  expect(crowd).toEqual(alone);
});
