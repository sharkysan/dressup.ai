import { MToonMaterial } from '@pixiv/three-vrm';
import { BufferGeometry, Group, Mesh } from 'three';
import { materialsBySuffix, mixHex, tintMaterial } from '../../src/avatar/materials';
import { shadeFor } from '../../src/color/oklab';

function named(name: string) {
  const m = new MToonMaterial();
  m.name = name;
  return m;
}

test('materialsBySuffix finds unique MToon materials by name suffix', () => {
  const root = new Group();
  const skin = named('Body_00_SKIN');
  root.add(
    new Mesh(new BufferGeometry(), skin),
    new Mesh(new BufferGeometry(), skin),
    new Mesh(new BufferGeometry(), named('Hair_00_HAIR')),
  );
  expect(materialsBySuffix(root, '_SKIN')).toEqual([skin]);
  expect(materialsBySuffix(root, '_HAIR')).toHaveLength(1);
  expect(materialsBySuffix(root, '_EYE')).toHaveLength(0);
});

test('tintMaterial sets color and a darker shade', () => {
  const m = named('Body_00_SKIN');
  tintMaterial(m, '#c68642');
  expect('#' + m.color.getHexString()).toBe('#c68642');
  expect('#' + m.shadeColorFactor.getHexString()).toBe(shadeFor('#c68642'));
});

test('mixHex interpolates in OKLab and returns hex', () => {
  expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
  expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  const mid = mixHex('#000000', '#ffffff', 0.5);
  expect(mid).toMatch(/^#[0-9a-f]{6}$/);
});
