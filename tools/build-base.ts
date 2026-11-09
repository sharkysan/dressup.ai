/**
 * build-base: VRoid VRM → game base avatar (spec §7).
 *   tsx tools/build-base.ts --src assets/source/base-a --out public/assets/avatars/base-a.vrm [--morphs DIR] [--max-texture 1024] [--webp]
 * Steps: removeHair → neutralise skin/iris textures → resize → add face morph targets from
 * <morphs>/<param>.{min,max}.vrm (same topology as neutral.vrm) → optional WebP → prune → write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cli, human, required } from './cli';
import { addMorphTargets, type MorphVariant } from './glb/addMorphTargets';
import { readGlb, writeGlb } from './glb/glb';
import { pruneUnused } from './glb/prune';
import { removeHair } from './glb/removeHair';
import { sparsifyMorphTargets } from './glb/sparsify';
import { convertImagesToWebp } from './glb/webp';
import {
  getImage,
  neutralizeImage,
  replaceImage,
  resizeImage,
  type NeutralizeMode,
} from './glb/textures';
import type { GlbDoc } from './glb/types';

const SKIN_SUFFIX = '_SKIN';
const IRIS_PREFIX = 'EyeIris';

export function neutralizeBaseTextures(doc: GlbDoc): string[] {
  const done = new Set<string>();
  const touched: string[] = [];
  const process = (materialFilter: (name: string) => boolean, mode: NeutralizeMode) => {
    for (const material of doc.json.materials) {
      if (!materialFilter(String(material.name ?? ''))) continue;
      const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
      if (textureIndex === undefined) continue;
      const image = doc.json.images[doc.json.textures[textureIndex].source];
      if (!image?.name || done.has(image.name)) continue;
      replaceImage(doc, image.name, neutralizeImage(getImage(doc, image.name), mode));
      done.add(image.name);
      touched.push(`${image.name} (${mode})`);
    }
  };
  process((n) => n.endsWith(SKIN_SUFFIX), 'divideByMedian');
  process((n) => n.startsWith(IRIS_PREFIX), 'luminance');
  return touched;
}

export function resizeAllImages(doc: GlbDoc, maxSize: number): void {
  for (const image of doc.json.images) {
    if (!image.name || image.bufferView === undefined) continue;
    const png = getImage(doc, image.name);
    const resized = resizeImage(png, maxSize);
    if (resized !== png) replaceImage(doc, image.name, resized);
  }
}

/** `<dir>/<param>.min.vrm` → variant name `<param>_min`; hair is removed so mesh indices match the base. */
export function loadMorphVariants(dir: string): MorphVariant[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(min|max)\.vrm$/.test(f))
    .sort()
    .map((f) => {
      const m = /^(.+)\.(min|max)\.vrm$/.exec(f)!;
      return {
        name: `${m[1]}_${m[2]}`,
        doc: removeHair(readGlb(new Uint8Array(fs.readFileSync(path.join(dir, f))))),
      };
    });
}

export async function buildBase(opts: {
  src: string;
  out: string;
  morphs?: string;
  maxTexture: number;
  webp: boolean;
}) {
  const neutralPath = path.join(opts.src, 'neutral.vrm');
  if (!fs.existsSync(neutralPath)) throw new Error(`missing ${neutralPath}`);
  let doc = removeHair(readGlb(new Uint8Array(fs.readFileSync(neutralPath))));
  const neutralised = neutralizeBaseTextures(doc);
  resizeAllImages(doc, opts.maxTexture);
  const variants = loadMorphVariants(opts.morphs ?? path.join(opts.src, 'morphs'));
  doc = addMorphTargets(doc, variants);
  doc = sparsifyMorphTargets(doc);
  if (opts.webp) await convertImagesToWebp(doc);
  doc = pruneUnused(doc);
  const bytes = writeGlb(doc);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, bytes);
  return { bytes: bytes.byteLength, neutralised, morphs: variants.map((v) => v.name) };
}

if (process.argv[1] && /build-base\.(ts|js)$/.test(process.argv[1])) {
  const args = cli(['src', 'out', 'morphs', 'max-texture'] as const, ['webp'] as const, {
    'max-texture': '1024',
  });
  buildBase({
    src: required(args.src, 'src'),
    out: required(args.out, 'out'),
    morphs: args.morphs,
    maxTexture: Number(args['max-texture']),
    webp: args.webp,
  })
    .then((r) => {
      console.log(`neutralised: ${r.neutralised.join(', ') || 'none'}`);
      console.log(`morph targets: ${r.morphs.join(', ') || 'none'}`);
      console.log(`wrote ${args.out} (${human(r.bytes)})`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
