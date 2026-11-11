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
  'vrm' | 'humanoid' | 'materials' | 'expressions' | 'bodyTargets' | 'headBinding';

/** The base's meshes that move with the head and carry a head binding (spec §8), named as their materials. */
export const HEAD_MESHES = [
  MATERIALS.brows,
  MATERIALS.eyes,
  MATERIALS.lashes,
  MATERIALS.teeth,
  MATERIALS.tongue,
];

/**
 * The problems with the head binding (spec §8) of each primitive of `mesh`: both attributes present, one
 * entry per vertex, every index a vertex of the Body's `bodyVertexCount`.
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
    for (const [name, accessor] of [
      [HEADBIND_IDX, idx],
      [HEADBIND_W, w],
    ]) {
      const count = doc.json.accessors[accessor]?.count;
      if (count !== vertices)
        problems.push(`${where}: ${name} has ${count} entries for ${vertices} vertices`);
    }
    let most = 0;
    for (const v of readAccessor(doc, idx)) most = Math.max(most, v);
    if (most >= bodyVertexCount) {
      problems.push(
        `${where}: ${HEADBIND_IDX} indexes vertex ${most}, past the Body's ${bodyVertexCount}`,
      );
    }
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
