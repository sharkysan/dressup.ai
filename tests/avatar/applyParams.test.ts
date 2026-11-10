import { VRMExpression, VRMExpressionManager, type VRM } from '@pixiv/three-vrm';
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { applyParams, setExpression } from '../../src/avatar/applyParams';
import { ALL_BODY_TARGETS, type BaseMeta } from '../../src/avatar/baseContract';
import { EyeTextures } from '../../src/avatar/baseMaterials';
import { avatarScale, bodyInfluences, groundOffset } from '../../src/avatar/body';
import { GARMENT_ROUGHNESS, SkinTexture } from '../../src/avatar/bodyTexture';
import { defaultParams, type AvatarParams } from '../../src/catalog/params';

const meta: BaseMeta = {
  version: 1,
  heightM: 1.65,
  minY: -0.01,
  morphHeightDelta: { body_legLength_max: 0.18, body_legLength_min: -0.13 },
  morphMinYDelta: { body_legLength_max: -0.1 },
};

const SIZE = 4;
/** The skin image's pixels: a gradient, so a stale or accumulated composite would show. */
const skinPixels = Uint8ClampedArray.from({ length: SIZE * SIZE * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 7) % 256,
);
/** Base layer: the first texel opaque crop top, the rest clear. */
const baseLayer = {
  data: Uint8ClampedArray.from({ length: SIZE * SIZE * 4 }, (_, i) =>
    i < 4 ? [233, 230, 225, 255][i]! : 0,
  ),
  width: SIZE,
  height: SIZE,
} as ImageData;

/**
 * jsdom has no 2D canvas: a stand-in whose drawImage paints the skin pixels and whose canvas pixels the
 * test reads back.
 */
function fakeCanvas() {
  let pixels = new Uint8ClampedArray(skinPixels.length);
  const context = {
    drawImage: () => {
      pixels = skinPixels.slice();
    },
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: pixels.slice(),
      width,
      height,
    }),
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    putImageData: (image: ImageData) => {
      pixels = image.data.slice();
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
  return () => pixels;
}

function named(name: string, options = {}) {
  const m = new MeshStandardMaterial(options);
  m.name = name;
  return m;
}

/** A stand-in VRM: the base's materials on plain meshes, the body targets on Body, the expressions. */
function fakeVrm() {
  const scene = new Group();
  const skin = named('Skin', { map: new Texture() });
  const eyes = named('Eyes', { map: new Texture(), alphaTest: 0.5 });
  const brows = named('Brows');
  const lashes = named('Lashes');
  const body = new Mesh(new BufferGeometry(), skin);
  body.morphTargetDictionary = Object.fromEntries(ALL_BODY_TARGETS.map((name, i) => [name, i]));
  body.morphTargetInfluences = ALL_BODY_TARGETS.map(() => 0);
  scene.add(
    body,
    new Mesh(new BufferGeometry(), eyes),
    new Mesh(new BufferGeometry(), brows),
    new Mesh(new BufferGeometry(), lashes),
  );

  const expressionManager = new VRMExpressionManager();
  for (const name of ['neutral', 'happy', 'relaxed', 'surprised', 'blinkLeft']) {
    expressionManager.registerExpression(new VRMExpression(name));
  }
  const vrm = { scene, expressionManager } as unknown as VRM;
  return { vrm, scene, body, skin, eyes, brows, lashes, expressionManager };
}

const eyeTexture = new Texture();
function context() {
  const canvasPixels = fakeCanvas();
  const skin = new SkinTexture({} as CanvasImageSource, baseLayer, 0.5);
  const eyes = new EyeTextures(() => Promise.resolve(eyeTexture));
  return { ctx: { skin, eyes, meta }, canvasPixels };
}

const params = (patch: Partial<AvatarParams> = {}): AvatarParams => ({
  ...defaultParams,
  skin: '#8d5524',
  hairColor: '#4a2f1b',
  eyeColor: 'blue',
  ...patch,
});

afterEach(() => vi.restoreAllMocks());

test('setExpression resets the previous preset', () => {
  const { vrm, expressionManager: em } = fakeVrm();
  setExpression(vrm, 'happy');
  setExpression(vrm, 'surprised');
  expect(em.getValue('happy')).toBe(0);
  expect(em.getValue('surprised')).toBe(1);
});

test('wink maps to blinkLeft and neutral clears all', () => {
  const { vrm, expressionManager: em } = fakeVrm();
  setExpression(vrm, 'wink');
  expect(em.getValue('blinkLeft')).toBe(1);
  setExpression(vrm, 'neutral');
  expect(em.getValue('blinkLeft')).toBe(0);
  expect(em.getValue('happy')).toBe(0);
});

test('applyParams puts the tinted skin under the base layer, sets the eyes and tints brows and lashes', async () => {
  const { vrm, skin, eyes, brows, lashes } = fakeVrm();
  const { ctx, canvasPixels } = context();
  const setEyes = vi.spyOn(ctx.eyes, 'set');

  applyParams(vrm, params(), ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(skin.map).toBe(ctx.skin.update('#8d5524'));
  const pixels = canvasPixels();
  expect([...pixels.slice(0, 4)]).toEqual([233, 230, 225, 255]); // the crop top, untinted
  expect(pixels[4]).toBe(Math.round((skinPixels[4]! * 0x8d) / 255)); // tinted skin
  expect(setEyes).toHaveBeenCalledWith(eyes, 'blue');
  expect(eyes.map).toBe(eyeTexture);
  expect(eyes.alphaTest).toBe(0.5);
  expect('#' + brows.color.getHexString()).toBe('#4a2f1b');
  expect('#' + lashes.color.getHexString()).toBe('#4a2f1b');
});

test('applyParams gives the skin the base layer roughness map at roughness 1: matte garments, the skin as it was', () => {
  const { vrm, skin } = fakeVrm();
  const { ctx } = context();

  applyParams(vrm, params(), ctx);

  expect(skin.roughnessMap).toBe(ctx.skin.roughnessMap);
  expect(skin.roughness).toBe(1);
  const g = (texel: number) => (ctx.skin.roughnessMap.image.data as Uint8Array)[texel * 2 + 1]!;
  expect(g(0)).toBe(Math.round(255 * GARMENT_ROUGHNESS)); // the crop top texel
  expect(g(1)).toBe(Math.round(255 * 0.5)); // clear: the skin's own roughness
  // Tint changes leave it alone.
  applyParams(vrm, params({ skin: '#f1d7c8' }), ctx);
  expect(skin.roughnessMap).toBe(ctx.skin.roughnessMap);
  expect(g(0)).toBe(Math.round(255 * GARMENT_ROUGHNESS));
});

test('applying the same params twice leaves the brows and the skin canvas as applying once', () => {
  const { vrm, brows, expressionManager: em } = fakeVrm();
  const { ctx, canvasPixels } = context();
  const p = params({ expression: 'happy' });

  applyParams(vrm, p, ctx);
  const browsOnce = brows.color.getHex();
  const pixelsOnce = canvasPixels().slice();
  applyParams(vrm, p, ctx);
  expect(brows.color.getHex()).toBe(browsOnce);
  expect(canvasPixels()).toEqual(pixelsOnce);
  expect(em.getValue('happy')).toBe(1);

  // A different tint and back: composited from the skin image, never from the canvas.
  applyParams(vrm, params({ skin: '#f1d7c8', hairColor: '#e8c872' }), ctx);
  expect(canvasPixels()).not.toEqual(pixelsOnce);
  applyParams(vrm, p, ctx);
  expect(canvasPixels()).toEqual(pixelsOnce);
  expect(brows.color.getHex()).toBe(browsOnce);
});

test('applyParams sets the body morphs, height scale and grounding', () => {
  const { vrm, body } = fakeVrm();
  const { ctx } = context();
  const shape = { ...defaultParams.body, weight: 0.6, waist: -0.4, legLength: 1, heightCm: 172 };

  applyParams(vrm, params({ body: shape }), ctx);

  const expected = bodyInfluences(shape);
  for (const name of ALL_BODY_TARGETS) {
    expect(body.morphTargetInfluences![body.morphTargetDictionary![name]!], name).toBe(
      expected[name],
    );
  }
  const scale = avatarScale(shape, meta);
  expect(vrm.scene.scale.y).toBeCloseTo(scale, 9);
  expect(vrm.scene.position.y).toBeCloseTo(groundOffset(shape, meta, scale), 9);
});
