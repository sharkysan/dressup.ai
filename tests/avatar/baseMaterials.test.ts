import {
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from 'three';
import { EyeTextures, standardMaterial } from '../../src/avatar/baseMaterials';
import { eyeTextureUrl } from '../../src/avatar/baseContract';

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A loader whose loads resolve only when the test says so. */
function manualLoader() {
  const pending = new Map<string, { resolve: (t: Texture) => void; reject: (e: Error) => void }>();
  const load = vi.fn(
    (url: string) =>
      new Promise<Texture>((resolve, reject) => pending.set(url, { resolve, reject })),
  );
  return { load, pending };
}

function eyesMaterial() {
  const material = new MeshStandardMaterial({ alphaTest: 0.5 });
  material.name = 'Eyes';
  material.map = new Texture();
  return material;
}

test('standardMaterial finds a standard material by name', () => {
  const root = new Group();
  const skin = new MeshStandardMaterial();
  skin.name = 'Skin';
  const basic = new MeshBasicMaterial();
  basic.name = 'Eyes';
  root.add(new Mesh(new BufferGeometry(), [basic, skin]));
  expect(standardMaterial(root, 'Skin')).toBe(skin);
  expect(standardMaterial(root, 'Eyes')).toBeUndefined();
  expect(standardMaterial(root, 'Teeth')).toBeUndefined();
});

test('the latest eye preset wins when the loads finish out of order', async () => {
  const { load, pending } = manualLoader();
  const eyes = new EyeTextures(load);
  const material = eyesMaterial();
  const blue = new Texture();
  const green = new Texture();

  eyes.set(material, 'blue');
  eyes.set(material, 'green');
  pending.get(eyeTextureUrl('green'))!.resolve(green);
  await settle();
  pending.get(eyeTextureUrl('blue'))!.resolve(blue);
  await settle();

  expect(material.map).toBe(green);
});

test('an eye texture loads once, uses glTF UVs in sRGB, keeps the alpha mask and frees the base map', async () => {
  const { load, pending } = manualLoader();
  const eyes = new EyeTextures(load);
  const material = eyesMaterial();
  const disposed = vi.fn();
  material.map!.addEventListener('dispose', disposed);
  const green = new Texture();

  eyes.set(material, 'green');
  pending.get(eyeTextureUrl('green'))!.resolve(green);
  await settle();
  eyes.set(material, 'blue');
  eyes.set(material, 'green');
  await settle();

  expect(material.map).toBe(green);
  expect(load).toHaveBeenCalledTimes(2); // green once, blue once
  expect(green.flipY).toBe(false);
  expect(green.colorSpace).toBe(SRGBColorSpace);
  expect(material.alphaTest).toBe(0.5);
  expect(material.transparent).toBe(false);
  expect(disposed).toHaveBeenCalledTimes(1);
});

test('a failed eye load keeps the current texture and is retried on the next request', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { load, pending } = manualLoader();
  const eyes = new EyeTextures(load);
  const material = eyesMaterial();
  const original = material.map;

  eyes.set(material, 'grey');
  pending.get(eyeTextureUrl('grey'))!.reject(new Error('HTTP 404'));
  await settle();
  expect(material.map).toBe(original);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('grey'), expect.any(Error));

  const grey = new Texture();
  eyes.set(material, 'grey');
  pending.get(eyeTextureUrl('grey'))!.resolve(grey);
  await settle();
  expect(material.map).toBe(grey);
  warn.mockRestore();
});

test('dispose frees the loaded eye textures and one that lands later', async () => {
  const { load, pending } = manualLoader();
  const eyes = new EyeTextures(load);
  const material = eyesMaterial();
  const green = new Texture();
  const blue = new Texture();
  const freed = vi.fn();
  green.addEventListener('dispose', freed);
  blue.addEventListener('dispose', freed);

  eyes.set(material, 'green');
  pending.get(eyeTextureUrl('green'))!.resolve(green);
  await settle();
  eyes.set(material, 'blue');
  eyes.dispose();
  pending.get(eyeTextureUrl('blue'))!.resolve(blue);
  await settle();

  expect(freed).toHaveBeenCalledTimes(2);
  expect(material.map).toBe(green);
});
