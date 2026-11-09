import { analyzeToParams } from '../../src/analysis/mapping';
import { DEFAULT_CALIBRATION } from '../../src/analysis/calibration';
import { faceBox, toPixels } from '../../src/analysis/landmarks';
import type { Analysis } from '../../src/analysis/types';
import type { Catalog } from '../../src/catalog/catalog';
import { avatarParamsSchema } from '../../src/catalog/params';
import { synthFace, type SynthOptions } from '../../tools/test-fixtures/canonicalFace';

function analysis(opts: SynthOptions = {}): Analysis {
  const fx = synthFace(opts);
  return { face: fx.face, mask: fx.mask, image: fx.image, faceBox: faceBox(toPixels(fx.face)) };
}
const catalog: Catalog = {
  version: 1,
  bases: [{ id: 'a', name: 'A', url: '/a.vrm' }],
  hair: [
    {
      id: 'long_01',
      name: 'Long',
      base: 'a',
      url: '/l.glb',
      tags: { length: 'long', volume: 'medium', bangs: false, parting: 'none' },
    },
  ],
};

test('returns schema-valid params for the canonical face', () => {
  const { params, debug } = analyzeToParams(analysis(), {
    calibration: DEFAULT_CALIBRATION,
    catalog,
    base: 'a',
  });
  expect(avatarParamsSchema.safeParse(params).success).toBe(true);
  expect(params.base).toBe('a');
  expect(params.expression).toBe('neutral');
  for (const v of Object.values(params.faceShape)) expect(Math.abs(v)).toBeLessThan(1e-6);
  expect(Object.keys(debug.ratios)).toHaveLength(8);
  expect(Object.keys(debug.zScores)).toHaveLength(8);
});

test('picks the catalog hairstyle nearest to the detected tags', () => {
  const { params, debug } = analyzeToParams(analysis({ hair: { length: 'long', bangs: false } }), {
    calibration: DEFAULT_CALIBRATION,
    catalog,
    base: 'a',
  });
  expect(params.hair).toBe('long_01');
  expect(debug.hairCandidates[0]!.id).toBe('long_01');
});

test('no visible hair → none, and hair colour falls back to the brow region', () => {
  const { params, debug } = analyzeToParams(analysis({ hair: { length: 'none' } }), {
    calibration: DEFAULT_CALIBRATION,
    catalog,
    base: 'a',
  });
  expect(params.hair).toBe('none');
  expect(debug.swatches.hair).toBeNull();
  expect(params.hairColor).toMatch(/^#[0-9a-f]{6}$/);
});

test("another person's hair outside the face region does not change the hair colour", () => {
  const primary: SynthOptions = {
    width: 1200,
    height: 800,
    centre: { x: 300, y: 400 },
    hair: { length: 'short', volume: 'low' },
  };
  const opts = { calibration: DEFAULT_CALIBRATION, catalog, base: 'a' as const };
  const alone = analyzeToParams(analysis(primary), opts);
  const crowd = analyzeToParams(
    analysis({
      ...primary,
      // Same-size blonde head of long hair, well outside the 2.5× face-width region.
      secondFace: { scale: 12, centre: { x: 900, y: 400 }, hairColor: '#e6c878' },
    }),
    opts,
  );
  expect(crowd.debug.hairTags).toEqual(alone.debug.hairTags);
  expect(crowd.params.hairColor).toBe(alone.params.hairColor);
});

test('keeps unrelated fields from the current params', () => {
  const current = {
    ...analyzeToParams(analysis(), { calibration: DEFAULT_CALIBRATION, catalog, base: 'a' }).params,
    outfit: { top: { id: 'tee_01' } },
  };
  const { params } = analyzeToParams(analysis(), {
    calibration: DEFAULT_CALIBRATION,
    catalog,
    base: 'a',
    current,
  });
  expect(params.outfit).toEqual({ top: { id: 'tee_01' } });
});
