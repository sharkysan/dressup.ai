import type { GlbDoc } from './types';

export type TypedArray = Float32Array | Uint32Array | Uint16Array | Uint8Array;
export type AccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';

const COMPONENTS: Record<AccessorType, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

const COMPONENT_TYPE = {
  Float32Array: 5126,
  Uint32Array: 5125,
  Uint16Array: 5123,
  Uint8Array: 5121,
} as const;

function arrayFor(componentType: number, length: number): TypedArray {
  switch (componentType) {
    case 5126:
      return new Float32Array(length);
    case 5125:
      return new Uint32Array(length);
    case 5123:
      return new Uint16Array(length);
    case 5121:
      return new Uint8Array(length);
    default:
      throw new Error(`unsupported componentType ${componentType}`);
  }
}

function viewFor(componentType: number, buffer: ArrayBuffer): TypedArray {
  switch (componentType) {
    case 5126:
      return new Float32Array(buffer);
    case 5125:
      return new Uint32Array(buffer);
    case 5123:
      return new Uint16Array(buffer);
    case 5121:
      return new Uint8Array(buffer);
    default:
      throw new Error(`unsupported componentType ${componentType}`);
  }
}

/** Reads an accessor into a tight typed array (handles byteStride; no sparse support). */
export function readAccessor(doc: GlbDoc, index: number): TypedArray {
  const acc = doc.json.accessors[index];
  if (!acc) throw new Error(`accessor ${index} missing`);
  if (acc.sparse) throw new Error('sparse accessors are not supported');
  const comps = COMPONENTS[acc.type as AccessorType];
  const out = arrayFor(acc.componentType, acc.count * comps);
  if (acc.bufferView === undefined) return out; // all zeros per spec
  const bv = doc.json.bufferViews[acc.bufferView]!;
  const elementBytes = out.BYTES_PER_ELEMENT * comps;
  const stride = bv.byteStride ?? elementBytes;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (stride === elementBytes) {
    // Copy into a fresh buffer so the typed-array view is aligned regardless of the source offset.
    const copy = new Uint8Array(acc.count * elementBytes);
    copy.set(doc.bin.subarray(base, base + copy.byteLength));
    return viewFor(acc.componentType, copy.buffer);
  }
  const view = new DataView(doc.bin.buffer, doc.bin.byteOffset, doc.bin.byteLength);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const o = at + c * out.BYTES_PER_ELEMENT;
      out[i * comps + c] =
        acc.componentType === 5126
          ? view.getFloat32(o, true)
          : acc.componentType === 5125
            ? view.getUint32(o, true)
            : acc.componentType === 5123
              ? view.getUint16(o, true)
              : view.getUint8(o);
    }
  }
  return out;
}

/** Appends `data` as a new 4-byte-aligned bufferView + accessor; returns the accessor index. */
export function appendAccessor(
  doc: GlbDoc,
  data: TypedArray,
  type: AccessorType,
  opts: { minMax?: boolean; target?: 34962 | 34963 } = {},
): number {
  const comps = COMPONENTS[type];
  if (data.length % comps !== 0)
    throw new Error(`data length ${data.length} is not a multiple of ${comps}`);
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const offset = doc.bin.byteLength;
  const padded = (bytes.byteLength + 3) & ~3;
  const next = new Uint8Array(offset + padded);
  next.set(doc.bin, 0);
  next.set(bytes, offset);
  doc.bin = next;
  doc.json.buffers[0]!.byteLength = next.byteLength;
  doc.json.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.byteLength,
    ...(opts.target ? { target: opts.target } : {}),
  });
  const accessor: Record<string, unknown> = {
    bufferView: doc.json.bufferViews.length - 1,
    byteOffset: 0,
    componentType: COMPONENT_TYPE[data.constructor.name as keyof typeof COMPONENT_TYPE],
    count: data.length / comps,
    type,
  };
  if (opts.minMax) {
    const min = new Array<number>(comps).fill(Infinity);
    const max = new Array<number>(comps).fill(-Infinity);
    for (let i = 0; i < data.length; i++) {
      const c = i % comps;
      const v = data[i] as number;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
    }
    accessor.min = min;
    accessor.max = max;
  }
  doc.json.accessors.push(accessor);
  return doc.json.accessors.length - 1;
}
