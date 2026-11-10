import { BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { BaseMeta } from '../../src/avatar/baseContract';
import { applyBodyMorphs, avatarScale, bodyInfluences, groundOffset } from '../../src/avatar/body';
import { BODY_MORPHS, defaultParams, type AvatarParams } from '../../src/catalog/params';

const meta: BaseMeta = {
  version: 1,
  heightM: 1.65,
  minY: 0,
  morphHeightDelta: { body_legLength_max: 0.18, body_legLength_min: -0.13 },
  morphMinYDelta: { body_legLength_max: -0.1 },
};
const zero = defaultParams.body;
const body = (patch: Partial<AvatarParams['body']>): AvatarParams['body'] => ({
  ...zero,
  ...patch,
});

describe('bodyInfluences', () => {
  it('maps a positive signed morph to _max', () => {
    const i = bodyInfluences(body({ weight: 0.6 }));
    expect(i.body_weight_max).toBe(0.6);
    expect(i.body_weight_min).toBe(0);
  });
  it('maps a negative signed morph to _min', () => {
    expect(bodyInfluences(body({ weight: -0.3 })).body_weight_min).toBe(0.3);
  });
  it('clamps out-of-range values', () => {
    expect(bodyInfluences(body({ weight: 1.5 })).body_weight_max).toBe(1);
    expect(bodyInfluences(body({ gender: 2 })).body_gender_max).toBe(1);
  });
});

describe('avatarScale and groundOffset', () => {
  it('is 1 at the base height', () => {
    expect(avatarScale(body({ heightCm: 165 }), meta)).toBe(1);
  });
  it('divides by the morphed height', () => {
    expect(avatarScale(body({ legLength: 1, heightCm: 165 }), meta)).toBeCloseTo(1.65 / 1.83, 9);
  });
  it('grounds the morphed feet', () => {
    const b = body({ legLength: 1 });
    expect(groundOffset(b, meta, 1)).toBeCloseTo(0.1, 9);
  });
  it('stays finite and positive over all extreme combinations (Review Focus 1)', () => {
    const signed = BODY_MORPHS.filter((m) => m !== 'gender');
    for (let mask = 0; mask < 1 << signed.length; mask++) {
      for (const gender of [0, 1]) {
        for (const heightCm of [140, 210]) {
          const b = body({ gender, heightCm });
          signed.forEach((m, i) => (b[m] = mask & (1 << i) ? 1 : -1));
          const s = avatarScale(b, meta);
          expect(Number.isFinite(s) && s > 0).toBe(true);
          expect(Number.isFinite(groundOffset(b, meta, s))).toBe(true);
        }
      }
    }
  });
  it('hits the requested height at the extreme (Review Focus 2)', () => {
    const b = body({ heightCm: 210, legLength: -1 });
    const s = avatarScale(b, meta);
    expect((meta.heightM - 0.13) * s).toBeCloseTo(2.1, 9);
  });
});

describe('applyBodyMorphs', () => {
  it('sets influences on a mesh carrying the targets', () => {
    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.morphTargetDictionary = { body_waist_min: 0, body_waist_max: 1 };
    mesh.morphTargetInfluences = [0, 0];
    const root = new Mesh();
    root.add(mesh);
    applyBodyMorphs(root, body({ waist: -0.4 }));
    expect(mesh.morphTargetInfluences).toEqual([0.4, 0]);
  });
});
