// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration test of the built base (npm run assets:base); skipped until the build has run.
import fs from 'node:fs';
import path from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  ALL_BODY_TARGETS,
  BODY_MESH,
  EXPRESSION_TARGETS,
  MATERIALS,
  baseMetaSchema,
} from '../../src/avatar/baseContract';
import { avatarScale, bodyInfluences, groundOffset } from '../../src/avatar/body';
import { BODY_MORPHS, defaultParams, type AvatarParams } from '../../src/catalog/params';
import { HAIR_BUDGET_BYTES } from '../../tools/base/buildHair';
import { validateBase } from '../../tools/base/validateBase';
import { jointNames, validateHair } from '../../tools/base/validateHair';
import { readAccessor } from '../../tools/glb/accessors';
import { readGlb } from '../../tools/glb/glb';
import { findHumanBoneNode } from '../../tools/glb/humanoid';
import type { GlbDoc } from '../../tools/glb/types';

const BUILT = 'public/assets/base/base.vrm';
const META = 'public/assets/base/base.json';
const HAIR_DIR = 'public/assets/hair';
// MakeHuman's stock hairstyles (build_base.py HAIRSTYLES).
const HAIRSTYLES = [
  'afro01',
  'bob01',
  'bob02',
  'braid01',
  'long01',
  'ponytail01',
  'short01',
  'short02',
  'short03',
  'short04',
];
// The meshes that carry the expression morph targets: everything but the eyeballs.
const EXPRESSION_MESHES = [
  BODY_MESH,
  MATERIALS.brows,
  MATERIALS.lashes,
  MATERIALS.teeth,
  MATERIALS.tongue,
];

const mesh = (doc: GlbDoc, name: string) => {
  const found = doc.json.meshes.find((m: any) => m.name === name);
  if (!found) throw new Error(`mesh ${name} is missing`);
  return found;
};

/** The Body's extent along glTF y, from its POSITION accessors' bounds. */
function bodyMinMaxY(doc: GlbDoc): [number, number] {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of mesh(doc, BODY_MESH).primitives) {
    const position = doc.json.accessors[p.attributes.POSITION];
    minY = Math.min(minY, position.min[1]);
    maxY = Math.max(maxY, position.max[1]);
  }
  return [minY, maxY];
}

/**
 * The Body's lowest and highest y with its exported body targets applied at `body`'s influences, the
 * way the runtime morphs it (each target's POSITION delta times its influence, summed).
 */
function morphedMinMaxY(doc: GlbDoc, body: AvatarParams['body']): [number, number] {
  const found = mesh(doc, BODY_MESH);
  const names: string[] = found.extras?.targetNames ?? [];
  const influences = Object.entries(bodyInfluences(body)).filter(([, weight]) => weight !== 0);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of found.primitives) {
    const y = Float64Array.from(
      readAccessor(doc, p.attributes.POSITION).filter((_, i) => i % 3 === 1),
    );
    for (const [name, weight] of influences) {
      const target = names.indexOf(name);
      if (target < 0) throw new Error(`the Body has no target ${name}`);
      const delta = readAccessor(doc, p.targets[target].POSITION);
      for (let v = 0; v < y.length; v++) y[v]! += weight * delta[3 * v + 1]!;
    }
    for (const value of y) {
      minY = Math.min(minY, value);
      maxY = Math.max(maxY, value);
    }
  }
  return [minY, maxY];
}

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
    expect(validateBase(doc)).toEqual([]);
  });

  test('base.json is valid and measures the exported Body', () => {
    const meta = baseMetaSchema.parse(JSON.parse(fs.readFileSync(META, 'utf8')));
    const [minY, maxY] = bodyMinMaxY(doc);
    expect(meta.minY).toBeCloseTo(minY, 4);
    expect(meta.heightM).toBeCloseTo(maxY - minY, 4);
    expect(Object.keys(meta.morphHeightDelta).sort()).toEqual([...ALL_BODY_TARGETS].sort());
    expect(Object.keys(meta.morphMinYDelta).sort()).toEqual([...ALL_BODY_TARGETS].sort());
  });

  test('each expression preset binds its key at weight 1 on every mesh but the eyes', () => {
    const preset = doc.json.extensions.VRMC_vrm.expressions.preset;
    for (const [name, key] of Object.entries(EXPRESSION_TARGETS)) {
      const bound = (preset[name]?.morphTargetBinds ?? []).map((b: any) => {
        const m = doc.json.meshes[doc.json.nodes[b.node].mesh];
        return `${m.name}:${m.extras?.targetNames?.[b.index]}@${b.weight}`;
      });
      expect(bound.sort(), name).toEqual(EXPRESSION_MESHES.map((m) => `${m}:${key}@1`).sort());
    }
  });

  test("blinkLeft closes the character's left eye (+X) and leaves the right one", () => {
    const body = mesh(doc, BODY_MESH);
    const target = (body.extras?.targetNames ?? []).indexOf(EXPRESSION_TARGETS.blinkLeft);
    expect(target).toBeGreaterThanOrEqual(0);
    let moved = 0;
    let movedX = 0;
    let rightEye = 0;
    for (const p of body.primitives) {
      const xyz = readAccessor(doc, p.attributes.POSITION);
      const delta = readAccessor(doc, p.targets[target].POSITION);
      for (let i = 0; i < delta.length; i += 3) {
        const d = Math.hypot(delta[i]!, delta[i + 1]!, delta[i + 2]!);
        moved += d;
        movedX += d * xyz[i]!;
        if (xyz[i]! < -0.02) rightEye = Math.max(rightEye, d);
      }
    }
    // The left eye's centre is at x ≈ +2.8 cm. faceunits01's eyeBlinkLeft also drags the skin just
    // right of the nose bridge a little, but nothing around the right eye moves more than ~1 mm.
    expect(movedX / moved).toBeGreaterThan(0.01);
    expect(rightEye).toBeLessThan(0.002);
  });

  // Review Focus 1 and 2 on the real targets: base.json's deltas put the morphed feet on the floor
  // and make the morphed body exactly heightCm tall, at the extremes e2e drives as well.
  const signed = BODY_MORPHS.filter((m) => m !== 'gender');
  const extreme = (value: number, gender: number, heightCm: number) => ({
    ...defaultParams.body,
    ...Object.fromEntries(signed.map((m) => [m, value])),
    gender,
    heightCm,
  });
  test.each([
    ['default', defaultParams.body],
    ['every signed morph +1, gender 1, 175 cm', extreme(1, 1, 175)],
    ['every signed morph -1, gender 0, 175 cm', extreme(-1, 0, 175)],
    ['every signed morph +1, gender 1, 210 cm', extreme(1, 1, 210)],
    ['every signed morph -1, gender 0, 140 cm', extreme(-1, 0, 140)],
  ])('%s: feet within 1 mm of y = 0, height within 0.1%% of heightCm', (_, body) => {
    const meta = baseMetaSchema.parse(JSON.parse(fs.readFileSync(META, 'utf8')));
    const scale = avatarScale(body, meta);
    const offset = groundOffset(body, meta, scale);
    const [minY, maxY] = morphedMinMaxY(doc, body);
    expect(Math.abs(minY * scale + offset)).toBeLessThanOrEqual(0.001);
    const height = body.heightCm / 100;
    expect(Math.abs((maxY - minY) * scale - height)).toBeLessThanOrEqual(0.001 * height);
  });

  test('the body is between 1.5 and 1.85 m tall', () => {
    const [minY, maxY] = bodyMinMaxY(doc);
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

const hairFile = (id: string) => path.join(HAIR_DIR, `${id}.glb`);

/** Each vertex's skin weight on the joint named `bone` (0 where it has none), over the mesh's primitives. */
function boneWeights(doc: GlbDoc, bone: string): number[] {
  const node = doc.json.nodes.find((n: any) => n.mesh !== undefined && n.skin !== undefined);
  const joint = doc.json.skins[node.skin].joints.findIndex(
    (j: number) => doc.json.nodes[j].name === bone,
  );
  const weights: number[] = [];
  for (const p of doc.json.meshes[node.mesh].primitives) {
    const count = doc.json.accessors[p.attributes.POSITION].count;
    const ofVertex = new Array<number>(count).fill(0);
    for (let set = 0; p.attributes[`JOINTS_${set}`] !== undefined; set++) {
      const joints = readAccessor(doc, p.attributes[`JOINTS_${set}`]);
      const accessor = doc.json.accessors[p.attributes[`WEIGHTS_${set}`]];
      const values = readAccessor(doc, p.attributes[`WEIGHTS_${set}`]);
      // Normalised unsigned byte or short weights, or floats.
      const scale =
        accessor.componentType === 5121 ? 255 : accessor.componentType === 5123 ? 65535 : 1;
      for (let i = 0; i < joints.length; i++) {
        if (joints[i] === joint) ofVertex[Math.floor(i / 4)]! += values[i]! / scale;
      }
    }
    weights.push(...ofVertex);
  }
  return weights;
}

/** How far the morph target `name` moves each vertex of the doc's one mesh, over its primitives. */
function moved(doc: GlbDoc, name: string): number[] {
  const found = doc.json.meshes[0];
  const target = (found.extras?.targetNames ?? []).indexOf(name);
  if (target < 0) throw new Error(`${found.name} has no target ${name}`);
  const distances: number[] = [];
  for (const p of found.primitives) {
    const delta = readAccessor(doc, p.targets[target].POSITION);
    for (let i = 0; i < delta.length; i += 3) {
      distances.push(Math.hypot(delta[i]!, delta[i + 1]!, delta[i + 2]!));
    }
  }
  return distances;
}

// Built with the base by npm run assets:base. public/assets/hair may also hold untracked files of other
// origins, so the built base gates these tests, not that directory.
describe.skipIf(!fs.existsSync(BUILT))('built hairstyles (public/assets/hair)', () => {
  const bones = fs.existsSync(BUILT)
    ? jointNames(readGlb(new Uint8Array(fs.readFileSync(BUILT))))
    : [];
  const read = (id: string) => readGlb(new Uint8Array(fs.readFileSync(hairFile(id))));

  test('every stock hairstyle is built', () => {
    expect(HAIRSTYLES.filter((id) => !fs.existsSync(hairFile(id)))).toEqual([]);
  });

  test.each(HAIRSTYLES)('%s is within its budget and valid against the base bones', (id) => {
    expect(fs.statSync(hairFile(id)).size).toBeLessThanOrEqual(HAIR_BUDGET_BYTES);
    expect(validateHair(read(id), bones)).toEqual([]);
  });

  // Review Focus 2: body morphs never move the head, nor the hair that moves with the head alone.
  test.each(HAIRSTYLES)('%s: no body target moves a vertex weighted wholly to the head', (id) => {
    const doc = read(id);
    const head = boneWeights(doc, 'head').map((w) => w >= 0.999);
    expect(head.some(Boolean)).toBe(true);
    for (const name of ALL_BODY_TARGETS) {
      const most = Math.max(0, ...moved(doc, name).filter((_, v) => head[v]));
      expect(most, name).toBeLessThanOrEqual(1e-6);
    }
  });

  test('long01 follows the body: the shoulders or weight morph moves it by more than 1 mm', () => {
    const doc = read('long01');
    const most = Math.max(...moved(doc, 'body_shoulders_max'), ...moved(doc, 'body_weight_max'));
    expect(most).toBeGreaterThan(0.001);
  });
});
