/**
 * processHair: the stock hairstyles tools/blender/build_base.py exports, <work>/hair/<id>.glb, → <out>/<id>.glb.
 * Each: grey base-colour texture (tinted with the hair colour at runtime) → texture size → sparse morph
 * targets → WebP textures → prune → head binding to the base's head (spec §8) → validate against the
 * bones of the just-built <work>/base.vrm and its Body → size budget. Nothing is written unless every
 * hairstyle passes; then each file is written atomically, and any other file in <out> is left alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Correspondence } from '../../src/likeness/correspondence';
import { HEADBIND_IDX, HEADBIND_W, headBinding } from '../../src/likeness/headBinding';
import { human } from '../cli';
import { appendAccessor, readAccessor } from '../glb/accessors';
import { readGlb, writeGlb } from '../glb/glb';
import { pruneUnused } from '../glb/prune';
import { sparsifyMorphTargets } from '../glb/sparsify';
import { bleedAlpha, getImage, neutralizeImage, replaceImage, resizeImages } from '../glb/textures';
import type { GlbDoc } from '../glb/types';
import { convertImagesToWebp } from '../glb/webp';
import { HAIR, HAIR_TEXTURE_SIZE, jointNames, validateHair } from './validateHair';
import { writeAtomically } from './writeAtomically';

/** Plan Global Constraints: each hairstyle ≤1 MiB; the headroom exists because meshopt is an M7 item. */
export const HAIR_BUDGET_BYTES = 1024 * 1024;
const WEBP_QUALITY = 90;
const HAIR_ROUGHNESS = 0.9;
const ARRAY_BUFFER = 34962;

/** What a hairstyle needs of the base's correspondence: the head it binds to, the Body it indexes. */
export type HairBase = Pick<Correspondence, 'head' | 'bodyVertexCount'>;

/**
 * Adds the head binding (spec §8, src/likeness/headBinding.ts) of every primitive of the mesh named
 * `mesh` as its _HEADBIND_IDX and _HEADBIND_W attributes. `parts` gives a primitive's vertices, from their
 * positions, their rigid parts (headBinding's `parts`); without it each vertex binds on its own.
 */
export function addHeadBinding(
  doc: GlbDoc,
  mesh: string,
  head: Correspondence['head'],
  parts?: (positions: Float32Array) => Int32Array,
): void {
  const found = doc.json.meshes.find((m: { name?: string }) => m.name === mesh);
  if (!found) throw new Error(`mesh ${mesh} is missing`);
  for (const primitive of found.primitives) {
    const positions = readAccessor(doc, primitive.attributes.POSITION) as Float32Array;
    const { idx, w } = headBinding(positions, head, parts?.(positions));
    primitive.attributes[HEADBIND_IDX] = appendAccessor(doc, idx, 'VEC3', { target: ARRAY_BUFFER });
    primitive.attributes[HEADBIND_W] = appendAccessor(doc, w, 'VEC3', { target: ARRAY_BUFFER });
  }
}

async function processOne(
  file: string,
  bones: string[],
  base: HairBase,
  budget: number,
): Promise<Uint8Array> {
  let doc = readGlb(new Uint8Array(fs.readFileSync(file)));
  // On the exported PNG, before the WebP conversion. Only the base colour: any other map keeps its data.
  const material = doc.json.materials.find((m: { name?: string }) => m.name === HAIR);
  const texture = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texture === undefined) throw new Error(`material ${HAIR} has no base-colour texture`);
  const image = doc.json.images[doc.json.textures[texture].source].name;
  // Bled before the resize and the WebP conversion, so the mips and the WebP inherit the edge colour.
  replaceImage(doc, image, bleedAlpha(neutralizeImage(getImage(doc, image), 'luminance')));
  // The cards are flat and overlap at the crown: at the exporter's roughness (0.5) their differing normals
  // read as a glossy, blotchy band. Hair is matte.
  material.pbrMetallicRoughness.roughnessFactor = HAIR_ROUGHNESS;
  resizeImages(doc, () => HAIR_TEXTURE_SIZE);
  // Within 1e-6 counts as still, as for the base: the Surface Deform capture leaves float noise.
  doc = sparsifyMorphTargets(doc, { epsilon: 1e-6 });
  if (!(await convertImagesToWebp(doc, WEBP_QUALITY, { exact: true }))) {
    throw new Error('WebP conversion needs `sharp`');
  }
  doc = pruneUnused(doc);
  addHeadBinding(doc, HAIR, base.head);
  const problems = validateHair(doc, bones, base.bodyVertexCount);
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
  base: HairBase,
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
      built.set(id, await processOne(path.join(dir, `${id}.glb`), bones, base, budgetBytes));
    } catch (e) {
      throw new Error(`hair "${id}": ${e instanceof Error ? e.message : e}`);
    }
  }
  fs.mkdirSync(out, { recursive: true });
  for (const [id, bytes] of built) writeAtomically(path.join(out, `${id}.glb`), bytes);
  return [...built].map(([id, bytes]) => ({ id, bytes: bytes.byteLength }));
}
