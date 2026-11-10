/**
 * processHair: the stock hairstyles tools/blender/build_base.py exports, <work>/hair/<id>.glb, → <out>/<id>.glb.
 * Each: grey base-colour texture (tinted with the hair colour at runtime) → texture size → sparse morph
 * targets → WebP textures → prune → validate against the bones of the just-built <work>/base.vrm →
 * size budget. Nothing is written unless every hairstyle passes; then each file is written atomically,
 * and any other file in <out> is left alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { human } from '../cli';
import { readGlb, writeGlb } from '../glb/glb';
import { pruneUnused } from '../glb/prune';
import { sparsifyMorphTargets } from '../glb/sparsify';
import { getImage, neutralizeImage, replaceImage, resizeImages } from '../glb/textures';
import { convertImagesToWebp } from '../glb/webp';
import { HAIR, HAIR_TEXTURE_SIZE, jointNames, validateHair } from './validateHair';
import { writeAtomically } from './writeAtomically';

/** Spec §12: each hairstyle ≤1 MiB. */
export const HAIR_BUDGET_BYTES = 1024 * 1024;
const WEBP_QUALITY = 90;

async function processOne(file: string, bones: string[], budget: number): Promise<Uint8Array> {
  let doc = readGlb(new Uint8Array(fs.readFileSync(file)));
  // On the exported PNG, before the WebP conversion. Only the base colour: any other map keeps its data.
  const material = doc.json.materials.find((m: { name?: string }) => m.name === HAIR);
  const texture = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texture === undefined) throw new Error(`material ${HAIR} has no base-colour texture`);
  const image = doc.json.images[doc.json.textures[texture].source].name;
  replaceImage(doc, image, neutralizeImage(getImage(doc, image), 'luminance'));
  resizeImages(doc, () => HAIR_TEXTURE_SIZE);
  // Within 1e-6 counts as still, as for the base: the Surface Deform capture leaves float noise.
  doc = sparsifyMorphTargets(doc, { epsilon: 1e-6 });
  if (!(await convertImagesToWebp(doc, WEBP_QUALITY))) {
    throw new Error('WebP conversion needs `sharp`');
  }
  doc = pruneUnused(doc);
  const problems = validateHair(doc, bones);
  if (problems.length > 0) throw new Error(`invalid:\n  ${problems.join('\n  ')}`);
  const bytes = writeGlb(doc);
  if (bytes.byteLength > budget) {
    throw new Error(`${human(bytes.byteLength)}, over its ${human(budget)} budget`);
  }
  return bytes;
}

export async function processHair(
  work: string,
  out: string,
  budgetBytes: number = HAIR_BUDGET_BYTES,
): Promise<{ id: string; bytes: number }[]> {
  const bones = jointNames(readGlb(new Uint8Array(fs.readFileSync(path.join(work, 'base.vrm')))));
  const dir = path.join(work, 'hair');
  const ids = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.slice(0, -'.glb'.length))
    .sort();
  if (ids.length === 0) throw new Error(`Blender wrote no hairstyle to ${dir}`);
  const built = new Map<string, Uint8Array>();
  for (const id of ids) {
    try {
      built.set(id, await processOne(path.join(dir, `${id}.glb`), bones, budgetBytes));
    } catch (e) {
      throw new Error(`hair "${id}": ${e instanceof Error ? e.message : e}`);
    }
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [id, bytes] of built) writeAtomically(path.join(out, `${id}.glb`), bytes);
  return [...built].map(([id, bytes]) => ({ id, bytes: bytes.byteLength }));
}
