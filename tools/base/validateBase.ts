/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ALL_BODY_TARGETS,
  BODY_MESH,
  EXPRESSION_TARGETS,
  MASKED_MATERIALS,
  MATERIALS,
  REQUIRED_HUMAN_BONES,
} from '../../src/avatar/baseContract';
import type { GlbDoc } from '../glb/types';

export type BaseCheck = 'vrm' | 'humanoid' | 'materials' | 'expressions' | 'bodyTargets';

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

  return problems;
}
