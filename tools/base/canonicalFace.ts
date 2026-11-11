import fs from 'node:fs';

/** MediaPipe's canonical face model with iris (478 points, cm, +X the subject's left, +Y up, +Z forward). */
export const CANONICAL_FACE_OBJ = 'assets/source/mediapipe/face_model_with_iris.obj';

/**
 * Reads MediaPipe's canonical face OBJ: every vertex (landmark i is vertex i), each vertex's uv as written
 * (OBJ convention, v up; the faces pair each vertex with one texcoord, `f v/vt …`), and every face,
 * 0-based.
 */
export function readCanonicalFace(file: string): {
  positions: [number, number, number][];
  uvs: [number, number][];
  triangles: [number, number, number][];
} {
  const positions: [number, number, number][] = [];
  const texcoords: [number, number][] = [];
  const triangles: [number, number, number][] = [];
  const texcoordOf = new Map<number, number>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [kind, ...fields] = line.trim().split(/\s+/);
    if (kind === 'v') positions.push(fields.slice(0, 3).map(Number) as [number, number, number]);
    else if (kind === 'vt') texcoords.push(fields.slice(0, 2).map(Number) as [number, number]);
    else if (kind === 'f') {
      if (fields.length !== 3) throw new Error(`${file}: a face of ${fields.length} vertices`);
      const corners = fields.map((f) => f.split('/').map((n) => Number(n) - 1));
      for (const [v, vt] of corners) {
        if (vt === undefined || Number.isNaN(vt)) throw new Error(`${file}: a face without uvs`);
        if ((texcoordOf.get(v!) ?? vt) !== vt) throw new Error(`${file}: vertex ${v} has two uvs`);
        texcoordOf.set(v!, vt);
      }
      triangles.push(corners.map(([v]) => v!) as [number, number, number]);
    }
  }
  if (positions.length !== 478)
    throw new Error(`${file}: ${positions.length} vertices, expected 478`);
  const uvs = positions.map((_, v) => {
    const uv = texcoords[texcoordOf.get(v) ?? -1];
    if (!uv) throw new Error(`${file}: vertex ${v} has no uv`);
    return uv;
  });
  return { positions, uvs, triangles };
}
