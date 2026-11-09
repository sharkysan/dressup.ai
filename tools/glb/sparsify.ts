import { readAccessor } from './accessors';
import type { GlbDoc } from './types';

/**
 * Rewrites morph-target accessors whose non-zero vertices are below `threshold` (fraction) as glTF
 * sparse accessors: no base bufferView (implicit zeros) plus index/value patches. Dense accessors
 * left behind are removed by a later pruneUnused. An all-zero target gets neither bufferView nor sparse.
 */
export function sparsifyMorphTargets(input: GlbDoc, opts: { threshold?: number } = {}): GlbDoc {
  const threshold = opts.threshold ?? 0.5;
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
            for (let c = 0; c < comps; c++) if (data[v * comps + c] !== 0) moved = true;
            if (moved) nonZero.push(v);
          }
          if (nonZero.length > acc.count * threshold) continue;

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
