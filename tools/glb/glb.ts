import { normalizeJson, type GlbDoc, type GltfJson } from './types';

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Parses a binary glTF (GLB) container into its JSON and BIN chunks. */
export function readGlb(buf: Uint8Array): GlbDoc {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB');
  const length = view.getUint32(8, true);
  let offset = 12;
  let json: GltfJson | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= Math.min(length, buf.byteLength)) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const data = buf.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === CHUNK_JSON) json = normalizeJson(JSON.parse(new TextDecoder().decode(data)));
    else if (chunkType === CHUNK_BIN) bin = data.slice();
    offset += 8 + chunkLength;
  }
  if (!json) throw new Error('not a GLB: missing JSON chunk');
  return { json, bin };
}

/** Serialises a GlbDoc. JSON is padded with spaces, BIN with zeros, both to 4 bytes. */
export function writeGlb(doc: GlbDoc): Uint8Array {
  const json = {
    ...doc.json,
    buffers: [{ ...(doc.json.buffers?.[0] ?? {}), byteLength: doc.bin.byteLength }],
  };
  delete (json.buffers[0] as { uri?: string }).uri;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = pad(jsonBytes.byteLength);
  const binPadded = pad(doc.bin.byteLength);
  const total = 12 + 8 + jsonPadded + (doc.bin.byteLength ? 8 + binPadded : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPadded);
  if (doc.bin.byteLength) {
    const binStart = 20 + jsonPadded;
    view.setUint32(binStart, binPadded, true);
    view.setUint32(binStart + 4, CHUNK_BIN, true);
    out.set(doc.bin, binStart + 8);
  }
  return out;
}

function pad(n: number): number {
  return (n + 3) & ~3;
}
