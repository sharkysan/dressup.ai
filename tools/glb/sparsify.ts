import { readAccessor } from './accessors';
import type { GlbDoc } from './types';

/**
 * Rewrites morph-target accessors whose non-zero vertices are below `threshold` (fraction) as glTF
 * sparse accessors: no base bufferView (implicit zeros) plus index/value patches. Dense accessors
 * left behind are removed by a later pruneUnused. An all-zero target gets neither bufferView nor sparse.
 * A component with |value| <= `epsilon` counts as zero (default 0: only exact zeros), so float noise
 * doesn't keep a vertex.
 */
export function sparsifyMorphTargets(
  input: GlbDoc,
  opts: { threshold?: number; epsilon?: number } = {},
): GlbDoc {
  const threshold = opts.threshold ?? 0.5;
  const epsilon = opts.epsilon ?? 0;
  const doc: GlbDoc = { json: structuredClone(input.json), bin: input.bin.slice() };
  const seen = new Set<number>();

  for (const mesh of doc.json.meshes) {
    for (const prim of mesh.primitives) {
      for (const target of prim.targets ?? []) {
        for (const key of Object.keys(target)) {
          const accessorIndex = target[key] as number;
          if (seen.has(accessorIndex)) continue;
          seen.add(accessorIndex);
          const acc = doc.json.accessors[accessorIndex];
          if (acc.sparse || acc.bufferView === undefined || acc.componentType !== 5126) continue;
          const comps =
            acc.type === 'VEC3' ? 3 : acc.type === 'VEC4' ? 4 : acc.type === 'VEC2' ? 2 : 1;
          const data = readAccessor(input, accessorIndex) as Float32Array;
          const nonZero: number[] = [];
          for (let v = 0; v < acc.count; v++) {
            let moved = false;
            for (let c = 0; c < comps; c++) {
              if (Math.abs(data[v * comps + c]!) > epsilon) moved = true;
            }
            if (moved) nonZero.push(v);
          }
          if (nonZero.length > acc.count * threshold) continue;

          if (acc.min && acc.max) {
            // The dropped vertices now read as 0, which can move min/max by up to epsilon.
            acc.min = new Array<number>(comps).fill(0);
            acc.max = new Array<number>(comps).fill(0);
            for (const v of nonZero) {
              for (let c = 0; c < comps; c++) {
                acc.min[c] = Math.min(acc.min[c], data[v * comps + c]!);
                acc.max[c] = Math.max(acc.max[c], data[v * comps + c]!);
              }
            }
          }

          delete acc.bufferView;
          delete acc.byteOffset;
          if (nonZero.length === 0) continue;

          const useShort = acc.count <= 0xffff;
          const indices = useShort ? new Uint16Array(nonZero) : new Uint32Array(nonZero);
          const values = new Float32Array(nonZero.length * comps);
          nonZero.forEach((v, i) => {
            for (let c = 0; c < comps; c++) values[i * comps + c] = data[v * comps + c]!;
          });
          const indicesView = appendView(doc, new Uint8Array(indices.buffer));
          const valuesView = appendView(doc, new Uint8Array(values.buffer));
          acc.sparse = {
            count: nonZero.length,
            indices: { bufferView: indicesView, componentType: useShort ? 5123 : 5125 },
            values: { bufferView: valuesView },
          };
        }
      }
    }
  }
  return doc;
}

function appendView(doc: GlbDoc, bytes: Uint8Array): number {
  const offset = doc.bin.byteLength;
  const padded = (bytes.byteLength + 3) & ~3;
  const next = new Uint8Array(offset + padded);
  next.set(doc.bin, 0);
  next.set(bytes, offset);
  doc.bin = next;
  doc.json.buffers[0]!.byteLength = next.byteLength;
  doc.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
  return doc.json.bufferViews.length - 1;
}
