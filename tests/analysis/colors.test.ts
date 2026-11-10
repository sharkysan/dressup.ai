import { extractEyeColor } from '../../src/analysis/mapping/eyes';
import { extractHairColor } from '../../src/analysis/mapping/hairColor';
import { extractSkin } from '../../src/analysis/mapping/skin';
import { categoryEquals, resampleMask } from '../../src/analysis/masks';
import { toPixels } from '../../src/analysis/landmarks';
import { MASK } from '../../src/analysis/types';
import { hexToOklab } from '../../src/color/oklab';
import { synthFace } from '../../tools/test-fixtures/canonicalFace';

function deltaE(a: string, b: string): number {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  return Math.hypot(la.L - lb.L, la.a - lb.a, la.b - lb.b);
}

const colors = { skin: '#8d5524', hair: '#2b1b12', iris: '#4a76b0' };
const fx = synthFace({ hair: { length: 'long', bangs: false }, colors });
const px = toPixels(fx.face);
const faceSkin = resampleMask(
  categoryEquals(fx.mask, MASK.faceSkin),
  fx.mask.width,
  fx.mask.height,
  fx.image.width,
  fx.image.height,
);
const hair = resampleMask(
  categoryEquals(fx.mask, MASK.hair),
  fx.mask.width,
  fx.mask.height,
  fx.image.width,
  fx.image.height,
);

test('extractSkin recovers the painted skin tone', () => {
  expect(deltaE(extractSkin(fx.image, faceSkin, px), colors.skin)).toBeLessThan(0.03);
});

test('extractHairColor recovers the painted hair colour', () => {
  expect(deltaE(extractHairColor(fx.image, hair)!, colors.hair)).toBeLessThan(0.05);
});

test('extractHairColor is null without hair', () => {
  const bald = synthFace({ hair: { length: 'none' } });
  const none = resampleMask(
    categoryEquals(bald.mask, MASK.hair),
    bald.mask.width,
    bald.mask.height,
    bald.image.width,
    bald.image.height,
  );
  expect(extractHairColor(bald.image, none)).toBeNull();
});

test('extractEyeColor snaps the painted iris to blue', () => {
  expect(extractEyeColor(fx.image, px).preset).toBe('blue');
});
