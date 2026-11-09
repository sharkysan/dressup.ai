// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration test of the built base (npm run assets:base); skipped until the build has run.
import fs from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { BODY_MESH } from '../../src/avatar/baseContract';
import { validateBase } from '../../tools/base/validateBase';
import { readAccessor } from '../../tools/glb/accessors';
import { readGlb } from '../../tools/glb/glb';
import { findHumanBoneNode } from '../../tools/glb/humanoid';
import type { GlbDoc } from '../../tools/glb/types';

const BUILT = 'public/assets/base/base.vrm';

const mesh = (doc: GlbDoc, name: string) => {
  const found = doc.json.meshes.find((m: any) => m.name === name);
  if (!found) throw new Error(`mesh ${name} is missing`);
  return found;
};

function localMatrix(node: any): Matrix4 {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
}

function worldPosition(doc: GlbDoc, index: number): Vector3 {
  const parent = new Map<number, number>();
  doc.json.nodes.forEach((n: any, i: number) => {
    for (const c of n.children ?? []) parent.set(c, i);
  });
  const world = new Matrix4();
  for (let i: number | undefined = index; i !== undefined; i = parent.get(i)) {
    world.premultiply(localMatrix(doc.json.nodes[i]));
  }
  return new Vector3().setFromMatrixPosition(world);
}

describe.skipIf(!fs.existsSync(BUILT))('built base (public/assets/base/base.vrm)', () => {
  const doc = fs.existsSync(BUILT) ? readGlb(new Uint8Array(fs.readFileSync(BUILT))) : null!;

  test('matches the naming contract', () => {
    // Tasks 4 and 5 turn the expressions and bodyTargets checks on.
    expect(validateBase(doc, { expressions: false, bodyTargets: false })).toEqual([]);
  });

  test('the body is between 1.5 and 1.85 m tall', () => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of mesh(doc, BODY_MESH).primitives) {
      const position = doc.json.accessors[p.attributes.POSITION];
      minY = Math.min(minY, position.min[1]);
      maxY = Math.max(maxY, position.max[1]);
    }
    expect(maxY - minY).toBeGreaterThan(1.5);
    expect(maxY - minY).toBeLessThan(1.85);
  });

  test('faces +Z: the eyes are in front of the head bone', () => {
    let sum = 0;
    let count = 0;
    for (const p of mesh(doc, 'Eyes').primitives) {
      const xyz = readAccessor(doc, p.attributes.POSITION);
      for (let i = 2; i < xyz.length; i += 3) sum += xyz[i]!;
      count += xyz.length / 3;
    }
    const head = findHumanBoneNode(doc.json, 'head');
    expect(head).toBeGreaterThanOrEqual(0);
    expect(sum / count).toBeGreaterThan(worldPosition(doc, head).z);
  });
});
