import type { Correspondence } from '../../src/likeness/correspondence';
import { headBinding } from '../../src/likeness/headBinding';

const SIN60 = Math.sqrt(3) / 2;

/**
 * Four head points: an equilateral triangle of side 1 m in z = 0 (Body vertices 10, 20, 30), and Body
 * vertex 40 over 5 m behind it.
 */
const HEAD: Correspondence['head'] = {
  vertices: [10, 20, 30, 40],
  weights: [1, 1, 1, 1],
  positions: [0, 0, 0, 1, 0, 0, 0.5, SIN60, 0, 0.5, 0.3, -5],
};

/** Vertex v's binding: _HEADBIND_IDX is VEC4 (its 4th component unused), _HEADBIND_W VEC3. */
const binding = (idx: Uint16Array, w: Float32Array, v: number) => ({
  idx: [...idx.subarray(4 * v, 4 * v + 3)],
  w: [...w.subarray(3 * v, 3 * v + 3)],
});

test('a vertex at a head point binds to that Body vertex with weight ≈ 1', () => {
  const { idx, w } = headBinding(Float32Array.of(1, 0, 0), HEAD);
  expect(idx[0]).toBe(20);
  expect(w[0]).toBeCloseTo(1, 3);
});

test('a vertex equidistant from three head points weighs each ≈ 1/3', () => {
  // The triangle's centre, 1/√3 m from each corner; vertex 40 is over 5 m away.
  const { idx, w } = headBinding(Float32Array.of(0.5, SIN60 / 3, 0), HEAD);
  expect([...idx.subarray(0, 3)].sort()).toEqual([10, 20, 30]);
  for (const weight of w) expect(weight).toBeCloseTo(1 / 3, 6);
});

test('every weight triple sums to 1', () => {
  const positions = Float32Array.from({ length: 3 * 50 }, (_, i) => Math.sin(i * 12.9898) * 2);
  const { w } = headBinding(positions, HEAD);
  expect(w).toHaveLength(150);
  for (let v = 0; v < 50; v++) {
    const sum = w[3 * v]! + w[3 * v + 1]! + w[3 * v + 2]!;
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
  }
});

test('the indices are four per vertex, the 4th 0 (glTF 4-byte alignment); the weights three', () => {
  const positions = Float32Array.from({ length: 3 * 50 }, (_, i) => Math.cos(i * 7.233) * 2);
  const { idx, w } = headBinding(positions, HEAD);
  expect(idx).toHaveLength(4 * 50);
  expect(w).toHaveLength(3 * 50);
  for (let v = 0; v < 50; v++) {
    expect(idx[4 * v + 3]).toBe(0);
    expect([10, 20, 30, 40]).toEqual(expect.arrayContaining([...idx.subarray(4 * v, 4 * v + 3)]));
  }
});

test('the nearest head vertex comes first, the weights falling with distance', () => {
  const { idx, w } = headBinding(Float32Array.of(0.1, 0.05, 0), HEAD);
  expect([...idx]).toEqual([10, 20, 30, 0]);
  expect(w[0]).toBeGreaterThan(w[1]!);
  expect(w[1]).toBeGreaterThan(w[2]!);
});

test('every vertex of a part takes the binding of the part centroid; −1 binds per vertex', () => {
  // Part 0: two vertices around (0.5, 0, 0.1); part 1: one vertex; then one vertex on its own.
  const positions = Float32Array.of(0, 0, 0.1, 1, 0, 0.1, 0.5, 0.8, 0, 0.9, 0.1, 0);
  const parts = Int32Array.of(0, 0, 1, -1);
  const { idx, w } = headBinding(positions, HEAD, parts);
  const centroid = headBinding(Float32Array.of(0.5, 0, 0.1), HEAD);
  const own = (v: number) => headBinding(positions.slice(3 * v, 3 * v + 3), HEAD);
  expect(binding(idx, w, 0)).toEqual(binding(centroid.idx, centroid.w, 0));
  expect(binding(idx, w, 1)).toEqual(binding(centroid.idx, centroid.w, 0));
  // Rigid: the part's first vertex alone would bind differently.
  expect(binding(idx, w, 0)).not.toEqual(binding(own(0).idx, own(0).w, 0));
  expect(binding(idx, w, 2)).toEqual(binding(own(2).idx, own(2).w, 0));
  expect(binding(idx, w, 3)).toEqual(binding(own(3).idx, own(3).w, 0));
});

test('parts must have one entry per vertex', () => {
  expect(() => headBinding(Float32Array.of(0, 0, 0, 1, 0, 0), HEAD, Int32Array.of(0))).toThrow(
    /parts/,
  );
});

test('a head of fewer than three vertices, or one past UNSIGNED_SHORT, is rejected', () => {
  const two = { vertices: [0, 1], weights: [1, 1], positions: [0, 0, 0, 1, 0, 0] };
  expect(() => headBinding(Float32Array.of(0, 0, 0), two)).toThrow(/three/);
  expect(() =>
    headBinding(Float32Array.of(0, 0, 0), { ...HEAD, vertices: [10, 20, 30, 70000] }),
  ).toThrow(/65535/);
});
