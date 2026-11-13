/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ALL_BODY_TARGETS,
  BODY_MESH,
  EXPRESSION_TARGETS,
  MASKED_MATERIALS,
  MATERIALS,
  REQUIRED_HUMAN_BONES,
} from '../../src/avatar/baseContract';
import { HEADBIND_IDX, HEADBIND_W } from '../../src/likeness/headBinding';
import { readAccessor } from '../glb/accessors';
import type { GlbDoc } from '../glb/types';

export type BaseCheck =
  'vrm' | 'humanoid' | 'materials' | 'expressions' | 'bodyTargets' | 'headBinding' | 'bodyIndexed';

/** The base's meshes that move with the head and carry a head binding (spec §8), named as their materials. */
export const HEAD_MESHES = [
  MATERIALS.brows,
  MATERIALS.eyes,
  MATERIALS.lashes,
  MATERIALS.teeth,
  MATERIALS.tongue,
];

const COMPONENT_TYPES: Record<number, string> = {
  5120: 'BYTE',
  5121: 'UNSIGNED_BYTE',
  5122: 'SHORT',
  5123: 'UNSIGNED_SHORT',
  5125: 'UNSIGNED_INT',
  5126: 'FLOAT',
};
const UNSIGNED_SHORT = 5123;
const FLOAT = 5126;

/**
 * The problems with the head binding (spec §8) of each primitive of `mesh`: both attributes present,
 * _HEADBIND_IDX UNSIGNED_SHORT VEC4 (glTF's 4-byte alignment) with a 4th component of 0 and _HEADBIND_W
 * FLOAT VEC3, one entry per vertex, every index a vertex of the Body's `bodyVertexCount`.
 */
export function headBindingProblems(doc: GlbDoc, mesh: any, bodyVertexCount: number): string[] {
  const problems: string[] = [];
  mesh.primitives.forEach((p: any, i: number) => {
    const where = `mesh ${mesh.name} primitive ${i}`;
    const idx = p.attributes[HEADBIND_IDX];
    const w = p.attributes[HEADBIND_W];
    if (idx === undefined || w === undefined) {
      problems.push(`${where} lacks a head binding (${HEADBIND_IDX} and ${HEADBIND_W})`);
      return;
    }
    const vertices = doc.json.accessors[p.attributes.POSITION]?.count;
    let idxFormatOk = true;
    for (const [name, index, componentType, type] of [
      [HEADBIND_IDX, idx, UNSIGNED_SHORT, 'VEC4'],
      [HEADBIND_W, w, FLOAT, 'VEC3'],
    ] as const) {
      const accessor = doc.json.accessors[index];
      if (accessor?.count !== vertices)
        problems.push(`${where}: ${name} has ${accessor?.count} entries for ${vertices} vertices`);
      if (accessor?.componentType !== componentType || accessor?.type !== type) {
        const found = COMPONENT_TYPES[accessor?.componentType] ?? accessor?.componentType;
        problems.push(
          `${where}: ${name} is ${found} ${accessor?.type}, expected ${COMPONENT_TYPES[componentType]} ${type}`,
        );
        if (name === HEADBIND_IDX) idxFormatOk = false;
      }
    }
    if (!idxFormatOk) return; // the indices can't be read as VEC4s
    const indices = readAccessor(doc, idx);
    let most = 0;
    let padded = true;
    for (let v = 0; v < indices.length; v += 4) {
      most = Math.max(most, indices[v]!, indices[v + 1]!, indices[v + 2]!);
      padded &&= indices[v + 3] === 0;
    }
    if (most >= bodyVertexCount) {
      problems.push(
        `${where}: ${HEADBIND_IDX} indexes vertex ${most}, past the Body's ${bodyVertexCount}`,
      );
    }
    if (!padded) problems.push(`${where}: ${HEADBIND_IDX} has a 4th component other than 0`);
  });
  return problems;
}

/** Validates an exported base VRM against the naming contract. Returns one line per problem; empty = valid. */
export function validateBase(
  doc: GlbDoc,
  checks: Partial<Record<BaseCheck, boolean>> = {},
): string[] {
  const on = (c: BaseCheck) => checks[c] !== false;
  const json = doc.json;
  const problems: string[] = [];
  const vrm = json.extensions?.VRMC_vrm;

  if (on('vrm')) {
    if (json.extensions?.VRM) problems.push('file is VRM 0.x (extensions.VRM); VRM 1.0 required');
    else if (!vrm) problems.push('VRMC_vrm extension missing; VRM 1.0 required');
    else if (vrm.specVersion !== '1.0')
      problems.push(`VRMC_vrm specVersion is ${vrm.specVersion}, expected 1.0`);
  }

  if (on('humanoid')) {
    const bones = vrm?.humanoid?.humanBones ?? {};
    for (const b of REQUIRED_HUMAN_BONES) {
      if (bones[b]?.node === undefined) problems.push(`humanoid bone ${b} is not mapped`);
    }
  }

  if (on('materials')) {
    const materials: any[] = json.materials ?? [];
    for (const name of Object.values(MATERIALS)) {
      const m = materials.find((x) => x.name === name);
      if (!m) {
        problems.push(`material ${name} is missing`);
        continue;
      }
      if (m.extensions?.VRMC_materials_mtoon)
        problems.push(`material ${name} uses MToon; plain PBR required`);
      if (MASKED_MATERIALS.includes(name) && m.alphaMode !== 'MASK') {
        problems.push(`material ${name} alphaMode is ${m.alphaMode ?? 'OPAQUE'}, expected MASK`);
      }
    }
  }

  const body = (json.meshes ?? []).find((m: any) => m.name === BODY_MESH);
  const targetNames: string[] = body?.extras?.targetNames ?? [];

  if (on('expressions')) {
    const preset = vrm?.expressions?.preset ?? {};
    for (const [name, target] of Object.entries(EXPRESSION_TARGETS)) {
      if (!preset[name]?.morphTargetBinds?.length)
        problems.push(`expression ${name} has no morphTargetBinds`);
      if (body && !targetNames.includes(target))
        problems.push(`expression target ${target} is missing on ${BODY_MESH}`);
    }
  }

  if (on('bodyTargets')) {
    if (!body) problems.push(`mesh ${BODY_MESH} is missing`);
    else {
      for (const t of ALL_BODY_TARGETS) {
        if (!targetNames.includes(t))
          problems.push(`body morph target ${t} is missing on ${BODY_MESH}`);
      }
    }
  }

  if (on('bodyIndexed') && body) {
    // At load, three-vrm's removeUnnecessaryVertices drops the vertices no index references and renumbers
    // the rest. The correspondence and the head bindings index the Body's vertices as exported, so a
    // renumbered Body would no longer fit them, and every photo face would fall back to the default face.
    body.primitives.forEach((p: any, i: number) => {
      const where = `mesh ${BODY_MESH} primitive ${i}`;
      if (p.indices === undefined) {
        problems.push(`${where} has no indices; the correspondence needs its triangles`);
        return;
      }
      const used = new Uint8Array(json.accessors[p.attributes.POSITION]?.count ?? 0);
      for (const v of readAccessor(doc, p.indices)) used[v] = 1;
      const unused = used.reduce((n, u) => n + (u ? 0 : 1), 0);
      if (unused > 0) {
        problems.push(
          `${where}: ${unused} vertices (the first ${used.indexOf(0)}) are in no triangle; ` +
            `three-vrm would renumber the Body at load`,
        );
      }
    });
  }

  if (on('headBinding')) {
    // A binding indexes the vertices of the Body's one primitive.
    if (body?.primitives.length !== 1) {
      problems.push(`mesh ${BODY_MESH} needs exactly one primitive for the head bindings to index`);
    } else {
      const bodyVertexCount = json.accessors[body.primitives[0].attributes.POSITION]?.count ?? 0;
      for (const name of HEAD_MESHES) {
        const mesh = json.meshes.find((m: any) => m.name === name);
        if (!mesh) problems.push(`mesh ${name} is missing`);
        else problems.push(...headBindingProblems(doc, mesh, bodyVertexCount));
      }
    }
  }

  return problems;
}
