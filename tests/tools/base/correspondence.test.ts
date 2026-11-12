// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import { LM } from '../../../src/analysis/landmarks';
import { BODY_MESH } from '../../../src/avatar/baseContract';
import { correspondenceSchema, type Correspondence } from '../../../src/likeness/correspondence';
import { FACE_TEXTURE_SIZE as FACE_TEXTURE_TEXELS } from '../../../src/likeness/faceTexture';
import { applySimilarity } from '../../../src/likeness/similarity';
import { CANONICAL_FACE_OBJ, readCanonicalFace } from '../../../tools/base/canonicalFace';
import { buildCorrespondence, headWeights } from '../../../tools/base/correspondence';
import { readAccessor } from '../../../tools/glb/accessors';
import { readGlb } from '../../../tools/glb/glb';
import type { GlbDoc } from '../../../tools/glb/types';

const BUILT = 'public/assets/base/base.vrm';
const BUILT_CORRESPONDENCE = 'public/assets/base/correspondence.json';

test('readCanonicalFace reads the 478 points, their uvs as written, and every face', () => {
  const face = readCanonicalFace(CANONICAL_FACE_OBJ);
  expect(face.positions).toHaveLength(478);
  expect(face.uvs).toHaveLength(478);
  expect(face.triangles).toHaveLength(906);
  // The OBJ's first face is `f 174/43 156/119 134/220`: 1-based, and vertex 174 uses texcoord 43.
  expect(face.triangles[0]).toEqual([173, 155, 133]);
  expect(face.positions[173]).toEqual([-1.998311, 2.743838, 3.74403]);
  expect(face.uvs[173]).toEqual([0.408772, 0.626106]);
  // OBJ uvs are v up: the forehead is above the chin.
  expect(face.uvs[LM.faceTop]![1]).toBeGreaterThan(face.uvs[LM.chin]![1]);
});

type Vec3 = [number, number, number];

function bodyPrimitive(doc: GlbDoc) {
  const p = doc.json.meshes.find((m: any) => m.name === BODY_MESH).primitives[0];
  return {
    positions: readAccessor(doc, p.attributes.POSITION),
    uvs: readAccessor(doc, p.attributes.TEXCOORD_0),
    index: readAccessor(doc, p.indices),
  };
}

/**
 * The face island, found independently of the build: the Body vertices connected through triangles to
 * the nose tip (the frontmost vertex weighted wholly to the head within 1 mm of the midline).
 */
function faceIsland(doc: GlbDoc): Uint8Array {
  const { positions, index } = bodyPrimitive(doc);
  const weights = headWeights(doc, BODY_MESH);
  const count = positions.length / 3;
  let nose = -1;
  for (let v = 0; v < count; v++) {
    if (weights[v]! < 0.999 || Math.abs(positions[3 * v]!) >= 0.001) continue;
    if (nose < 0 || positions[3 * v + 2]! > positions[3 * nose + 2]!) nose = v;
  }
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]!]!;
    return v;
  };
  for (let t = 0; t < index.length; t += 3) {
    parent[find(index[t + 1]!)] = find(index[t]!);
    parent[find(index[t + 2]!)] = find(index[t]!);
  }
  const root = find(nose);
  return Uint8Array.from({ length: count }, (_, v) => (find(v) === root ? 1 : 0));
}

/** Even-odd rule. */
function insidePolygon([x, y]: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function area([a, b, c]: [Vec3, Vec3, Vec3]): number {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return (
    Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
  );
}

/**
 * MediaPipe's lips, written out here rather than taken from the build: the outer and inner lip contours
 * and the two rings between them. The mouth corners are on both lips.
 */
const LIPS = {
  upper: [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 76, 184, 74, 73, 72, 11, 302, 303, 304, 408,
    306, 62, 183, 42, 41, 38, 12, 268, 271, 272, 407, 292, 78, 191, 80, 81, 82, 13, 312, 311, 310,
    415, 308,
  ],
  lower: [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 76, 77, 90, 180, 85, 16, 315, 404, 320, 307,
    306, 62, 96, 89, 179, 86, 15, 316, 403, 319, 325, 292, 78, 95, 88, 178, 87, 14, 317, 402, 318,
    324, 308,
  ],
};

/**
 * The base of the nose, found from the canonical face rather than taken from the build: the landmarks
 * within the alar width (|x| ≤ 1.8 cm) from the subnasale (2) up to the nose tip (4), nostrils included.
 */
function noseBase(): number[] {
  const { positions } = readCanonicalFace(CANONICAL_FACE_OBJ);
  const [bottom, top] = [positions[2]![1], positions[4]![1]];
  return positions
    .slice(0, 468)
    .flatMap(([x, y], i) => (Math.abs(x) <= 1.8 && y >= bottom && y <= top ? [i] : []));
}

describe.skipIf(!fs.existsSync(BUILT))('correspondence of the built base', () => {
  let doc: GlbDoc;
  let data: Correspondence;
  let review: ReturnType<typeof buildCorrespondence>['review'];
  beforeAll(() => {
    doc = readGlb(new Uint8Array(fs.readFileSync(BUILT)));
    ({ data, review } = buildCorrespondence(doc, readCanonicalFace(CANONICAL_FACE_OBJ)));
  });
  const position = (i: number) => data.landmarks[i]!.position;

  test("bodyVertexCount is the Body's vertex count", () => {
    expect(data.bodyVertexCount).toBe(bodyPrimitive(doc).positions.length / 3);
  });

  test('468 landmarks, each on a Body triangle of the face island, barycentrics summing to 1', () => {
    const { index } = bodyPrimitive(doc);
    const triangles = new Set<string>();
    for (let t = 0; t < index.length; t += 3)
      triangles.add(`${index[t]},${index[t + 1]},${index[t + 2]}`);
    const island = faceIsland(doc);
    expect(data.landmarks).toHaveLength(468);
    for (const [i, { triangle, bary }] of data.landmarks.entries()) {
      expect(triangles.has(triangle.join(',')), `landmark ${i}`).toBe(true);
      expect(
        triangle.every((v) => island[v] === 1),
        `landmark ${i}`,
      ).toBe(true);
      expect(Math.abs(bary[0] + bary[1] + bary[2] - 1), `landmark ${i}`).toBeLessThanOrEqual(1e-6);
      expect(Math.min(...bary), `landmark ${i}`).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  test('the landmarks are in order: y up, +x the subject’s left', () => {
    const y = (i: number) => position(i)[1];
    const x = (i: number) => position(i)[0];
    expect(y(10)).toBeGreaterThan(y(168));
    expect(y(168)).toBeGreaterThan(y(4));
    expect(y(4)).toBeGreaterThan(y(0));
    expect(y(0)).toBeGreaterThan(y(17));
    expect(y(17)).toBeGreaterThan(y(152));
    expect(x(33)).toBeLessThan(x(133));
    expect(x(133)).toBeLessThan(0);
    expect(x(362)).toBeGreaterThan(0);
    expect(x(263)).toBeGreaterThan(x(362));
    expect(Math.abs(x(4))).toBeLessThan(0.002);
  });

  test('the lips are registered, not collapsed: y(0) > y(13) ≥ y(14) > y(17), each lip ≥ 2 mm', () => {
    const y = (i: number) => position(i)[1];
    // The base's lips are closed, so the inner contours (13 above 14) meet at its mouth slit.
    expect(y(0)).toBeGreaterThan(y(13));
    expect(y(13)).toBeGreaterThanOrEqual(y(14));
    expect(y(14)).toBeGreaterThan(y(17));
    expect(y(0) - y(13)).toBeGreaterThanOrEqual(0.002);
    expect(y(14) - y(17)).toBeGreaterThanOrEqual(0.002);
    // Down the midline, outer to inner contour and inner to outer, the lips keep their order.
    const midline = [0, 11, 12, 13, 14, 15, 16, 17].map(y);
    for (let k = 1; k < midline.length; k++) expect(midline[k]).toBeLessThan(midline[k - 1]!);
  });

  test('no face-mesh triangle over the lips or the base of the nose is folded or flat in uv', () => {
    const uv = (i: number) => data.landmarks[i]!.uv;
    const signed = ([a, b, c]: [number, number, number]) => {
      const [p, q, r] = [uv(a), uv(b), uv(c)];
      return (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
    };
    const signs = data.triangles.map((t) => Math.sign(signed(t)));
    const majority = signs.filter((s) => s > 0).length > signs.length / 2 ? 1 : -1;
    const watched = new Set([...LIPS.upper, ...LIPS.lower, ...noseBase()]);
    const over = data.triangles.filter((t) => t.some((i) => watched.has(i)));
    const bad = over.filter((t) => Math.sign(signed(t)) !== majority);
    expect(over.length).toBeGreaterThan(250);
    expect(bad, `${bad.length} of ${over.length}`).toEqual([]);
  });

  test("the lips get their share of the face texture's texels", () => {
    // Texels (of the 1024² face texture) per cm² of the surface the triangles cover: on the base (the
    // landmarks' positions), and on the aligned canonical face (the photo's face, so that a lip squeezed
    // into a crease shows). The upper lip had 0.46× and 0.10× before the view projection.
    const k = FACE_TEXTURE_TEXELS / data.faceUvRect.size;
    const aligned = (i: number) =>
      applySimilarity(data.canonicalToBase, data.canonical.slice(3 * i, 3 * i + 3) as Vec3);
    const uvArea = (t: [number, number, number]) => {
      const [a, b, c] = t.map((i) => data.landmarks[i]!.uv) as [number, number][];
      return Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1])) / 2;
    };
    const density = (keep: (t: [number, number, number]) => boolean) => {
      let [texels, base, canonical] = [0, 0, 0];
      for (const t of data.triangles.filter(keep)) {
        texels += k * k * uvArea(t);
        base += 1e4 * area(t.map(position) as [Vec3, Vec3, Vec3]);
        canonical += 1e4 * area(t.map(aligned) as [Vec3, Vec3, Vec3]);
      }
      return { base: texels / base, canonical: texels / canonical };
    };
    const face = density(() => true);
    for (const lip of [LIPS.upper, LIPS.lower]) {
      const on = new Set(lip);
      const d = density((t) => t.every((i) => on.has(i)));
      expect(d.base / face.base).toBeGreaterThanOrEqual(0.6);
      expect(d.canonical / face.canonical).toBeGreaterThanOrEqual(0.6);
    }
  });

  test('the aligned canonical face lies on the head: mean distance < 8 mm, max < 20 mm', () => {
    const distances = data.landmarks.map((l, i) => {
      const c = data.canonical.slice(3 * i, 3 * i + 3) as Vec3;
      return distance(applySimilarity(data.canonicalToBase, c), l.position);
    });
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    expect(mean).toBeLessThan(0.008);
    expect(Math.max(...distances)).toBeLessThan(0.02);
  });

  test('triangles cover the face mesh over landmarks 0..467', () => {
    expect(data.triangles.length).toBeGreaterThanOrEqual(850);
    expect(data.triangles.flat().every((i) => i < 468)).toBe(true);
  });

  test('faceUvRect contains every landmark uv', () => {
    const { u, v, size } = data.faceUvRect;
    for (const { uv } of data.landmarks) {
      expect(uv[0]).toBeGreaterThanOrEqual(u);
      expect(uv[0]).toBeLessThanOrEqual(u + size);
      expect(uv[1]).toBeGreaterThanOrEqual(v);
      expect(uv[1]).toBeLessThanOrEqual(v + size);
    }
  });

  test('compositing isolation: no Body vertex off the face island has a uv inside the face oval', () => {
    const { uvs } = bodyPrimitive(doc);
    const island = faceIsland(doc);
    const oval = LM.faceOval.map((i) => data.landmarks[i]!.uv);
    const offenders: { vertex: number; uv: [number, number] }[] = [];
    let onFace = 0;
    for (let v = 0; v < island.length; v++) {
      const uv: [number, number] = [uvs[2 * v]!, uvs[2 * v + 1]!];
      if (!insidePolygon(uv, oval)) continue;
      if (island[v]) onFace++;
      else offenders.push({ vertex: v, uv });
    }
    expect(onFace).toBeGreaterThan(500); // the oval does hold the face
    expect(offenders, `${offenders.length} vertices`).toEqual([]);
  });

  test('head: the vertices with a head weight, in index order, with their weights and positions', () => {
    const { positions } = bodyPrimitive(doc);
    const weights = headWeights(doc, BODY_MESH);
    const { head } = data;
    expect(head.vertices).toEqual([...weights.keys()].filter((v) => weights[v]! > 0));
    expect(head.weights).toHaveLength(head.vertices.length);
    expect(head.positions).toHaveLength(3 * head.vertices.length);
    for (const [i, v] of head.vertices.entries()) {
      expect(head.weights[i]).toBeGreaterThan(0);
      expect(head.weights[i]).toBeLessThanOrEqual(1);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(head.positions[3 * i + c]! - positions[3 * v + c]!)).toBeLessThan(1e-5);
      }
    }
  });

  test('zero: head vertices behind the ears', () => {
    const zEar = (position(LM.cheekR)[2] + position(LM.cheekL)[2]) / 2;
    expect(data.zero.length).toBeGreaterThan(0);
    for (const i of data.zero) {
      expect(i).toBeLessThan(data.head.vertices.length);
      expect(data.head.positions[3 * i + 2]).toBeLessThan(zEar - 0.01);
    }
  });

  test('the JSON round-trips through the schema and is at most 400 KB', () => {
    const json = JSON.stringify(data);
    expect(correspondenceSchema.parse(JSON.parse(json))).toEqual(data);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(400 * 1024);
  });

  test('the review render is 512² RGBA with the head, landmarks and anchors drawn', () => {
    expect([review.width, review.height, review.data.length]).toEqual([512, 512, 512 * 512 * 4]);
    const count = (r: number, g: number, b: number) => {
      let n = 0;
      for (let i = 0; i < review.data.length; i += 4) {
        if (review.data[i] === r && review.data[i + 1] === g && review.data[i + 2] === b) n++;
      }
      return n;
    };
    expect(count(128, 128, 128)).toBeGreaterThan(1000);
    expect(count(255, 0, 0)).toBeGreaterThan(468); // 3 px dots, some overlapping
    expect(count(0, 0, 255)).toBe(3 * 5 * 5); // three 5 px dots, apart
  });

  test('the built correspondence.json is the one the built base gives', () => {
    const built = correspondenceSchema.parse(
      JSON.parse(fs.readFileSync(BUILT_CORRESPONDENCE, 'utf8')),
    );
    expect(built).toEqual(data);
  });
});
