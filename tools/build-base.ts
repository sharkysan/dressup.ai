/**
 * build-base: the realistic MakeHuman base (spec §4, §7), built headlessly in Blender, → <out>/base.vrm,
 * <out>/base.json (height metadata, baseMetaSchema), <out>/baselayer.webp (the undershirt and shorts,
 * painted over the skin at runtime), <out>/regions.png (region-ID map) and <out>/eyes/<preset>.webp (one
 * eye texture per eye-colour preset).
 *   tsx tools/build-base.ts --out public/assets/base
 * Steps: write the naming contract → tools/blender/build_base.py (MPFB human, rig, proxies, T-pose,
 * expressions, body-shape targets, region and base-layer maps, eye textures, VRM 1.0 export, base.json)
 * → neutral skin, brow and lash textures → texture sizes → sparse morph targets → WebP textures → prune
 * → validate against the contract, and base.json against its schema → size budget → atomic writes.
 * Needs the Blender toolchain (npm run blender:setup).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MATERIALS, baseMetaSchema, contractJson } from '../src/avatar/baseContract';
import { avatarParamsSchema } from '../src/catalog/params';
import { validateBase } from './base/validateBase';
import { writeAtomically } from './base/writeAtomically';
import { cli, human, required } from './cli';
import { readGlb, writeGlb } from './glb/glb';
import { pruneUnused } from './glb/prune';
import { sparsifyMorphTargets } from './glb/sparsify';
import {
  getImage,
  neutralizeImage,
  replaceImage,
  resizeImages,
  type NeutralizeMode,
} from './glb/textures';
import type { GlbDoc } from './glb/types';
import { convertImagesToWebp } from './glb/webp';

/** Spec §12 leaves 8 MB for the base and default outfit; the base gets 6 MiB of it. */
export const BASE_BUDGET_BYTES = 6 * 1024 * 1024;

/**
 * Base-colour textures made neutral for runtime tinting (spec §7): the skin keeps its shading under a
 * neutral tone, brows and lashes turn grey and take the hair colour.
 */
const NEUTRALISE: Record<string, NeutralizeMode> = {
  [MATERIALS.skin]: 'divideByMedian',
  [MATERIALS.brows]: 'luminance',
  [MATERIALS.lashes]: 'luminance',
};
/** The Skin texture stays at the 2048² the face texture is composited into (spec §7); the rest ≤1024². */
const maxTextureSize = (_image: string, material: string) =>
  material === MATERIALS.skin ? 2048 : 1024;
const EYE_TEXTURE_SIZE = 512;
const WEBP_QUALITY = 90;

/** Replaces each NEUTRALISE material's base-colour image (still PNG) with its neutral version. */
function neutraliseTextures(doc: GlbDoc): void {
  for (const [name, mode] of Object.entries(NEUTRALISE)) {
    const material = doc.json.materials.find((m: { name?: string }) => m.name === name);
    const texture = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (texture === undefined) throw new Error(`material ${name} has no base-colour texture`);
    const image = doc.json.images[doc.json.textures[texture].source].name;
    replaceImage(doc, image, neutralizeImage(getImage(doc, image), mode));
  }
}

/** <work>/eyes/<preset>.png for every eye-colour preset, as WebP at EYE_TEXTURE_SIZE² (alpha kept). */
async function eyeTextures(work: string): Promise<Map<string, Uint8Array>> {
  const presets = avatarParamsSchema.shape.eyeColor.options;
  const files = fs.readdirSync(path.join(work, 'eyes')).sort();
  const expected = presets.map((p) => `${p}.png`).sort();
  if (files.join() !== expected.join()) {
    throw new Error(
      `Blender wrote eye textures ${files.join(', ')}, expected ${expected.join(', ')}`,
    );
  }
  const out = new Map<string, Uint8Array>();
  for (const preset of presets) {
    const webp = await sharp(path.join(work, 'eyes', `${preset}.png`))
      .resize(EYE_TEXTURE_SIZE, EYE_TEXTURE_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    out.set(path.join('eyes', `${preset}.webp`), new Uint8Array(webp));
  }
  return out;
}

export async function buildBase(opts: {
  out: string;
  budgetBytes?: number;
}): Promise<{ bytes: number; problems: string[]; outputs: { file: string; bytes: number }[] }> {
  const budget = opts.budgetBytes ?? BASE_BUDGET_BYTES;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-base-'));
  try {
    const contract = path.join(work, 'contract.json');
    fs.writeFileSync(contract, JSON.stringify(contractJson(), null, 2));
    const blender = spawnSync(
      'tools/blender/run.sh',
      ['tools/blender/build_base.py', '--', '--contract', contract, '--work', work],
      { stdio: 'inherit' },
    );
    if (blender.error) throw blender.error;
    if (blender.status !== 0) {
      throw new Error(`Blender build failed (${blender.signal ?? `exit ${blender.status}`})`);
    }

    let doc = readGlb(new Uint8Array(fs.readFileSync(path.join(work, 'base.vrm'))));
    // On the exported PNGs, before the WebP conversion.
    neutraliseTextures(doc);
    resizeImages(doc, maxTextureSize);
    // The exporter writes every morph target dense, though most move only part of a mesh. Within 1e-6
    // counts as still: the proxies' Surface Deform capture leaves up to ~7e-7 m on vertices that don't move.
    doc = sparsifyMorphTargets(doc, { epsilon: 1e-6 });
    // MPFB's PNG textures alone are over the budget; WebP brings them well under it.
    if (!(await convertImagesToWebp(doc, WEBP_QUALITY))) {
      throw new Error('WebP conversion needs `sharp`');
    }
    doc = pruneUnused(doc);
    const problems = validateBase(doc);
    if (problems.length > 0) {
      throw new Error(`base.vrm breaks the naming contract:\n  ${problems.join('\n  ')}`);
    }
    const meta = fs.readFileSync(path.join(work, 'base.json'));
    const parsed = baseMetaSchema.safeParse(JSON.parse(meta.toString('utf8')));
    if (!parsed.success) throw new Error(`base.json is invalid: ${parsed.error.message}`);

    const bytes = writeGlb(doc);
    if (bytes.byteLength > budget) {
      throw new Error(`base.vrm is ${human(bytes.byteLength)}, over its ${human(budget)} budget`);
    }
    // Published path (relative to out) -> bytes. regions.png stays PNG: its codes must survive exactly.
    const files = new Map<string, Uint8Array>([
      ['base.vrm', bytes],
      ['base.json', meta],
      [
        'baselayer.webp',
        new Uint8Array(
          await sharp(path.join(work, 'baselayer.png')).webp({ quality: WEBP_QUALITY }).toBuffer(),
        ),
      ],
      ['regions.png', fs.readFileSync(path.join(work, 'regions.png'))],
      ...(await eyeTextures(work)),
    ]);
    fs.mkdirSync(path.join(opts.out, 'eyes'), { recursive: true });
    for (const [file, data] of files) writeAtomically(path.join(opts.out, file), data);
    const outputs = [...files].map(([file, data]) => ({ file, bytes: data.byteLength }));
    return { bytes: bytes.byteLength, problems, outputs };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && /build-base\.(ts|js)$/.test(process.argv[1])) {
  const args = cli(['out'] as const, [] as const);
  const out = required(args.out, 'out');
  buildBase({ out })
    .then((r) => {
      for (const o of r.outputs) console.log(`wrote ${path.join(out, o.file)} (${human(o.bytes)})`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
