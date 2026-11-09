import { appendAccessor, readAccessor } from './accessors';
import type { GlbDoc } from './types';

export class MorphTopologyError extends Error {
  mesh: string;
  primitive: number;
  constructor(mesh: string, primitive: number, detail: string) {
    super(`morph variant topology mismatch on mesh "${mesh}" primitive ${primitive}: ${detail}`);
    this.name = 'MorphTopologyError';
    this.mesh = mesh;
    this.primitive = primitive;
  }
}

export type MorphVariant = { name: string; doc: GlbDoc };

/**
 * Adds one morph target per variant to every mesh the variant actually changes (spec §7).
 * Deltas are POSITION and NORMAL (variant − base). A target is added to ALL primitives of an
 * affected mesh so indices line up across primitives; existing targets (VRM expressions) keep
 * their indices because new ones are appended.
 */
export function addMorphTargets(
  input: GlbDoc,
  variants: MorphVariant[],
  opts: { epsilon?: number } = {},
): GlbDoc {
  const epsilon = opts.epsilon ?? 1e-6;
  const doc: GlbDoc = { json: structuredClone(input.json), bin: input.bin.slice() };

  doc.json.meshes.forEach(
    (
      mesh: { name?: string; primitives: Primitive[]; extras?: { targetNames?: string[] } },
      meshIndex: number,
    ) => {
      const meshName = mesh.name ?? `mesh ${meshIndex}`;
      for (const variant of variants) {
        const variantMesh = variant.doc.json.meshes[meshIndex] as
          { name?: string; primitives: Primitive[] } | undefined;
        if (!variantMesh || variantMesh.primitives.length !== mesh.primitives.length) {
          throw new MorphTopologyError(meshName, 0, 'primitive count differs');
        }
        const deltas = mesh.primitives.map((prim, primIndex) => {
          const basePos = readAccessor(input, prim.attributes.POSITION!) as Float32Array;
          const varPos = readAccessor(
            variant.doc,
            variantMesh.primitives[primIndex]!.attributes.POSITION!,
          ) as Float32Array;
          if (basePos.length !== varPos.length) {
            throw new MorphTopologyError(
              meshName,
              primIndex,
              `vertex count ${basePos.length / 3} vs ${varPos.length / 3}`,
            );
          }
          const pos = diff(basePos, varPos);
          let nrm: Float32Array | null = null;
          if (
            prim.attributes.NORMAL !== undefined &&
            variantMesh.primitives[primIndex]!.attributes.NORMAL !== undefined
          ) {
            const baseNrm = readAccessor(input, prim.attributes.NORMAL) as Float32Array;
            const varNrm = readAccessor(
              variant.doc,
              variantMesh.primitives[primIndex]!.attributes.NORMAL!,
            ) as Float32Array;
            if (baseNrm.length === varNrm.length) nrm = diff(baseNrm, varNrm);
          }
          return { pos, nrm };
        });

        const affected = deltas.some((d) => maxAbs(d.pos) > epsilon);
        if (!affected) continue;

        mesh.primitives.forEach((prim, primIndex) => {
          const d = deltas[primIndex]!;
          const target: Record<string, number> = {
            POSITION: appendAccessor(doc, d.pos, 'VEC3', { minMax: true }),
          };
          if (d.nrm) target.NORMAL = appendAccessor(doc, d.nrm, 'VEC3');
          prim.targets ??= [];
          prim.targets.push(target);
        });
        mesh.extras ??= {};
        mesh.extras.targetNames ??= [];
        // Keep names aligned with targets: three.js discards targetNames when lengths differ.
        const existing = (mesh.primitives[0]?.targets?.length ?? 1) - 1;
        while (mesh.extras.targetNames.length < existing) {
          mesh.extras.targetNames.push(`target_${mesh.extras.targetNames.length}`);
        }
        mesh.extras.targetNames.push(variant.name);
      }
    },
  );

  return doc;
}

type Primitive = { attributes: Record<string, number>; targets?: Record<string, number>[] };

function diff(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = b[i]! - a[i]!;
  return out;
}

function maxAbs(a: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]!);
    if (v > m) m = v;
  }
  return m;
}
